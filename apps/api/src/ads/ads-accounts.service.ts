import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { fromCents, maxSpendThisMonth, monthWindow, toCents, type AdAccountDto, type AdPlatform, type AvailableAdAccount } from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { AdAccount, Prisma, SocialConnection } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { pkcePair, ProviderAuthError } from '../social/providers/provider.js';
import { OAuthStateStore } from '../social/social-registry.js';
import { AdsRegistry, PLATFORM_OF, PROVIDER_OF, type AdsProviderId } from './ads-registry.js';
import type { AdsCtx, AdsPlatformAdapter } from './providers/ads-provider.js';

const RETURN_TO: Record<AdsProviderId, string> = { meta_ads: '/ads/meta', google_ads: '/ads/google' };
type AccountRow = AdAccount & { connection: SocialConnection };

/** Ad platform connections and ad accounts (grants are `social_connection` rows with provider meta_ads / google_ads). */
@Injectable()
export class AdsAccountsService {
  private readonly logger = new Logger(AdsAccountsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly registry: AdsRegistry,
    private readonly states: OAuthStateStore,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  private connAad = (c: { organizationId: string; provider: string; externalUserId: string }) => `${c.organizationId}:conn:${c.provider}:${c.externalUserId}`;

  require(id: AdsProviderId): AdsPlatformAdapter {
    const a = this.registry.get(id);
    if (!a || !this.registry.cipher) throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'ADS_PROVIDER_NOT_CONFIGURED', `${id === 'meta_ads' ? 'Meta Ads' : 'Google Ads'} is not configured on this server yet`);
    return a;
  }

  providers() {
    return this.registry.info();
  }

  // ───────────── OAuth ─────────────

  async startConnect(id: AdsProviderId, returnTo?: string): Promise<{ authorizeUrl: string }> {
    const adapter = this.require(id);
    const ctx = TenantContext.get()!;
    const pkce = adapter.usesPkce ? pkcePair() : null;
    const state = await this.states.create({ organizationId: ctx.organizationId!, userId: ctx.userId!, provider: id as never, codeVerifier: pkce?.verifier, returnTo: returnTo ?? RETURN_TO[id] });
    return { authorizeUrl: adapter.authorizeUrl({ state, redirectUri: this.registry.redirectUri(id), codeChallenge: pkce?.challenge }) };
  }

