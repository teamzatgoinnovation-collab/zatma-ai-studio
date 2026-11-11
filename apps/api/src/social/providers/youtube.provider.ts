import type { SocialPlatform } from '@zatma/validation';
import {
  expiresIn,
  form,
  ProviderAuthError,
  ProviderError,
  requestJson,
  requestRaw,
  type DiscoveredAccount,
  type FetchLike,
  type HealthResult,
  type OAuthGrant,
  type PublishRequest,
  type PublishResult,
  type SocialProvider,
} from './provider.js';

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  apiUrl: string;
  /** Resumable upload endpoint (https://www.googleapis.com/upload/youtube/v3). */
  uploadUrl: string;
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

  // ───────────── Publishing (Phase 10): resumable upload ─────────────

  async publish(req: PublishRequest): Promise<PublishResult> {
    let videoId = req.state.videoId as string | undefined;
    if (!videoId) {
      const video = req.media.find((m) => m.kind === 'video');
      if (!video) throw new ProviderError('YouTube needs a video', 422);
      const auth = { Authorization: `Bearer ${req.token}` };
      let session = req.state.uploadUrl as string | undefined;
      let offset = 0;
      if (session) {
        // Ask where the interrupted upload stopped.
        const probe = await requestRaw(this.fetchImpl, session, {
          method: 'PUT',
          headers: { ...auth, 'Content-Range': `bytes */${video.sizeBytes}`, 'Content-Length': '0' },
          okStatuses: [308, 404, 410],
          authErrors: (s) => s === 401,
        });
        if (probe.status === 404 || probe.status === 410) {
          session = undefined;
          await req.saveState({ uploadUrl: null });
        } else if (probe.status === 308) {
          offset = nextOffset(probe.headers.get('range'));
        } else {
          videoId = (probe.body as { id: string }).id;
        }
      }
      if (!videoId && !session) {
        const tags = req.hashtags.map((t) => t.replace(/^#/, '')).filter(Boolean).slice(0, 30);
        const init = await requestRaw(this.fetchImpl, `${this.cfg.uploadUrl.replace(/\/$/, '')}/videos?uploadType=resumable&part=snippet,status`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': video.mimeType, 'X-Upload-Content-Length': String(video.sizeBytes) },
          body: JSON.stringify({
            snippet: { title: req.options.title ?? 'Untitled', description: req.text, tags, categoryId: '22' },
            status: { privacyStatus: req.options.privacy ?? 'private', selfDeclaredMadeForKids: req.options.madeForKids ?? false, embeddable: true },
          }),
          authErrors: (s, b) => s === 401 || (s === 403 && JSON.stringify(b).includes('insufficientPermissions')),
        });
        session = init.headers.get('location') ?? undefined;
        if (!session) throw new ProviderError('YouTube did not return an upload session', 502);
        await req.saveState({ uploadUrl: session });
      }
      while (!videoId) {
        const end = Math.min(offset + UPLOAD_CHUNK_BYTES, video.sizeBytes) - 1;
        const res = await requestRaw(this.fetchImpl, session!, {
          method: 'PUT',
          headers: { ...auth, 'Content-Type': video.mimeType, 'Content-Range': `bytes ${offset}-${end}/${video.sizeBytes}` },
          body: new Uint8Array(await video.read(offset, end)),
          okStatuses: [308],
          authErrors: (s) => s === 401,
        });
        if (res.status === 308) offset = nextOffset(res.headers.get('range'));
        else videoId = (res.body as { id: string }).id;
      }
      await req.saveState({ videoId, uploadUrl: null });
    }
    return { status: 'published', externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
  }

  async revoke(accessToken: string): Promise<void> {
    await requestJson(this.fetchImpl, `${this.cfg.revokeUrl}?token=${encodeURIComponent(accessToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  }
}

/** 8 MiB: chunks must be multiples of 256 KiB (except the last). */
export const UPLOAD_CHUNK_BYTES = 32 * 256 * 1024;

/** Next byte to send from a resumable-upload `Range: bytes=0-N` header (none means nothing stored yet). */
function nextOffset(range: string | null): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}
