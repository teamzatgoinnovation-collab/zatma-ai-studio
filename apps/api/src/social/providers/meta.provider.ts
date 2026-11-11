import { createHmac } from 'node:crypto';
import type { SocialPlatform } from '@zatma/validation';
import { ProviderAuthError, requestJson, type DiscoveredAccount, type FetchLike, type HealthResult, type OAuthGrant, type SocialProvider } from './provider.js';

export interface MetaConfig {
  appId: string;
  appSecret: string;
  graphVersion: string;
  graphUrl: string;
  oauthUrl: string;
}

/** Permissions requested for Pages publishing and Instagram Business (content publishing in Phase 10). */
export const META_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata', 'instagram_basic', 'instagram_content_publish', 'business_management'];

interface GraphPage {
  id: string;
  name: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

/** Graph error code 190 = invalid/expired token; 10 and 200-299 = missing permissions. */
const isMetaAuthError = (status: number, body: unknown) => {
  const code = (body as { error?: { code?: number } } | null)?.error?.code;
  return status === 401 || code === 190 || code === 10 || (typeof code === 'number' && code >= 200 && code < 300);
};

/**
 * Facebook Login for Business: Pages (with page access tokens) and the Instagram Business accounts linked to them.
 * Every Graph call carries `appsecret_proof` so a leaked token cannot be used without the app secret.
 */
export class MetaProvider implements SocialProvider {
  readonly id = 'meta' as const;
  readonly name = 'Facebook & Instagram';
  readonly platforms: SocialPlatform[] = ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS'];
  readonly scopes = META_SCOPES;
  readonly usesPkce = false;

  constructor(
    private readonly cfg: MetaConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private graph(path: string, params: Record<string, string>, token?: string): string {
    const url = new URL(`${this.cfg.graphUrl.replace(/\/$/, '')}/${this.cfg.graphVersion}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (token) {
      url.searchParams.set('access_token', token);
      url.searchParams.set('appsecret_proof', this.proof(token));
    }
    return url.toString();
  }

  proof(token: string): string {
    return createHmac('sha256', this.cfg.appSecret).update(token).digest('hex');
  }

  authorizeUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
    const url = new URL(`${this.cfg.oauthUrl.replace(/\/$/, '')}/${this.cfg.graphVersion}/dialog/oauth`);
    url.searchParams.set('client_id', this.cfg.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes.join(','));
    return url.toString();
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<OAuthGrant> {
    const short = await requestJson<{ access_token: string }>(this.fetchImpl, this.graph('oauth/access_token', { client_id: this.cfg.appId, client_secret: this.cfg.appSecret, redirect_uri: redirectUri, code }), {
      authErrors: isMetaAuthError,
    });
    // Upgrade to a long-lived user token (~60 days); page tokens derived from it do not expire.
    const long = await requestJson<{ access_token: string; expires_in?: number }>(
      this.fetchImpl,
      this.graph('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: this.cfg.appId, client_secret: this.cfg.appSecret, fb_exchange_token: short.access_token }),
      { authErrors: isMetaAuthError },
    );
    const token = long.access_token;
    const [me, perms] = await Promise.all([
      requestJson<{ id: string; name?: string }>(this.fetchImpl, this.graph('me', { fields: 'id,name' }, token), { authErrors: isMetaAuthError }),
      requestJson<{ data: Array<{ permission: string; status: string }> }>(this.fetchImpl, this.graph('me/permissions', {}, token), { authErrors: isMetaAuthError }),
    ]);
    return {
      accessToken: token,
      refreshToken: null,
      expiresAt: typeof long.expires_in === 'number' ? new Date(Date.now() + long.expires_in * 1000) : new Date(Date.now() + 60 * 86_400_000),
      scopes: perms.data.filter((p) => p.status === 'granted').map((p) => p.permission),
      externalUserId: me.id,
      displayName: me.name ?? null,
    };
  }

  async listAccounts(accessToken: string): Promise<DiscoveredAccount[]> {
    const out: DiscoveredAccount[] = [];
    let url: string | null = this.graph('me/accounts', { fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}', limit: '100' }, accessToken);
    for (let page = 0; url && page < 10; page++) {
      const res: { data: GraphPage[]; paging?: { next?: string } } = await requestJson(this.fetchImpl, url, { authErrors: isMetaAuthError });
      for (const p of res.data) {
        out.push({ platform: 'FACEBOOK_PAGE', externalId: p.id, name: p.name, username: null, avatarUrl: p.picture?.data?.url ?? null, accountToken: p.access_token ?? null, capabilities: { tasks: 'pages' } });
        const ig = p.instagram_business_account;
        if (ig) {
          out.push({
            platform: 'INSTAGRAM_BUSINESS',
            externalId: ig.id,
            name: ig.name || ig.username || p.name,
            username: ig.username ?? null,
            avatarUrl: ig.profile_picture_url ?? null,
            // Instagram Graph API calls are made with the linked Page's token.
            accountToken: p.access_token ?? null,
            capabilities: { pageId: p.id },
          });
        }
      }
      url = res.paging?.next ?? null;
    }
    return out;
  }

  async checkAccount({ platform, externalId, token }: { platform: SocialPlatform; externalId: string; token: string }): Promise<HealthResult> {
    try {
      await requestJson(this.fetchImpl, this.graph(externalId, { fields: platform === 'INSTAGRAM_BUSINESS' ? 'id,username' : 'id,name' }, token), { authErrors: isMetaAuthError });
      return { status: 'ACTIVE' };
    } catch (e) {
      if (e instanceof ProviderAuthError) return { status: 'NEEDS_REAUTH', error: e.message };
      return { status: 'ERROR', error: (e as Error).message };
    }
  }

  async revoke(accessToken: string): Promise<void> {
    await requestJson(this.fetchImpl, this.graph('me/permissions', {}, accessToken), { method: 'DELETE', authErrors: isMetaAuthError });
  }
}

/** Parses and verifies a Meta `signed_request` (deauthorize / data-deletion callbacks). */
export function parseSignedRequest(signedRequest: string, appSecret: string): { user_id?: string; algorithm?: string; issued_at?: number } | null {
  const [sig, payload] = signedRequest.split('.');
  if (!sig || !payload) return null;
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafe(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { algorithm?: string; user_id?: string; issued_at?: number };
    return data.algorithm?.toUpperCase() === 'HMAC-SHA256' ? data : null;
  } catch {
    return null;
  }
}

/** Verifies `X-Hub-Signature-256: sha256=<hex>` over the raw webhook body. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafe(given, expected);
}

function timingSafe(a: Buffer, b: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
