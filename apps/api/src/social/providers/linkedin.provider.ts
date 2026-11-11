import type { SocialPlatform } from '@zatma/validation';
import { expiresIn, form, ProviderAuthError, requestJson, type DiscoveredAccount, type FetchLike, type HealthResult, type OAuthGrant, type SocialProvider } from './provider.js';

export interface LinkedInConfig {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  apiUrl: string;
  oauthUrl: string;
}

/** Community Management API scopes for posting as an organization (Page). */
export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_organization_social', 'r_organization_social', 'rw_organization_admin'];

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

const isLinkedInAuthError = (status: number) => status === 401 || status === 403;

/** LinkedIn 3-legged OAuth; accounts are the organizations the member administers. */
export class LinkedInProvider implements SocialProvider {
  readonly id = 'linkedin' as const;
  readonly name = 'LinkedIn';
  readonly platforms: SocialPlatform[] = ['LINKEDIN_PAGE'];
  readonly scopes = LINKEDIN_SCOPES;
  readonly usesPkce = false;

  constructor(
    private readonly cfg: LinkedInConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'LinkedIn-Version': this.cfg.apiVersion, 'X-Restli-Protocol-Version': '2.0.0' };
  }

  private api(path: string): string {
    return `${this.cfg.apiUrl.replace(/\/$/, '')}${path}`;
  }

  authorizeUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
    const url = new URL(`${this.cfg.oauthUrl.replace(/\/$/, '')}/authorization`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.scopes.join(' '));
    return url.toString();
  }

  private async token(body: URLSearchParams): Promise<TokenResponse> {
    return requestJson<TokenResponse>(this.fetchImpl, `${this.cfg.oauthUrl.replace(/\/$/, '')}/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      authErrors: (s) => s === 400 || s === 401,
    });
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<OAuthGrant> {
    const t = await this.token(form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }));
    const me = await requestJson<{ sub: string; name?: string }>(this.fetchImpl, this.api('/v2/userinfo'), { headers: { Authorization: `Bearer ${t.access_token}` }, authErrors: isLinkedInAuthError });
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: expiresIn(t.expires_in),
      scopes: t.scope ? t.scope.split(/[ ,]+/).filter(Boolean) : this.scopes,
      externalUserId: me.sub,
      displayName: me.name ?? null,
    };
  }

  async refresh({ refreshToken }: { refreshToken: string }) {
    const t = await this.token(form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }));
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: expiresIn(t.expires_in), scopes: t.scope ? t.scope.split(/[ ,]+/).filter(Boolean) : this.scopes };
  }

  async listAccounts(accessToken: string): Promise<DiscoveredAccount[]> {
    const acls = await requestJson<{ elements: Array<{ organization: string; role: string; state: string }> }>(
      this.fetchImpl,
      this.api('/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100'),
      { headers: this.headers(accessToken), authErrors: isLinkedInAuthError },
    );
    const ids = [...new Set(acls.elements.map((e) => e.organization.split(':').pop()!).filter(Boolean))];
    const orgs = await Promise.all(
      ids.map((id) =>
        requestJson<{ id: number; localizedName: string; vanityName?: string }>(this.fetchImpl, this.api(`/rest/organizations/${encodeURIComponent(id)}`), {
          headers: this.headers(accessToken),
          authErrors: isLinkedInAuthError,
        }),
      ),
    );
    return orgs.map((o) => ({
      platform: 'LINKEDIN_PAGE' as const,
      externalId: String(o.id),
      name: o.localizedName,
      username: o.vanityName ?? null,
      avatarUrl: null,
      accountToken: null,
      capabilities: { urn: `urn:li:organization:${o.id}` },
    }));
  }

  async checkAccount({ externalId, token }: { platform: SocialPlatform; externalId: string; token: string }): Promise<HealthResult> {
    try {
      await requestJson(this.fetchImpl, this.api(`/rest/organizations/${encodeURIComponent(externalId)}`), { headers: this.headers(token), authErrors: isLinkedInAuthError });
      return { status: 'ACTIVE' };
    } catch (e) {
      if (e instanceof ProviderAuthError) return { status: 'NEEDS_REAUTH', error: e.message };
      return { status: 'ERROR', error: (e as Error).message };
    }
  }

  async revoke(accessToken: string): Promise<void> {
    await requestJson(this.fetchImpl, `${this.cfg.oauthUrl.replace(/\/$/, '')}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ token: accessToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
  }
}