  private redirect(returnTo: string, params: Record<string, string>) {
    const u = new URL(`${this.env.WEB_URL}${returnTo}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  /** Never throws: every outcome is a redirect back to the app (session user must match the user who started). */
  async handleCallback(id: AdsProviderId, q: { code?: string; state?: string; error?: string }, sessionUserId: string | null): Promise<string> {
    const data = await this.states.consume(q.state);
    const back = data?.returnTo ?? RETURN_TO[id];
    const fail = (code: string) => this.redirect(back, { error: code, provider: id });
    if (!data || (data.provider as string) !== id || !sessionUserId || data.userId !== sessionUserId) return fail('invalid_state');
    if (q.error || !q.code) return fail(q.error === 'access_denied' || q.error?.startsWith('user_cancelled') ? 'access_denied' : 'provider_error');
    const adapter = this.registry.get(id);
    const cipher = this.registry.cipher;
    if (!adapter || !cipher) return fail('not_configured');
    return TenantContext.run({ organizationId: data.organizationId, userId: data.userId }, async () => {
      try {
        const grant = await adapter.exchangeCode({ code: q.code!, redirectUri: this.registry.redirectUri(id), codeVerifier: data.codeVerifier });
        const keys = { organizationId: data.organizationId, provider: id, externalUserId: grant.externalUserId };
        const tokens = {
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
        const conn = await this.db.socialConnection.upsert({ where: { organizationId_provider_externalUserId: keys }, create: { ...keys, ...tokens }, update: tokens });
        await this.db.adAccount.updateMany({ where: { connectionId: conn.id, status: 'NEEDS_REAUTH' }, data: { status: 'ACTIVE', lastError: null } });
        await this.audit.record('ads.connected', 'social_connection', conn.id, { provider: id });
        return this.redirect(back, { connection: conn.id });
      } catch (e) {
        this.logger.warn(`Ads OAuth callback for ${id} failed: ${(e as Error).message}`);
        return fail('provider_error');
      }
    });
  }

  // ───────────── Tokens ─────────────

  /** Access token for a grant, refreshed when it expires within 5 minutes; auth failures flag the accounts. */
  async token(c: SocialConnection): Promise<string> {
    const adapter = this.require(c.provider as AdsProviderId);
    const cipher = this.registry.cipher!;
    if (c.status === 'REVOKED' || c.status === 'NEEDS_REAUTH') throw this.reauth(c.id);
    const access = cipher.decrypt(c.accessTokenEncrypted, this.connAad(c));
    if (!c.expiresAt || c.expiresAt.getTime() > Date.now() + 5 * 60_000 || !c.refreshTokenEncrypted || !adapter.refresh) return access;
    try {
      const g = await adapter.refresh({ refreshToken: cipher.decrypt(c.refreshTokenEncrypted, this.connAad(c)) });
      await this.prisma.tenant.socialConnection.update({
        where: { id: c.id },
        data: { accessTokenEncrypted: cipher.encrypt(g.accessToken, this.connAad(c)), refreshTokenEncrypted: g.refreshToken ? cipher.encrypt(g.refreshToken, this.connAad(c)) : c.refreshTokenEncrypted, expiresAt: g.expiresAt, lastRefreshedAt: new Date(), status: 'ACTIVE', lastError: null },
      });
      return g.accessToken;
    } catch (e) {
      if (e instanceof ProviderAuthError) {
        await this.flagReauth(c.id, e.message);
        throw this.reauth(c.id);
      }
      throw e;
    }
  }

  private reauth(connectionId: string) {
    return new AppException(HttpStatus.CONFLICT, 'ADS_REAUTH_REQUIRED', 'This ad platform connection must be reconnected', { connectionId });
  }

  async flagReauth(connectionId: string, error: string) {
    await this.prisma.tenant.socialConnection.update({ where: { id: connectionId }, data: { status: 'NEEDS_REAUTH', lastError: error.slice(0, 500) } });
    await this.prisma.tenant.adAccount.updateMany({ where: { connectionId }, data: { status: 'NEEDS_REAUTH', lastError: error.slice(0, 500) } });
    await this.audit.record('ads.reauth_required', 'social_connection', connectionId, { error: error.slice(0, 200) });
  }

  /** Adapter context for one account; `state` persistence is supplied by the caller (campaign creation). */
  async ctx(accountId: string, state: Record<string, unknown> = {}, saveState: AdsCtx['saveState'] = async () => undefined): Promise<{ adapter: AdsPlatformAdapter; ctx: AdsCtx; account: AccountRow }> {
    const account = await this.row(accountId);
    const adapter = this.require(account.connection.provider as AdsProviderId);
    const token = await this.token(account.connection);
    return { adapter, account, ctx: { token, account: { externalId: account.externalId, currency: account.currency, loginCustomerId: account.loginCustomerId }, state, saveState } };
  }

  // ───────────── Accounts ─────────────

  private async connection(id: string): Promise<SocialConnection> {
    const c = await this.db.socialConnection.findFirst({ where: { id, provider: { in: ['meta_ads', 'google_ads'] } } });
    if (!c) throw notFound('Connection');
    return c;
  }

  async available(connectionId: string): Promise<AvailableAdAccount[]> {
    const c = await this.connection(connectionId);
    const adapter = this.require(c.provider as AdsProviderId);
    const accounts = await this.callWithAuth(c, (t) => adapter.listAdAccounts(t));
    const existing = await this.db.adAccount.findMany({ where: { platform: PLATFORM_OF[c.provider as AdsProviderId] }, select: { externalId: true } });
    const added = new Set(existing.map((e) => e.externalId));
    return accounts.map((a) => ({ externalId: a.externalId, name: a.name, currency: a.currency, timezone: a.timezone, status: a.status, manager: a.manager, alreadyAdded: added.has(a.externalId) }));
  }

  private async callWithAuth<T>(c: SocialConnection, fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.token(c));
    } catch (e) {
      if (e instanceof ProviderAuthError) {
        await this.flagReauth(c.id, e.message);
        throw this.reauth(c.id);
      }
      if (e instanceof AppException) throw e;
      throw new AppException(HttpStatus.BAD_GATEWAY, 'ADS_PROVIDER_ERROR', `The ad platform returned an error: ${(e as Error).message}`);
    }
  }

  async addAccounts(input: { connectionId: string; externalIds: string[]; workspaceIds: string[] }): Promise<AdAccountDto[]> {
    const c = await this.connection(input.connectionId);
    const adapter = this.require(c.provider as AdsProviderId);
    if (input.workspaceIds.length && (await this.db.workspace.count({ where: { id: { in: input.workspaceIds } } })) !== new Set(input.workspaceIds).size) throw notFound('Workspace');
    const discovered = await this.callWithAuth(c, (t) => adapter.listAdAccounts(t));
    const wanted = discovered.filter((d) => input.externalIds.includes(d.externalId));
    if (wanted.length !== new Set(input.externalIds).size) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'ACCOUNT_NOT_AVAILABLE', 'One or more ad accounts are not available to this connection');
    const platform = PLATFORM_OF[c.provider as AdsProviderId];
    const existing = await this.db.adAccount.findMany({ where: { platform, externalId: { in: input.externalIds } }, select: { externalId: true } });
    const fresh = wanted.filter((w) => !existing.some((e) => e.externalId === w.externalId)).length;
    const organizationId = TenantContext.requireOrganizationId();
    if (fresh) await this.usage.assertWithinLimit(organizationId, 'adAccounts', fresh);
    const ids: string[] = [];
    for (const d of wanted) {
      const keys = { organizationId, platform, externalId: d.externalId };
      const data = { connectionId: c.id, name: d.name, currency: d.currency, timezone: d.timezone, status: d.status, loginCustomerId: d.loginCustomerId ?? null, workspaceIds: input.workspaceIds, lastError: null };
      const row = await this.db.adAccount.upsert({ where: { organizationId_platform_externalId: keys }, create: { ...keys, ...data }, update: data });
      ids.push(row.id);
    }
    await this.audit.record('ads.accounts_added', 'ad_account', null, { platform, count: ids.length });
    return this.list({ id: { in: ids } });
  }

  async row(id: string): Promise<AccountRow> {
    const a = await this.db.adAccount.findFirst({ where: { id }, include: { connection: true } });
    if (!a) throw notFound('Ad account');
    return a;
  }

  async list(where: Prisma.AdAccountWhereInput = {}): Promise<AdAccountDto[]> {
    const rows = await this.db.adAccount.findMany({ where, include: { connection: true }, orderBy: [{ platform: 'asc' }, { name: 'asc' }] });
    if (!rows.length) return [];
    const month = monthWindow(new Date());
    const spent = await this.db.adInsightDaily.groupBy({ by: ['campaignId'], where: { date: { gte: month.start, lt: month.end }, campaign: { adAccountId: { in: rows.map((r) => r.id) } } }, _sum: { spend: true } });
    const campaigns = await this.db.adCampaign.findMany({ where: { adAccountId: { in: rows.map((r) => r.id) }, deletedAt: null }, select: { id: true, adAccountId: true, status: true, budgetType: true, budgetAmount: true, startAt: true, endAt: true } });
    return rows.map((a) => {
      const own = campaigns.filter((c) => c.adAccountId === a.id);
      const spentCents = own.reduce((n, c) => n + toCents((spent.find((s) => s.campaignId === c.id)?._sum.spend ?? 0).toFixed(2)), 0n);
      const committed = this.committedCents(own);
      return {
        id: a.id,
        platform: a.platform as AdPlatform,
        externalId: a.externalId,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
        status: a.status as AdAccountDto['status'],
        monthlySpendCap: a.monthlySpendCap ? a.monthlySpendCap.toFixed(2) : null,
        spentThisMonth: fromCents(spentCents),
        committedThisMonth: fromCents(committed),
        workspaceIds: a.workspaceIds,
        lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
        lastError: a.lastError,
        connection: { id: a.connection.id, provider: a.connection.provider, status: a.connection.status, displayName: a.connection.displayName },
      };
    });
  }

  /** Remaining maximum spend this month of the account's ACTIVE campaigns (cents). */
  committedCents(campaigns: Array<{ id: string; status: string; budgetType: 'DAILY' | 'LIFETIME'; budgetAmount: { toFixed(d: number): string }; startAt: Date | null; endAt: Date | null }>, excludeId?: string): bigint {
    return campaigns
      .filter((c) => c.status === 'ACTIVE' && c.id !== excludeId)
      .reduce((n, c) => n + toCents(maxSpendThisMonth({ budgetType: c.budgetType, budgetAmount: c.budgetAmount.toFixed(2), startAt: c.startAt?.toISOString(), endAt: c.endAt?.toISOString() })), 0n);
  }

  async update(id: string, input: { workspaceIds?: string[]; monthlySpendCap?: string | null }): Promise<AdAccountDto> {
    await this.row(id);
    if (input.monthlySpendCap !== undefined && !(TenantContext.get()?.permissions ?? []).includes('ads:approve')) {
      throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Only an Owner or Admin can change the spend cap');
    }
    if (input.workspaceIds?.length && (await this.db.workspace.count({ where: { id: { in: input.workspaceIds } } })) !== new Set(input.workspaceIds).size) throw notFound('Workspace');
    await this.db.adAccount.update({ where: { id }, data: { ...(input.workspaceIds ? { workspaceIds: input.workspaceIds } : {}), ...(input.monthlySpendCap !== undefined ? { monthlySpendCap: input.monthlySpendCap } : {}) } });
    if (input.monthlySpendCap !== undefined) await this.audit.record('ads.spend_cap_changed', 'ad_account', id, { monthlySpendCap: input.monthlySpendCap });
    return (await this.list({ id }))[0]!;
  }

  /** Removes the account from ZatGo only (nothing changes on the platform). Refused while a campaign is spending. */
  async remove(id: string): Promise<void> {
    const a = await this.row(id);
    if (await this.db.adCampaign.count({ where: { adAccountId: id, status: 'ACTIVE', deletedAt: null } })) {
      throw new AppException(HttpStatus.CONFLICT, 'ACTIVE_CAMPAIGNS', 'Pause the active campaigns in this account before removing it');
    }
    await this.db.adAccount.delete({ where: { id } });
    if (!(await this.db.adAccount.count({ where: { connectionId: a.connectionId } }))) {
      const adapter = this.registry.get(a.connection.provider as AdsProviderId);
      if (adapter && this.registry.cipher && a.connection.status !== 'REVOKED') {
        await adapter.revoke(this.registry.cipher.decrypt(a.connection.accessTokenEncrypted, this.connAad(a.connection))).catch((e) => this.logger.warn(`Revoke failed: ${(e as Error).message}`));
      }
      await this.db.socialConnection.delete({ where: { id: a.connectionId } });
    }
    await this.audit.record('ads.account_removed', 'ad_account', id, { name: a.name });
  }

  providerFor(platform: AdPlatform): AdsProviderId {
    return PROVIDER_OF[platform];
  }
}
