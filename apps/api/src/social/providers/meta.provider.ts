import { createHmac } from 'node:crypto';
import type { SocialPlatform } from '@zatma/validation';
import { form, ProviderAuthError, ProviderError, requestJson, type DiscoveredAccount, type FetchLike, type HealthResult, type OAuthGrant, type PublishRequest, type PublishResult, type SocialProvider } from './provider.js';

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
  readonly usesPkce = false;

  constructor(
    private readonly cfg: MetaConfig,
    private readonly fetchImpl: FetchLike = fetch,
    /** Permissions requested at login (the ads connection asks for the Marketing API scopes). */
    readonly scopes: string[] = META_SCOPES,
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

  // ───────────── Publishing (Phase 10) ─────────────

  private post<T>(path: string, token: string, body: Record<string, string | undefined>): Promise<T> {
    return requestJson<T>(this.fetchImpl, this.graph(path, {}, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(body),
      authErrors: isMetaAuthError,
    });
  }

  private get<T>(path: string, token: string, fields: string): Promise<T> {
    return requestJson<T>(this.fetchImpl, this.graph(path, { fields }, token), { authErrors: isMetaAuthError });
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    return req.platform === 'INSTAGRAM_BUSINESS' ? this.publishInstagram(req) : this.publishFacebook(req);
  }

  /** Page feed post, photo, multi-photo (unpublished photos attached to a feed post) or video. */
  private async publishFacebook(req: PublishRequest): Promise<PublishResult> {
    const { token, externalId: pageId, media, text } = req;
    let postId = req.state.postId as string | undefined;
    if (!postId) {
      const images = media.filter((m) => m.kind === 'image');
      const video = media.find((m) => m.kind === 'video');
      if (video) {
        const r = await this.post<{ id: string }>(`${pageId}/videos`, token, { file_url: await video.signedUrl(), description: text || undefined });
        postId = r.id;
      } else if (images.length === 1) {
        const r = await this.post<{ id: string; post_id?: string }>(`${pageId}/photos`, token, { url: await images[0]!.signedUrl(), caption: text || undefined, alt_text_custom: images[0]!.altText });
        postId = r.post_id ?? r.id;
      } else if (images.length > 1) {
        const photoIds = [...((req.state.photoIds as string[] | undefined) ?? [])];
        for (let i = photoIds.length; i < images.length; i++) {
          const r = await this.post<{ id: string }>(`${pageId}/photos`, token, { url: await images[i]!.signedUrl(), published: 'false', alt_text_custom: images[i]!.altText });
          photoIds.push(r.id);
          await req.saveState({ photoIds });
        }
        const r = await this.post<{ id: string }>(`${pageId}/feed`, token, { message: text || undefined, attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))) });
        postId = r.id;
      } else {
        const r = await this.post<{ id: string }>(`${pageId}/feed`, token, { message: text });
        postId = r.id;
      }
      await req.saveState({ postId });
    }
    return { status: 'published', externalId: postId, url: await this.permalink(postId, token, 'permalink_url') };
  }

  /** Content Publishing API: create container(s), wait until FINISHED, then media_publish. */
  private async publishInstagram(req: PublishRequest): Promise<PublishResult> {
    const { token, externalId: igId, media, text } = req;
    let mediaId = req.state.mediaId as string | undefined;
    if (!mediaId) {
      let containerId = req.state.containerId as string | undefined;
      if (!containerId) {
        const video = media.find((m) => m.kind === 'video');
        const images = media.filter((m) => m.kind === 'image');
        if (video) {
          containerId = (await this.post<{ id: string }>(`${igId}/media`, token, { media_type: 'REELS', video_url: await video.signedUrl(), caption: text || undefined, share_to_feed: 'true' })).id;
        } else if (images.length === 1) {
          containerId = (await this.post<{ id: string }>(`${igId}/media`, token, { image_url: await images[0]!.signedUrl(), caption: text || undefined, alt_text: images[0]!.altText })).id;
        } else if (images.length > 1) {
          const children = [...((req.state.children as string[] | undefined) ?? [])];
          for (let i = children.length; i < images.length; i++) {
            children.push((await this.post<{ id: string }>(`${igId}/media`, token, { image_url: await images[i]!.signedUrl(), is_carousel_item: 'true', alt_text: images[i]!.altText })).id);
            await req.saveState({ children });
          }
          containerId = (await this.post<{ id: string }>(`${igId}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: text || undefined })).id;
        } else {
          throw new ProviderError('Instagram posts need an image or a video', 422);
        }
        await req.saveState({ containerId });
      }
      const status = await this.get<{ status_code?: string; status?: string }>(containerId, token, 'status_code,status');
      if (status.status_code === 'IN_PROGRESS') return { status: 'processing', retryAfterMs: 10_000 };
      if (status.status_code === 'EXPIRED') {
        // Containers expire after 24 h: start over on the next attempt.
        await req.saveState({ containerId: null, children: null });
        throw new ProviderError('The Instagram upload expired before publishing', 503);
      }
      if (status.status_code === 'ERROR') throw new ProviderError(`Instagram could not process the media${status.status ? `: ${status.status}` : ''}`, 422);
      mediaId = (await this.post<{ id: string }>(`${igId}/media_publish`, token, { creation_id: containerId })).id;
      await req.saveState({ mediaId });
    }
    return { status: 'published', externalId: mediaId, url: await this.permalink(mediaId, token, 'permalink') };
  }

  /** Best-effort permalink (the post exists even if this lookup fails). */
  private async permalink(id: string, token: string, field: 'permalink_url' | 'permalink'): Promise<string | null> {
    try {
      const r = await this.get<Record<string, string | undefined>>(id, token, field);
      const link = r[field];
      if (!link) return null;
      return link.startsWith('/') ? `https://www.facebook.com${link}` : link;
    } catch {
      return null;
    }
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
