import { createHmac, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SocialPlatform } from '@zatma/validation';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProviderAuthError, type DiscoveredAccount, type HealthResult, type OAuthGrant, type SocialProvider } from '../src/social/providers/provider.js';
import { SocialProviderRegistry } from '../src/social/social-registry.js';
import { SocialService } from '../src/social/social.service.js';
import { TokenCipher } from '../src/social/token-cipher.js';
import { createTestApp } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, waitForEmail, type TestUser } from './helpers.js';

const KEY = `k1:${randomBytes(32).toString('base64')}`;
const APP_SECRET = 'meta-app-secret';

/** In-memory platform: records calls, returns configurable accounts and health. */
class FakeProvider implements SocialProvider {
  readonly name = 'Fake';
  readonly scopes = ['scope.a'];
  readonly usesPkce: boolean;
  accounts: DiscoveredAccount[] = [];
  health: HealthResult = { status: 'ACTIVE' };
  refreshFails = false;
  revoked: string[] = [];
  codes: Array<{ code: string; codeVerifier?: string }> = [];
  constructor(
    readonly id: 'meta' | 'linkedin' | 'google',
    readonly platforms: SocialPlatform[],
    private readonly grant: Partial<OAuthGrant> = {},
  ) {
    this.usesPkce = id === 'google';
  }
  authorizeUrl({ state, redirectUri, codeChallenge }: { state: string; redirectUri: string; codeChallenge?: string }) {
    return `https://auth.fake/${this.id}?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}${codeChallenge ? `&cc=${codeChallenge}` : ''}`;
  }
  async exchangeCode({ code, codeVerifier }: { code: string; codeVerifier?: string }): Promise<OAuthGrant> {
    this.codes.push({ code, codeVerifier });
    if (code === 'bad') throw new Error('invalid code');
    return { accessToken: `access-${code}`, refreshToken: this.id === 'meta' ? null : `refresh-${code}`, expiresAt: new Date(Date.now() + 3600_000), scopes: this.scopes, externalUserId: `${this.id}-user-1`, displayName: 'Zain', ...this.grant };
  }
  refresh = async () => {
    if (this.refreshFails) throw new ProviderAuthError('Refresh token revoked');
    return { accessToken: 'access-refreshed', refreshToken: 'refresh-2', expiresAt: new Date(Date.now() + 30 * 86_400_000), scopes: this.scopes };
  };
  async listAccounts(token: string) {
    if (token === 'access-expired') throw new ProviderAuthError('Token expired');
    return this.accounts;
  }
  async checkAccount() {
    return this.health;
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
}

const page = (id: string, name: string): DiscoveredAccount => ({ platform: 'FACEBOOK_PAGE', externalId: id, name, username: null, avatarUrl: null, accountToken: `page-token-${id}`, capabilities: {} });
const ig = (id: string, user: string, pageId: string): DiscoveredAccount => ({ platform: 'INSTAGRAM_BUSINESS', externalId: id, name: user, username: user, avatarUrl: null, accountToken: `page-token-${pageId}`, capabilities: { pageId } });

describe('Social accounts (e2e)', () => {
  let app: NestExpressApplication;
  let registry: SocialProviderRegistry;
  let owner: TestUser;
  let orgId: string;
  let meta: FakeProvider;
  let google: FakeProvider;

  const raw = () => request(app.getHttpServer() as Server);

  /** Runs the OAuth round trip: connect → (platform) → callback. Returns the redirect Location. */
  async function connectVia(user: TestUser, provider: 'meta' | 'linkedin' | 'google', code = 'c1', body: object = {}) {
    const start = await api(app, user).post(`/social/connect/${provider}`, body).expect(200);
    const state = new URL(start.body.authorizeUrl).searchParams.get('state')!;
    const res = await api(app, user).get(`/social/oauth/${provider}/callback?code=${code}&state=${state}`).expect(302);
    return { location: new URL(res.headers.location as string), state, authorizeUrl: start.body.authorizeUrl as string };
  }

  beforeAll(async () => {
    app = await createTestApp({ env: { TOKEN_ENCRYPTION_KEYS: KEY, META_APP_ID: 'meta-app', META_APP_SECRET: APP_SECRET, META_WEBHOOK_VERIFY_TOKEN: 'verify-me' } });
    registry = app.get(SocialProviderRegistry);
    owner = await signUp(app, 'Social Owner');
    orgId = await createOrg(app, owner, 'Social Org');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    registry.reset(new TokenCipher(KEY));
    meta = new FakeProvider('meta', ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS']);
    meta.accounts = [page('p1', 'ZatGo Kochi'), ig('ig1', 'zatgo.kochi', 'p1'), page('p2', 'ZatGo Dubai')];
    google = new FakeProvider('google', ['YOUTUBE_CHANNEL']);
    google.accounts = [{ platform: 'YOUTUBE_CHANNEL', externalId: 'UC1', name: 'ZatGo TV', username: '@zatgotv', avatarUrl: null, accountToken: null, capabilities: {} }];
    registry.register(meta);
    registry.register(google);
  });

  it('lists providers with configuration state and redirect URIs', async () => {
    const res = await api(app, owner).get('/social/providers').expect(200);
    expect(res.body.map((p: { id: string; configured: boolean }) => [p.id, p.configured])).toEqual([
      ['meta', true],
      ['linkedin', false],
      ['google', true],
    ]);
    const li = res.body.find((p: { id: string }) => p.id === 'linkedin');
    expect(li.unavailableReason).toContain('LINKEDIN_CLIENT_ID');
    expect(li.redirectUri).toMatch(/\/api\/v1\/social\/oauth\/linkedin\/callback$/);
    await api(app, owner).post('/social/connect/linkedin', {}).expect(503);
    registry.reset(null);
    expect((await api(app, owner).get('/social/providers').expect(200)).body[0].unavailableReason).toContain('META_APP_ID');
  });

  it('connects Meta: state round trip, encrypted tokens, account selection with workspaces', async () => {
    const { location } = await connectVia(owner, 'meta', 'c1', { returnTo: '/marketing/accounts' });
    expect(location.pathname).toBe('/marketing/accounts');
    const connectionId = location.searchParams.get('connection')!;
    expect(connectionId).toMatch(/^[0-9a-f-]{36}$/);

    const stored = await app.get(PrismaService).system.socialConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(stored.accessTokenEncrypted.startsWith('v1.k1.')).toBe(true);
    expect(stored.accessTokenEncrypted).not.toContain('access-c1');

    const available = await api(app, owner).get(`/social/connections/${connectionId}/available`).expect(200);
    expect(available.body.map((a: { externalId: string; alreadyAdded: boolean }) => [a.externalId, a.alreadyAdded])).toEqual([
      ['p1', false],
      ['ig1', false],
      ['p2', false],
    ]);
    const ws = (await api(app, owner).get('/workspaces').expect(200)).body.data[0].id;
    const added = await api(app, owner).post('/social/accounts', { connectionId, externalIds: ['p1', 'ig1'], workspaceIds: [ws] }).expect(201);
    expect(added.body.map((a: { platform: string; name: string; status: string }) => [a.platform, a.name, a.status])).toEqual([
      ['FACEBOOK_PAGE', 'ZatGo Kochi', 'ACTIVE'],
      ['INSTAGRAM_BUSINESS', 'zatgo.kochi', 'ACTIVE'],
    ]);
    expect(added.body[0]).toMatchObject({ workspaceIds: [ws], connection: { provider: 'meta', status: 'ACTIVE', displayName: 'Zain' }, connectedBy: { name: 'Social Owner' } });
    // No token or ciphertext ever leaves the API.
    expect(JSON.stringify(added.body)).not.toMatch(/access-|page-token|v1\.k1\./);
    const listed = await api(app, owner).get('/social/accounts').expect(200);
    expect(JSON.stringify(listed.body)).not.toMatch(/access-|page-token|v1\.k1\./);
    expect((await api(app, owner).get(`/social/connections/${connectionId}/available`).expect(200)).body[0].alreadyAdded).toBe(true);

    const pageRow = await app.get(PrismaService).system.socialAccount.findFirstOrThrow({ where: { externalId: 'p1' } });
    expect(new TokenCipher(KEY).decrypt(pageRow.accountTokenEncrypted!, `${orgId}:acct:FACEBOOK_PAGE:p1`)).toBe('page-token-p1');

    await api(app, owner).post('/social/accounts', { connectionId, externalIds: ['nope'] }).expect(422);
    await api(app, owner).post('/social/accounts', { connectionId, externalIds: ['p2'], workspaceIds: ['0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'] }).expect(404);
    expect((await api(app, owner).get('/billing/usage').expect(200)).body.metrics.find((m: { metric: string }) => m.metric === 'socialAccounts').used).toBe(2);
  });

  it('rejects bad, reused, foreign and cancelled OAuth callbacks', async () => {
    const { state } = await connectVia(owner, 'meta', 'c2');
    // Reusing a consumed state
    let res = await api(app, owner).get(`/social/oauth/meta/callback?code=c3&state=${state}`).expect(302);
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe('invalid_state');
    // State started by another user
    const other = await signUp(app, 'Other User');
    await createOrg(app, other, 'Other Social Org');
    const start = await api(app, owner).post('/social/connect/meta', {}).expect(200);
    const s2 = new URL(start.body.authorizeUrl).searchParams.get('state');
    res = await api(app, other).get(`/social/oauth/meta/callback?code=c4&state=${s2}`).expect(302);
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe('invalid_state');
    // No session at all
    const s3 = new URL((await api(app, owner).post('/social/connect/meta', {}).expect(200)).body.authorizeUrl).searchParams.get('state');
    res = await api(app).get(`/social/oauth/meta/callback?code=c5&state=${s3}`).expect(302);
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe('invalid_state');
    // User cancelled on the platform
    const s4 = new URL((await api(app, owner).post('/social/connect/meta', {}).expect(200)).body.authorizeUrl).searchParams.get('state');
    res = await api(app, owner).get(`/social/oauth/meta/callback?error=access_denied&state=${s4}`).expect(302);
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe('access_denied');
    // Token exchange fails
    const { location } = await connectVia(owner, 'meta', 'bad');
    expect(location.searchParams.get('error')).toBe('provider_error');
    // Unsafe return paths are rejected up front
    await api(app, owner).post('/social/connect/meta', { returnTo: 'https://evil.example' }).expect(400);
  });

  it('uses PKCE for YouTube and refreshes expiring tokens', async () => {
    const { location, authorizeUrl } = await connectVia(owner, 'google', 'g1');
    expect(new URL(authorizeUrl).searchParams.get('cc')).toBeTruthy();
    expect(google.codes[0]!.codeVerifier).toMatch(/^[\w-]{43}$/);
    const connectionId = location.searchParams.get('connection')!;
    const [channel] = (await api(app, owner).post('/social/accounts', { connectionId, externalIds: ['UC1'] }).expect(201)).body;
    // Expire the grant: the next check refreshes it first
    await app.get(PrismaService).system.socialConnection.update({ where: { id: connectionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const checked = await api(app, owner).post(`/social/accounts/${channel.id}/check`).expect(200);
    expect(checked.body.status).toBe('ACTIVE');
    const conn = await app.get(PrismaService).system.socialConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(new TokenCipher(KEY).decrypt(conn.accessTokenEncrypted, `${orgId}:conn:google:google-user-1`)).toBe('access-refreshed');
    expect(conn.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('flags accounts for reconnection, emails the connector, and reconnects', async () => {
    const [acct] = (await api(app, owner).get('/social/accounts').expect(200)).body.filter((a: { externalId: string }) => a.externalId === 'p1');
    meta.health = { status: 'NEEDS_REAUTH', error: 'Error validating access token: The user has not authorized application' };
    const checked = await api(app, owner).post(`/social/accounts/${acct.id}/check`).expect(200);
    expect(checked.body).toMatchObject({ status: 'NEEDS_REAUTH', lastError: expect.stringContaining('not authorized') });
    const mail = await waitForEmail(app, owner.email, 'social-reauth');
    expect(mail.subject).toBe('Reconnect ZatGo Kochi (Facebook Page) on ZatGo AI Marketing');
    const audit = await app.get(PrismaService).system.auditLog.findFirst({ where: { organizationId: orgId, action: 'social.reauth_required' } });
    expect(audit?.resourceId).toBe(acct.id);

    meta.health = { status: 'ACTIVE' };
    meta.accounts = [page('p1', 'ZatGo Kochi (renamed)'), ig('ig1', 'zatgo.kochi', 'p1')];
    const { location } = await connectVia(owner, 'meta', 'c9', { reconnectConnectionId: acct.connection.id });
    expect(location.searchParams.get('connection')).toBe(acct.connection.id);
    const after = (await api(app, owner).get('/social/accounts').expect(200)).body.find((a: { id: string }) => a.id === acct.id);
    expect(after).toMatchObject({ status: 'ACTIVE', name: 'ZatGo Kochi (renamed)', lastError: null });
  });

  it('runs the health job: Meta grants near expiry need reconnecting, failed refreshes are flagged', async () => {
    const prisma = app.get(PrismaService);
    const metaConn = await prisma.system.socialConnection.findFirstOrThrow({ where: { organizationId: orgId, provider: 'meta' } });
    await prisma.system.socialConnection.update({ where: { id: metaConn.id }, data: { expiresAt: new Date(Date.now() + 3 * 86_400_000) } });
    const googleConn = await prisma.system.socialConnection.findFirstOrThrow({ where: { organizationId: orgId, provider: 'google' } });
    await prisma.system.socialConnection.update({ where: { id: googleConn.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });
    google.refreshFails = true;
    await app.get(SocialService).runHealth(orgId);
    expect((await prisma.system.socialConnection.findUniqueOrThrow({ where: { id: metaConn.id } })).status).toBe('NEEDS_REAUTH');
    const g = await prisma.system.socialConnection.findUniqueOrThrow({ where: { id: googleConn.id } });
    expect(g).toMatchObject({ status: 'NEEDS_REAUTH', lastError: 'Refresh token revoked' });
    const yt = (await api(app, owner).get('/social/accounts').expect(200)).body.find((a: { platform: string }) => a.platform === 'YOUTUBE_CHANNEL');
    expect(yt.status).toBe('NEEDS_REAUTH');
  });

  it('verifies Meta webhooks and handles deauthorization and data deletion', async () => {
    const agent = api(app);
    await agent.get('/social/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345').expect(200).expect('12345');
    await api(app).get('/social/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1').expect(403);
    const body = JSON.stringify({ object: 'page', entry: [{ id: 'p1', time: 1, changes: [{ field: 'feed', value: { item: 'post' } }] }] });
    const sig = 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
    await raw().post('/api/v1/social/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body).expect(200);
    await raw().post('/api/v1/social/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=00').send(body).expect(401);
    const stored = await app.get(PrismaService).system.socialWebhookEvent.findFirst({ where: { objectId: 'p1', field: 'feed' } });
    expect(stored).not.toBeNull();

    const signed = (userId: string) => {
      const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: 1 })).toString('base64url');
      return `${createHmac('sha256', APP_SECRET).update(payload).digest('base64url')}.${payload}`;
    };
    await raw().post('/api/v1/social/meta/deauthorize').type('form').send({ signed_request: signed('meta-user-1') }).expect(200);
    const accounts = (await api(app, owner).get('/social/accounts').expect(200)).body.filter((a: { connection: { provider: string } }) => a.connection.provider === 'meta');
    expect(accounts.every((a: { status: string; connection: { status: string } }) => a.status === 'NEEDS_REAUTH' && a.connection.status === 'REVOKED')).toBe(true);
    await raw().post('/api/v1/social/meta/deauthorize').type('form').send({ signed_request: 'forged.payload' }).expect(400);

    const del = await raw().post('/api/v1/social/meta/data-deletion').type('form').send({ signed_request: signed('meta-user-1') }).expect(200);
    expect(del.body.url).toContain('/api/v1/social/meta/data-deletion/');
    expect((await api(app).get(new URL(del.body.url).pathname.replace('/api/v1', '')).expect(200)).body.status).toBe('completed');
    expect((await api(app, owner).get('/social/accounts').expect(200)).body.filter((a: { connection: { provider: string } }) => a.connection.provider === 'meta')).toEqual([]);
  });

  it('disconnects accounts and revokes the grant when the last one is removed', async () => {
    const u = await signUp(app, 'Disconnect Owner');
    await createOrg(app, u, 'Disconnect Org');
    const { location } = await connectVia(u, 'meta', 'c20');
    const connectionId = location.searchParams.get('connection')!;
    const added = (await api(app, u).post('/social/accounts', { connectionId, externalIds: ['p1', 'p2'] }).expect(201)).body;
    await api(app, u).delete(`/social/accounts/${added[0].id}`).expect(204);
    expect(meta.revoked).toEqual([]);
    await api(app, u).delete(`/social/accounts/${added[1].id}`).expect(204);
    expect(meta.revoked).toEqual(['access-c20']);
    expect(await app.get(PrismaService).system.socialConnection.findUnique({ where: { id: connectionId } })).toBeNull();
  });

  it('enforces the plan limit, permissions and tenant isolation', async () => {
    const u = await signUp(app, 'Small Social');
    const org2 = await createOrg(app, u, 'Small Social Org');
    await api(app, u).post('/billing/change-plan', { plan: 'FREE' }).expect(200); // 1 social account
    const { location } = await connectVia(u, 'meta', 'c30');
    const connectionId = location.searchParams.get('connection')!;
    expect((await api(app, u).post('/social/accounts', { connectionId, externalIds: ['p1', 'p2'] }).expect(402)).body.code).toBe('PLAN_LIMIT_REACHED');
    await api(app, u).post('/social/accounts', { connectionId, externalIds: ['p1'] }).expect(201);
    // Another organization cannot see or use this connection or account
    await api(app, owner).get(`/social/connections/${connectionId}/available`).expect(404);
    const theirs = (await api(app, u).get('/social/accounts').expect(200)).body[0];
    await api(app, owner).post(`/social/accounts/${theirs.id}/check`).expect(404);
    await api(app, owner).delete(`/social/accounts/${theirs.id}`).expect(404);
    expect(org2).toBeTruthy();

    const viewer = await signUp(app, 'Social Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    await api(app, viewer).get('/social/accounts').expect(200);
    await api(app, viewer).post('/social/connect/meta', {}).expect(403);
    const marketer = await signUp(app, 'Social Marketer');
    await inviteAndAccept(app, owner, marketer, orgId, 'marketing_manager');
    await api(app, marketer).post('/social/connect/meta', {}).expect(200);
  });
});
