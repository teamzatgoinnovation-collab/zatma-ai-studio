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
  type PublishMedia,
  type PublishRequest,
  type PublishResult,
  type SocialProvider,
} from './provider.js';

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

  // ───────────── Publishing (Phase 10): Images/Videos API + Posts API ─────────────

  private rest<T>(path: string, token: string, body: unknown): Promise<T> {
    return requestJson<T>(this.fetchImpl, this.api(path), {
      method: 'POST',
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      authErrors: isLinkedInAuthError,
    });
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const owner = typeof req.capabilities.urn === 'string' ? req.capabilities.urn : `urn:li:organization:${req.externalId}`;
    let postUrn = req.state.postUrn as string | undefined;
    if (!postUrn) {
      const images = req.media.filter((m) => m.kind === 'image');
      const video = req.media.find((m) => m.kind === 'video');
      let content: Record<string, unknown> | undefined;
      if (video) {
        const r = await this.uploadVideo(req, video, owner);
        if (r.status === 'processing') return r;
        content = { media: { id: r.urn } };
      } else if (images.length) {
        const urns = [...((req.state.imageUrns as string[] | undefined) ?? [])];
        for (let i = urns.length; i < images.length; i++) {
          urns.push(await this.uploadImage(req.token, images[i]!, owner));
          await req.saveState({ imageUrns: urns });
        }
        content =
          urns.length === 1
            ? { media: { id: urns[0], ...(images[0]!.altText ? { altText: images[0]!.altText } : {}) } }
            : { multiImage: { images: urns.map((id, i) => ({ id, ...(images[i]!.altText ? { altText: images[i]!.altText } : {}) })) } };
      }
      const res = await requestRaw(this.fetchImpl, this.api('/rest/posts'), {
        method: 'POST',
        headers: { ...this.headers(req.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: owner,
          commentary: toLittleText(req.text),
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          ...(content ? { content } : {}),
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
        authErrors: isLinkedInAuthError,
      });
      postUrn = res.headers.get('x-restli-id') ?? undefined;
      if (!postUrn) throw new ProviderError('LinkedIn did not return the post id', 422);
      await req.saveState({ postUrn });
    }
    return { status: 'published', externalId: postUrn, url: `https://www.linkedin.com/feed/update/${postUrn}` };
  }

  private async uploadImage(token: string, image: PublishMedia, owner: string): Promise<string> {
    const init = await this.rest<{ value: { uploadUrl: string; image: string } }>('/rest/images?action=initializeUpload', token, { initializeUploadRequest: { owner } });
    await requestRaw(this.fetchImpl, init.value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': image.mimeType },
      body: new Uint8Array(await image.read(0, image.sizeBytes - 1)),
      authErrors: isLinkedInAuthError,
    });
    return init.value.image;
  }

  /** Multipart video upload: initialize, PUT each part (collecting ETags), finalize, then wait for AVAILABLE. */
  private async uploadVideo(req: PublishRequest, video: PublishMedia, owner: string): Promise<{ status: 'ready'; urn: string } | { status: 'processing'; retryAfterMs: number }> {
    type Upload = { urn: string; uploadToken: string; parts: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>; etags: string[]; finalized?: boolean };
    let up = req.state.video as Upload | undefined;
    if (!up) {
      const init = await this.rest<{ value: { video: string; uploadToken?: string; uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> } }>(
        '/rest/videos?action=initializeUpload',
        req.token,
        { initializeUploadRequest: { owner, fileSizeBytes: video.sizeBytes, uploadCaptions: false, uploadThumbnail: false } },
      );
      up = { urn: init.value.video, uploadToken: init.value.uploadToken ?? '', parts: init.value.uploadInstructions, etags: [] };
      await req.saveState({ video: up });
    }
    if (!up.finalized) {
      for (let i = up.etags.length; i < up.parts.length; i++) {
        const part = up.parts[i]!;
        const res = await requestRaw(this.fetchImpl, part.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(await video.read(part.firstByte, part.lastByte)),
        });
        const etag = res.headers.get('etag');
        if (!etag) throw new ProviderError('LinkedIn did not return an ETag for an uploaded part', 502);
        up = { ...up, etags: [...up.etags, etag] };
        await req.saveState({ video: up });
      }
      await this.rest('/rest/videos?action=finalizeUpload', req.token, { finalizeUploadRequest: { video: up.urn, uploadToken: up.uploadToken, uploadedPartIds: up.etags } });
      up = { ...up, finalized: true };
      await req.saveState({ video: up });
    }
    const info = await requestJson<{ status?: string }>(this.fetchImpl, this.api(`/rest/videos/${encodeURIComponent(up.urn)}`), { headers: this.headers(req.token), authErrors: isLinkedInAuthError });
    if (info.status === 'AVAILABLE') return { status: 'ready', urn: up.urn };
    if (info.status === 'PROCESSING_FAILED') throw new ProviderError('LinkedIn could not process the video', 422);
    return { status: 'processing', retryAfterMs: 15_000 };
  }

  async revoke(accessToken: string): Promise<void> {
    await requestJson(this.fetchImpl, `${this.cfg.oauthUrl.replace(/\/$/, '')}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ token: accessToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
  }
}

/**
 * LinkedIn "little text" commentary: reserved characters are escaped and hashtags use the hashtag template,
 * otherwise `(`, `@` or `#` would be parsed as markup or dropped.
 */
export function toLittleText(text: string): string {
  const out: string[] = [];
  const re = /#([\p{L}\p{M}\p{N}_]+)/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(escapeLittle(text.slice(last, m.index)), `{hashtag|\\#|${m[1]}}`);
    last = m.index! + m[0].length;
  }
  out.push(escapeLittle(text.slice(last)));
  return out.join('');
}

const escapeLittle = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
