import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  PLATFORM_LABELS,
  type AddSocialAccountsInput,
  type AvailableSocialAccount,
  type ConnectSocialInput,
  type OAuthErrorCode,
  type SocialAccountDto,
  type SocialPlatform,
  type SocialProviderId,
  type SocialProviderInfo,
} from '@zatma/validation';
import { UsageService } from '../billing/usage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { emailTemplates } from '../email/templates.js';
import type { Prisma, SocialAccount, SocialConnection } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { pkcePair, ProviderAuthError, type DiscoveredAccount, type HealthResult, type SocialProvider } from './providers/provider.js';
import { OAuthStateStore, SocialProviderRegistry } from './social-registry.js';
import type { TokenCipher } from './token-cipher.js';

/** Grants expiring within this window are refreshed (or flagged for reconnection) by the health job. */
const REFRESH_WINDOW_MS = 7 * 86_400_000;

type AccountRow = SocialAccount & { connection: SocialConnection; connectedBy: { id: string; name: string } | null };

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly registry: SocialProviderRegistry,
    private readonly states: OAuthStateStore,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  providers(): SocialProviderInfo[] {
    return this.registry.info();
  }

  private require(id: SocialProviderId): { provider: SocialProvider; cipher: TokenCipher } {
    const provider = this.registry.get(id);
    const cipher = this.registry.cipher;
    if (!provider || !cipher) throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'SOCIAL_PROVIDER_NOT_CONFIGURED', `${id} is not configured on this server yet`);
    return { provider, cipher };
  }

  // Associated data binds each ciphertext to its organization and grant/account.
  private connAad = (c: { organizationId: string; provider: string; externalUserId: string }) => `${c.organizationId}:conn:${c.provider}:${c.externalUserId}`;
  private acctAad = (a: { organizationId: string; platform: string; externalId: string }) => `${a.organizationId}:acct:${a.platform}:${a.externalId}`;

  // ───────────── OAuth ─────────────

  async startConnect(id: SocialProviderId, input: ConnectSocialInput): Promise<{ authorizeUrl: string }> {
    const { provider } = this.require(id);
    const ctx = TenantContext.get()!;
    if (input.reconnectConnectionId && !(await this.db.socialConnection.findFirst({ where: { id: input.reconnectConnectionId, provider: id } }))) throw notFound('Connection');
    const pkce = provider.usesPkce ? pkcePair() : null;
    const state = await this.states.create({
      organizationId: ctx.organizationId!,
      userId: ctx.userId!,
      provider: id,
      codeVerifier: pkce?.verifier,
      returnTo: input.returnTo,
      reconnectConnectionId: input.reconnectConnectionId,
    });
    return { authorizeUrl: provider.authorizeUrl({ state, redirectUri: this.registry.redirectUri(id), codeChallenge: pkce?.challenge }) };
  }

  private webRedirect(returnTo: string | undefined, params: Record<string, string>): string {
    const path = returnTo ?? '/marketing/accounts';
    const sep = path.includes('?') ? '&' : '?';
    return `${this.env.WEB_URL}${path}${sep}${new URLSearchParams(params).toString()}`;
  }

  /**
   * OAuth callback (public route). Validates the single-use state against the signed-in user, exchanges the
   * code, stores the encrypted grant and returns the web URL to redirect to. Never throws: errors become a
   * redirect with `?error=<code>`.
   */
  async handleCallback(id: SocialProviderId, q: { code?: string; state?: string; error?: string }, sessionUserId: string | null): Promise<string> {
    const data = await this.states.consume(q.state);
    const fail = (code: OAuthErrorCode, returnTo?: string) => this.webRedirect(returnTo, { error: code, provider: id });
    if (!data || data.provider !== id || !sessionUserId || data.userId !== sessionUserId) return fail('invalid_state', data?.returnTo);
    if (q.error || !q.code) return fail(q.error === 'access_denied' || q.error === 'user_cancelled_login' || q.error === 'user_cancelled_authorize' ? 'access_denied' : 'provider_error', data.returnTo);
    const provider = this.registry.get(id);
    const cipher = this.registry.cipher;
    if (!provider || !cipher) return fail('not_configured', data.returnTo);

    return TenantContext.run({ organizationId: data.organizationId, userId: data.userId }, async () => {
      try {
        const grant = await provider.exchangeCode({ code: q.code!, redirectUri: this.registry.redirectUri(id), codeVerifier: data.codeVerifier });
        const keys = { organizationId: data.organizationId, provider: id, externalUserId: grant.externalUserId };
        const tokenData = {
          accessTokenEncrypted: cipher.encrypt(grant.accessToken, this.connAad(keys)),
          refreshTokenEncrypted: grant.refreshToken ? cipher.encrypt(grant.refreshToken, this.connAad(keys)) : null,
          expiresAt: grant.expiresAt,
          scopes: grant.scopes,
          displayName: grant.displayName,
          status: 'ACTIVE' as const,
          lastError: null,
          lastRefreshedAt: new Date(),
          connectedById: data.userId,
        };
        const conn = await this.db.socialConnection.upsert({
          where: { organizationId_provider_externalUserId: keys },
          create: { ...keys, ...tokenData },
          update: tokenData,
        });
        // Reconnecting refreshes page tokens and reactivates the accounts already added from this grant.
        const existing = await this.db.socialAccount.findMany({ where: { OR: [{ connectionId: conn.id }, ...(data.reconnectConnectionId ? [{ connectionId: data.reconnectConnectionId }] : [])] } });
        if (existing.length) {
          const discovered = await provider.listAccounts(grant.accessToken);
          for (const acct of existing) {
            const d = discovered.find((x) => x.platform === acct.platform && x.externalId === acct.externalId);
            if (!d) continue;
            await this.db.socialAccount.update({
              where: { id: acct.id },
              data: { connectionId: conn.id, status: 'ACTIVE', lastError: null, name: d.name, username: d.username, avatarUrl: d.avatarUrl, accountTokenEncrypted: d.accountToken ? cipher.encrypt(d.accountToken, this.acctAad(acct)) : null },
            });
          }
        }
        await this.audit.record(data.reconnectConnectionId ? 'social.reconnected' : 'social.connected', 'social_connection', conn.id, { provider: id });
        return this.webRedirect(data.returnTo, { connection: conn.id });
      } catch (e) {
        this.logger.warn(`OAuth callback for ${id} failed: ${(e as Error).message}`);
        return fail('provider_error', data.returnTo);
      }
    });
  }

  // ───────────── Accounts ─────────────

  private async connection(id: string): Promise<SocialConnection> {
    const c = await this.db.socialConnection.findFirst({ where: { id } });
    if (!c) throw notFound('Connection');
    return c;
  }

  private decryptConn(c: SocialConnection, cipher: TokenCipher) {
    return { access: cipher.decrypt(c.accessTokenEncrypted, this.connAad(c)), refresh: c.refreshTokenEncrypted ? cipher.decrypt(c.refreshTokenEncrypted, this.connAad(c)) : null };
  }

  /** Access token for a connection, refreshing it first when it expires within 5 minutes. */
  private async accessToken(c: SocialConnection): Promise<string> {
    const { provider, cipher } = this.require(c.provider as SocialProviderId);
    const tokens = this.decryptConn(c, cipher);
    if (c.expiresAt && c.expiresAt.getTime() < Date.now() + 5 * 60_000 && tokens.refresh && provider.refresh) {
      return (await this.refreshConnection(c, provider, cipher, tokens.refresh)).accessToken;
    }
    return tokens.access;
  }

  private async refreshConnection(c: SocialConnection, provider: SocialProvider, cipher: TokenCipher, refreshToken: string) {
    try {
      const g = await provider.refresh!({ refreshToken });
      await this.db.socialConnection.update({
        where: { id: c.id },
        data: {
          accessTokenEncrypted: cipher.encrypt(g.accessToken, this.connAad(c)),
          refreshTokenEncrypted: g.refreshToken ? cipher.encrypt(g.refreshToken, this.connAad(c)) : c.refreshTokenEncrypted,
          expiresAt: g.expiresAt,
          scopes: g.scopes.length ? g.scopes : c.scopes,
          status: 'ACTIVE',
          lastError: null,
          lastRefreshedAt: new Date(),
        },
      });
      return g;
    } catch (e) {
      if (e instanceof ProviderAuthError) {
        await this.db.socialConnection.update({ where: { id: c.id }, data: { status: 'NEEDS_REAUTH', lastError: e.message } });
        throw new AppException(HttpStatus.CONFLICT, 'SOCIAL_REAUTH_REQUIRED', 'This account must be reconnected', { connectionId: c.id });
      }
      throw e;
    }
  }

  async available(connectionId: string): Promise<AvailableSocialAccount[]> {
    const c = await this.connection(connectionId);
    const { provider } = this.require(c.provider as SocialProviderId);
    const discovered = await this.discover(provider, c);
    const added = await this.db.socialAccount.findMany({ where: { OR: discovered.map((d) => ({ platform: d.platform, externalId: d.externalId })) }, select: { platform: true, externalId: true } });
    const key = (a: { platform: string; externalId: string }) => `${a.platform}:${a.externalId}`;
    const addedKeys = new Set(added.map(key));
    return discovered.map((d) => ({ platform: d.platform, externalId: d.externalId, name: d.name, username: d.username, avatarUrl: d.avatarUrl, alreadyAdded: addedKeys.has(key(d)) }));
  }

  private async discover(provider: SocialProvider, c: SocialConnection): Promise<DiscoveredAccount[]> {
    try {
      return await provider.listAccounts(await this.accessToken(c));
    } catch (e) {
      if (e instanceof ProviderAuthError) {
        await this.db.socialConnection.update({ where: { id: c.id }, data: { status: 'NEEDS_REAUTH', lastError: e.message } });
        throw new AppException(HttpStatus.CONFLICT, 'SOCIAL_REAUTH_REQUIRED', 'This connection must be reconnected', { connectionId: c.id });
      }
      throw new AppException(HttpStatus.BAD_GATEWAY, 'SOCIAL_PROVIDER_ERROR', `The platform returned an error: ${(e as Error).message}`);
    }
  }

  private async assertWorkspaces(ids: string[]) {
    if (!ids.length) return;
    const found = await this.db.workspace.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw notFound('Workspace');
  }

  async addAccounts(input: AddSocialAccountsInput): Promise<SocialAccountDto[]> {
    const c = await this.connection(input.connectionId);
    const { provider, cipher } = this.require(c.provider as SocialProviderId);
    await this.assertWorkspaces(input.workspaceIds);
    const discovered = await this.discover(provider, c);
    const wanted = discovered.filter((d) => input.externalIds.includes(d.externalId));
    if (wanted.length !== new Set(input.externalIds).size) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'ACCOUNT_NOT_AVAILABLE', 'One or more accounts are not available to this connection');
    }
    const existing = await this.db.socialAccount.findMany({ where: { OR: wanted.map((d) => ({ platform: d.platform, externalId: d.externalId })) } });
    const newCount = wanted.filter((d) => !existing.some((e) => e.platform === d.platform && e.externalId === d.externalId && e.status !== 'DISCONNECTED')).length;
    if (newCount) await this.usage.assertWithinLimit(TenantContext.requireOrganizationId(), 'socialAccounts', newCount);
    const organizationId = TenantContext.requireOrganizationId();
    const ids: string[] = [];
    for (const d of wanted) {
      const keys = { organizationId, platform: d.platform, externalId: d.externalId };
      const data = {
        connectionId: c.id,
        name: d.name,
        username: d.username,
        avatarUrl: d.avatarUrl,
        accountTokenEncrypted: d.accountToken ? cipher.encrypt(d.accountToken, this.acctAad(keys)) : null,
        capabilities: d.capabilities as Prisma.InputJsonValue,
        status: 'ACTIVE' as const,
        lastError: null,
        lastCheckedAt: new Date(),
        workspaceIds: input.workspaceIds,
        connectedById: TenantContext.get()?.userId ?? null,
      };
      const row = await this.db.socialAccount.upsert({ where: { organizationId_platform_externalId: keys }, create: { ...keys, ...data }, update: data });
      ids.push(row.id);
    }
    return (await this.listRows({ id: { in: ids } })).map((r) => this.toDto(r));
  }

  private listRows(where: Prisma.SocialAccountWhereInput = {}): Promise<AccountRow[]> {
    return this.db.socialAccount.findMany({
      where: { status: { not: 'DISCONNECTED' }, ...where },
      include: { connection: true, connectedBy: { select: { id: true, name: true } } },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    }) as Promise<AccountRow[]>;
  }

  toDto(a: AccountRow): SocialAccountDto {
    return {
      id: a.id,
      platform: a.platform as SocialPlatform,
      externalId: a.externalId,
      name: a.name,
      username: a.username,
      avatarUrl: a.avatarUrl,
      status: a.status,
      lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null,
      lastError: a.lastError,
      workspaceIds: a.workspaceIds,
      connection: {
        id: a.connection.id,
        provider: a.connection.provider as SocialProviderId,
        displayName: a.connection.displayName,
        status: a.connection.status,
        expiresAt: a.connection.expiresAt?.toISOString() ?? null,
        scopes: a.connection.scopes,
      },
      connectedBy: a.connectedBy,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async listAccounts(): Promise<SocialAccountDto[]> {
    return (await this.listRows()).map((r) => this.toDto(r));
  }

  /**
   * What the publisher needs for one account: the adapter, the account's platform identity and a usable token
   * (the Meta Page token, or the grant's access token refreshed when about to expire).
   */
  async publishingTarget(accountId: string): Promise<{ provider: SocialProvider; platform: SocialPlatform; externalId: string; capabilities: Record<string, unknown>; name: string; token: string }> {
    const a = await this.accountRow(accountId);
    const { provider, cipher } = this.require(a.connection.provider as SocialProviderId);
    if (!provider.publish) throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'PUBLISHING_NOT_SUPPORTED', `${provider.name} publishing is not available`);
    if (a.status === 'NEEDS_REAUTH' || a.connection.status !== 'ACTIVE') {
      throw new AppException(HttpStatus.CONFLICT, 'SOCIAL_REAUTH_REQUIRED', `${a.name} must be reconnected`, { accountId });
    }
    const token = a.accountTokenEncrypted ? cipher.decrypt(a.accountTokenEncrypted, this.acctAad(a)) : await this.accessToken(a.connection);
    return { provider, platform: a.platform as SocialPlatform, externalId: a.externalId, capabilities: (a.capabilities ?? {}) as Record<string, unknown>, name: a.name, token };
  }

  /** Called by the publisher when a platform rejects the token: same path as a failed health check (audit + email). */
  async markNeedsReauth(accountId: string, error: string): Promise<void> {
    const a = await this.accountRow(accountId).catch(() => null);
    if (a) await this.recordHealth(a, { status: 'NEEDS_REAUTH', error });
  }

  private async accountRow(id: string): Promise<AccountRow> {
    const [row] = await this.listRows({ id });
    if (!row) throw notFound('Social account');
    return row;
  }

  async updateAccount(id: string, workspaceIds: string[]): Promise<SocialAccountDto> {
    await this.accountRow(id);
    await this.assertWorkspaces(workspaceIds);
    await this.db.socialAccount.update({ where: { id }, data: { workspaceIds } });
    return this.toDto(await this.accountRow(id));
  }

  /** Checks one account against the platform and records the result (emails the connector on a new re-auth). */
  async checkAccount(id: string): Promise<SocialAccountDto> {
    const a = await this.accountRow(id);
    const { provider, cipher } = this.require(a.connection.provider as SocialProviderId);
    let result: HealthResult;
    if (a.connection.status !== 'ACTIVE') {
      // The grant itself needs re-authorizing (refresh failed, expiring Meta token, app removed).
      await this.recordHealth(a, { status: 'NEEDS_REAUTH', error: a.connection.lastError ?? 'Authorization expired' });
      return this.toDto(await this.accountRow(id));
    }
    try {
      const token = a.accountTokenEncrypted ? cipher.decrypt(a.accountTokenEncrypted, this.acctAad(a)) : await this.accessToken(a.connection);
      result = await provider.checkAccount({ platform: a.platform as SocialPlatform, externalId: a.externalId, token });
    } catch (e) {
      result = e instanceof AppException && e.code === 'SOCIAL_REAUTH_REQUIRED' ? { status: 'NEEDS_REAUTH', error: a.connection.lastError ?? 'Authorization expired' } : { status: 'ERROR', error: (e as Error).message };
    }
    await this.recordHealth(a, result);
    return this.toDto(await this.accountRow(id));
  }

  private async recordHealth(a: AccountRow, result: HealthResult) {
    await this.db.socialAccount.update({ where: { id: a.id }, data: { status: result.status, lastError: result.status === 'ACTIVE' ? null : result.error, lastCheckedAt: new Date() } });
    if (result.status === 'NEEDS_REAUTH' && a.status !== 'NEEDS_REAUTH') {
      await this.audit.record('social.reauth_required', 'social_account', a.id, { platform: a.platform, name: a.name, reason: result.error });
      await this.notifyReauth(a, result.error);
    }
  }

  private async notifyReauth(a: AccountRow, reason: string) {
    const userId = a.connectedById ?? a.connection.connectedById;
    if (!userId) return;
    const user = await this.prisma.system.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) return;
    const t = emailTemplates.socialReauth({ name: user.name, accountName: a.name, platformLabel: PLATFORM_LABELS[a.platform as SocialPlatform], reason, url: `${this.env.WEB_URL}/marketing/accounts` });
    await this.email.send({ to: user.email, subject: t.subject, html: t.html, text: t.text, tag: t.tag, organizationId: a.organizationId }).catch((e) => this.logger.warn(`Re-auth email failed: ${(e as Error).message}`));
  }

  /** Disconnects an account; revokes the grant when no other account uses it. */
  async disconnect(id: string): Promise<void> {
    const a = await this.accountRow(id);
    await this.db.socialAccount.delete({ where: { id } });
    const remaining = await this.db.socialAccount.count({ where: { connectionId: a.connectionId } });
    if (remaining === 0) {
      const provider = this.registry.get(a.connection.provider as SocialProviderId);
      const cipher = this.registry.cipher;
      if (provider && cipher && a.connection.status !== 'REVOKED') {
        try {
          await provider.revoke(this.decryptConn(a.connection, cipher).access);
        } catch (e) {
          this.logger.warn(`Revoking ${a.connection.provider} grant failed (deleting anyway): ${(e as Error).message}`);
        }
      }
      await this.db.socialConnection.delete({ where: { id: a.connectionId } });
    }
  }

  // ───────────── Health job ─────────────

  /** Refreshes expiring grants and checks every account of one organization (inside its tenant context). */
  async runHealth(organizationId: string): Promise<{ checked: number }> {
    return TenantContext.run({ organizationId }, async () => {
      const connections = await this.db.socialConnection.findMany({ where: { status: { not: 'REVOKED' } } });
      for (const c of connections) {
        const provider = this.registry.get(c.provider as SocialProviderId);
        const cipher = this.registry.cipher;
        if (!provider || !cipher || !c.expiresAt || c.expiresAt.getTime() > Date.now() + REFRESH_WINDOW_MS) continue;
        const refresh = this.decryptConn(c, cipher).refresh;
        if (refresh && provider.refresh) {
          await this.refreshConnection(c, provider, cipher, refresh).catch((e) => this.logger.warn(`Refresh failed for ${c.id}: ${(e as Error).message}`));
        } else if (c.status === 'ACTIVE') {
          // Platforms without refresh (Meta long-lived user tokens): ask the user to reconnect before expiry.
          await this.db.socialConnection.update({ where: { id: c.id }, data: { status: 'NEEDS_REAUTH', lastError: `Authorization expires on ${c.expiresAt.toISOString().slice(0, 10)}` } });
        }
      }
      const accounts = await this.listRows();
      for (const a of accounts) await this.checkAccount(a.id).catch((e) => this.logger.warn(`Health check failed for ${a.id}: ${(e as Error).message}`));
      return { checked: accounts.length };
    });
  }

  // ───────────── Meta platform callbacks (no tenant context) ─────────────

  /** A person removed the app (deauthorize callback / permissions webhook): mark their grants revoked. */
  async revokeMetaUser(externalUserId: string): Promise<number> {
    const conns = await this.prisma.system.socialConnection.findMany({ where: { provider: 'meta', externalUserId } });
    for (const c of conns) {
      await this.prisma.system.socialConnection.update({ where: { id: c.id }, data: { status: 'REVOKED', lastError: 'Access was removed on Facebook' } });
      await this.prisma.system.socialAccount.updateMany({ where: { connectionId: c.id }, data: { status: 'NEEDS_REAUTH', lastError: 'Access was removed on Facebook' } });
    }
    return conns.length;
  }

  /** Data deletion request: delete the person's grants and the accounts added through them. */
  async deleteMetaUserData(externalUserId: string): Promise<number> {
    const res = await this.prisma.system.socialConnection.deleteMany({ where: { provider: 'meta', externalUserId } });
    return res.count;
  }

  async recordWebhook(provider: string, payload: Record<string, unknown>): Promise<void> {
    const entries = Array.isArray(payload.entry) ? (payload.entry as Array<Record<string, unknown>>) : [];
    const object = typeof payload.object === 'string' ? payload.object : null;
    for (const entry of entries.length ? entries : [{}]) {
      const changes = Array.isArray(entry.changes) ? (entry.changes as Array<Record<string, unknown>>) : [{}];
      for (const ch of changes) {
        await this.prisma.system.socialWebhookEvent.create({
          data: { provider, object, objectId: typeof entry.id === 'string' ? entry.id : null, field: typeof ch.field === 'string' ? ch.field : null, payload: { entry, change: ch } as Prisma.InputJsonValue },
        });
        // App-level "permissions" updates tell us when a user revokes the app.
        if (object === 'permissions' && typeof entry.id === 'string') {
          const value = ch.value as { verb?: string } | undefined;
          if (value?.verb === 'revoked') await this.revokeMetaUser(entry.id);
        }
      }
    }
  }

}
