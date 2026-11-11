import type { SocialPlatform } from '@zatma/validation';
import { expiresIn, form, ProviderAuthError, requestJson, type DiscoveredAccount, type FetchLike, type HealthResult, type OAuthGrant, type SocialProvider } from './provider.js';

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  apiUrl: string;
}

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload'];

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface ChannelList {
  items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }>;
}

/** Google OAuth (offline access + PKCE) for YouTube channels. Separate client from Google sign-in. */
export class YouTubeProvider implements SocialProvider {
  readonly id = 'google' as const;
  readonly name = 'YouTube';
  readonly platforms: SocialPlatform[] = ['YOUTUBE_CHANNEL'];
  readonly scopes = YOUTUBE_SCOPES;
  readonly usesPkce = true;

  constructor(
    private readonly cfg: YouTubeConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  authorizeUrl({ state, redirectUri, codeChallenge }: { state: string; redirectUri: string; codeChallenge?: string }): string {
    const url = new URL(this.cfg.authUrl);
    url.searchParams.set('client_id', this.cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  private async token(body: URLSearchParams): Promise<TokenResponse> {
    return requestJson<TokenResponse>(this.fetchImpl, this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      // invalid_grant (revoked/expired refresh token) comes back as 400.
      authErrors: (s, b) => s === 401 || (s === 400 && (b as { error?: string } | null)?.error === 'invalid_grant'),
    });
  }

  private async channels(token: string, query: string): Promise<ChannelList> {
    return requestJson<ChannelList>(this.fetchImpl, `${this.cfg.apiUrl.replace(/\/$/, '')}/channels?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      authErrors: (s) => s === 401 || s === 403,
    });
  }

  async exchangeCode({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthGrant> {
    const t = await this.token(form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, code_verifier: codeVerifier }));
    const list = await this.channels(t.access_token, 'part=snippet&mine=true&maxResults=50');
    const first = list.items?.[0];
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: expiresIn(t.expires_in),
      scopes: t.scope ? t.scope.split(' ').filter(Boolean) : this.scopes,
      externalUserId: first?.id ?? 'youtube-user',
      displayName: first?.snippet?.title ?? null,
    };
  }

  async refresh({ refreshToken }: { refreshToken: string }) {
    const t = await this.token(form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }));
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: expiresIn(t.expires_in), scopes: t.scope ? t.scope.split(' ').filter(Boolean) : this.scopes };
  }

  async listAccounts(accessToken: string): Promise<DiscoveredAccount[]> {
    const list = await this.channels(accessToken, 'part=snippet&mine=true&maxResults=50');
    return (list.items ?? []).map((c) => ({
      platform: 'YOUTUBE_CHANNEL' as const,
      externalId: c.id,
      name: c.snippet?.title ?? c.id,
      username: c.snippet?.customUrl ?? null,
      avatarUrl: c.snippet?.thumbnails?.default?.url ?? null,
      accountToken: null,
      capabilities: {},
    }));
  }

  async checkAccount({ externalId, token }: { platform: SocialPlatform; externalId: string; token: string }): Promise<HealthResult> {
    try {
      const list = await this.channels(token, `part=id&id=${encodeURIComponent(externalId)}`);
      return list.items?.length ? { status: 'ACTIVE' } : { status: 'ERROR', error: 'Channel not found' };
    } catch (e) {
      if (e instanceof ProviderAuthError) return { status: 'NEEDS_REAUTH', error: e.message };
      return { status: 'ERROR', error: (e as Error).message };
    }
  }

  async revoke(accessToken: string): Promise<void> {
    await requestJson(this.fetchImpl, `${this.cfg.revokeUrl}?token=${encodeURIComponent(accessToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  }
}
