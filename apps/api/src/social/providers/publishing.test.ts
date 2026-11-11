import { describe, expect, it } from 'vitest';
import { LinkedInProvider, toLittleText } from './linkedin.provider.js';
import { MetaProvider } from './meta.provider.js';
import { isRetryable, ProviderAuthError, ProviderError, type FetchLike, type PublishMedia, type PublishRequest } from './provider.js';
import { UPLOAD_CHUNK_BYTES, YouTubeProvider } from './youtube.provider.js';

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Route = (url: URL, init: RequestInit) => Reply | undefined;
function fakeFetch(routes: Route[]) {
  const calls: Array<{ method: string; url: URL; init: RequestInit; form?: Record<string, string> }> = [];
  const impl: FetchLike = async (u, init = {}) => {
    const url = new URL(u);
    const form = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', url, init, form });
    for (const r of routes) {
      const res = r(url, init);
      if (res) return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json', ...res.headers } });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${init.method ?? 'GET'} ${url.pathname}` } }), { status: 404 });
  };
  return { impl, calls };
}

const bytes = (n: number) => Buffer.alloc(n, 7);
function media(kind: 'image' | 'video', i = 0, sizeBytes = 1000): PublishMedia {
  const body = bytes(sizeBytes);
  return {
    kind,
    mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
    width: 1080,
    height: 1080,
    durationSec: kind === 'video' ? 30 : undefined,
    sizeBytes,
    altText: kind === 'image' ? `alt ${i}` : undefined,
    signedUrl: async () => `https://storage.test/${kind}${i}?sig=1`,
    read: async (s, e) => body.subarray(s, e + 1),
  };
}
function request(over: Partial<PublishRequest>): PublishRequest & { saved: Record<string, unknown> } {
  const saved: Record<string, unknown> = { ...(over.state ?? {}) };
  return {
    platform: 'FACEBOOK_PAGE',
    externalId: 'page1',
    capabilities: {},
    token: 'tok',
    text: 'Onam offers! #Onam',
    hashtags: ['#Onam'],
    media: [],
    options: {},
    ...over,
    state: saved,
    saved,
    saveState: async (patch) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete saved[k];
        else saved[k] = v;
      }
    },
  };
}

const META = { appId: 'app1', appSecret: 'secret1', graphVersion: 'v24.0', graphUrl: 'https://graph.test', oauthUrl: 'https://www.fb.test' };
const G = (path: string) => (u: URL) => u.pathname === `/v24.0/${path}`;

describe('Facebook publishing', () => {
  it('posts text to the Page feed with appsecret_proof and returns the permalink', async () => {
    const f = fakeFetch([
      (u, i) => (G('page1/feed')(u) && i.method === 'POST' ? { body: { id: 'page1_99' } } : undefined),
      (u) => (G('page1_99')(u) ? { body: { permalink_url: 'https://www.facebook.com/page1/posts/99' } } : undefined),
    ]);
    const req = request({});
    const r = await new MetaProvider(META, f.impl).publish(req);
    expect(r).toEqual({ status: 'published', externalId: 'page1_99', url: 'https://www.facebook.com/page1/posts/99' });
    expect(f.calls[0]!.form).toEqual({ message: 'Onam offers! #Onam' });
    expect(f.calls[0]!.url.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
    expect(req.saved.postId).toBe('page1_99');
  });

  it('attaches several unpublished photos to one feed post and resumes after a failure', async () => {
    let photo = 0;
    let failFeed = true;
    const f = fakeFetch([
      (u, i) => (G('page1/photos')(u) && i.method === 'POST' ? { body: { id: `ph${++photo}` } } : undefined),
      (u, i) => {
        if (!G('page1/feed')(u) || i.method !== 'POST') return undefined;
        if (failFeed) {
          failFeed = false;
          return { status: 500, body: { error: { message: 'An unexpected error has occurred', code: 2, is_transient: true } } };
        }
        return { body: { id: 'page1_7' } };
      },
      (u) => (G('page1_7')(u) ? { body: { permalink_url: '/page1/posts/7' } } : undefined),
    ]);
    const meta = new MetaProvider(META, f.impl);
    const req = request({ media: [media('image', 0), media('image', 1), media('image', 2)] });
    const err = await meta.publish(req).catch((e) => e);
    expect(isRetryable(err)).toBe(true);
    expect(req.saved.photoIds).toEqual(['ph1', 'ph2', 'ph3']);
    const r = await meta.publish(req);
    expect(photo).toBe(3); // photos were not uploaded twice
    expect(r).toMatchObject({ externalId: 'page1_7', url: 'https://www.facebook.com/page1/posts/7' });
    const feed = f.calls.filter((c) => c.url.pathname.endsWith('/feed')).at(-1)!;
    expect(JSON.parse(feed.form!.attached_media!)).toEqual([{ media_fbid: 'ph1' }, { media_fbid: 'ph2' }, { media_fbid: 'ph3' }]);
    expect(f.calls.filter((c) => c.url.pathname.endsWith('/photos')).every((c) => c.form!.published === 'false')).toBe(true);
  });

  it('uploads video by URL and maps token errors to re-auth', async () => {
    const f = fakeFetch([(u) => (G('page1/videos')(u) ? { body: { id: 'v1' } } : undefined), (u) => (G('v1')(u) ? { body: { permalink_url: '/reel/v1' } } : undefined)]);
    const r = await new MetaProvider(META, f.impl).publish(request({ media: [media('video')] }));
    expect(r).toMatchObject({ externalId: 'v1', url: 'https://www.facebook.com/reel/v1' });
    expect(f.calls[0]!.form).toMatchObject({ file_url: 'https://storage.test/video0?sig=1', description: 'Onam offers! #Onam' });
    const bad = fakeFetch([() => ({ status: 400, body: { error: { message: 'Session has expired', code: 190 } } })]);
    await expect(new MetaProvider(META, bad.impl).publish(request({}))).rejects.toBeInstanceOf(ProviderAuthError);
  });
});

describe('Instagram publishing', () => {
  it('creates a carousel container, waits while processing, then publishes once', async () => {
    let child = 0;
    let status = 'IN_PROGRESS';
    let published = 0;
    const f = fakeFetch([
      (u, i) => {
        if (!G('ig1/media')(u) || i.method !== 'POST') return undefined;
        const form = Object.fromEntries(i.body as URLSearchParams);
        return { body: { id: form.media_type === 'CAROUSEL' ? 'carousel1' : `c${++child}` } };
      },
      (u) => (G('carousel1')(u) ? { body: { status_code: status } } : undefined),
      (u) => (G('ig1/media_publish')(u) ? (published++, { body: { id: 'm1' } }) : undefined),
      (u) => (G('m1')(u) ? { body: { permalink: 'https://www.instagram.com/p/abc/' } } : undefined),
    ]);
    const meta = new MetaProvider(META, f.impl);
    const req = request({ platform: 'INSTAGRAM_BUSINESS', externalId: 'ig1', media: [media('image', 0), media('image', 1)] });
    expect(await meta.publish(req)).toEqual({ status: 'processing', retryAfterMs: 10_000 });
    expect(req.saved).toMatchObject({ children: ['c1', 'c2'], containerId: 'carousel1' });
    status = 'FINISHED';
    expect(await meta.publish(req)).toEqual({ status: 'published', externalId: 'm1', url: 'https://www.instagram.com/p/abc/' });
    expect(await meta.publish(req)).toMatchObject({ externalId: 'm1' });
    expect([child, published]).toEqual([2, 1]);
    const carousel = f.calls.find((c) => c.form?.media_type === 'CAROUSEL')!;
    expect(carousel.form).toMatchObject({ children: 'c1,c2', caption: 'Onam offers! #Onam' });
    expect(f.calls.filter((c) => c.form?.is_carousel_item === 'true').map((c) => c.form!.image_url)).toEqual(['https://storage.test/image0?sig=1', 'https://storage.test/image1?sig=1']);
  });

  it('publishes Reels and restarts expired containers', async () => {
    let n = 0;
    const f = fakeFetch([
      (u, i) => (G('ig1/media')(u) && i.method === 'POST' ? { body: { id: `r${++n}` } } : undefined),
      (u) => (G('r1')(u) ? { body: { status_code: 'EXPIRED' } } : undefined),
      (u) => (G('r2')(u) ? { body: { status_code: 'FINISHED' } } : undefined),
      (u) => (G('ig1/media_publish')(u) ? { body: { id: 'm2' } } : undefined),
      (u) => (G('m2')(u) ? { body: { permalink: 'https://www.instagram.com/reel/x/' } } : undefined),
    ]);
    const meta = new MetaProvider(META, f.impl);
    const req = request({ platform: 'INSTAGRAM_BUSINESS', externalId: 'ig1', media: [media('video')] });
    const err = await meta.publish(req).catch((e) => e);
    expect(isRetryable(err)).toBe(true);
    expect(req.saved.containerId).toBeUndefined();
    expect(await meta.publish(req)).toMatchObject({ externalId: 'm2' });
    expect(f.calls[0]!.form).toMatchObject({ media_type: 'REELS', video_url: 'https://storage.test/video0?sig=1', share_to_feed: 'true' });
  });

  it('fails permanently when Instagram rejects the media', async () => {
    const f = fakeFetch([(u, i) => (G('ig1/media')(u) && i.method === 'POST' ? { body: { id: 'c1' } } : undefined), (u) => (G('c1')(u) ? { body: { status_code: 'ERROR', status: 'Unsupported aspect ratio' } } : undefined)]);
    const err = await new MetaProvider(META, f.impl).publish(request({ platform: 'INSTAGRAM_BUSINESS', externalId: 'ig1', media: [media('image')] })).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(isRetryable(err)).toBe(false);
    expect(err.message).toContain('Unsupported aspect ratio');
  });
});

const LI = { clientId: 'li', clientSecret: 'ls', apiVersion: '202510', apiUrl: 'https://api.li.test', oauthUrl: 'https://www.li.test/oauth/v2' };

describe('LinkedIn publishing', () => {
  it('escapes little-text commentary and keeps hashtags', () => {
    expect(toLittleText('Offer (today) @ 50% off! #Onam_2026 #കേരളം')).toBe('Offer \\(today\\) \\@ 50% off! {hashtag|\\#|Onam_2026} {hashtag|\\#|കേരളം}');
  });

  it('uploads images, then creates a multi-image organization post', async () => {
    let img = 0;
    const f = fakeFetch([
      (u) => (u.pathname === '/rest/images' && u.searchParams.get('action') === 'initializeUpload' ? { body: { value: { uploadUrl: `https://upload.li.test/img${++img}`, image: `urn:li:image:I${img}` } } } : undefined),
      (u, i) => (u.host === 'upload.li.test' && i.method === 'PUT' ? { status: 201 } : undefined),
      (u, i) => (u.pathname === '/rest/posts' && i.method === 'POST' ? { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } } : undefined),
    ]);
    const req = request({ platform: 'LINKEDIN_PAGE', externalId: '77001', capabilities: { urn: 'urn:li:organization:77001' }, media: [media('image', 0), media('image', 1)] });
    const r = await new LinkedInProvider(LI, f.impl).publish(req);
    expect(r).toEqual({ status: 'published', externalId: 'urn:li:share:123', url: 'https://www.linkedin.com/feed/update/urn:li:share:123' });
    const post = f.calls.find((c) => c.url.pathname === '/rest/posts')!;
    expect(new Headers(post.init.headers).get('linkedin-version')).toBe('202510');
    expect(JSON.parse(post.init.body as string)).toMatchObject({
      author: 'urn:li:organization:77001',
      commentary: 'Onam offers! {hashtag|\\#|Onam}',
      lifecycleState: 'PUBLISHED',
      content: { multiImage: { images: [{ id: 'urn:li:image:I1', altText: 'alt 0' }, { id: 'urn:li:image:I2', altText: 'alt 1' }] } },
    });
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ initializeUploadRequest: { owner: 'urn:li:organization:77001' } });
  });

  it('uploads video parts with ETags, finalizes, waits for AVAILABLE and resumes', async () => {
    let videoStatus = 'PROCESSING';
    let failPart2 = true;
    const f = fakeFetch([
      (u) =>
        u.pathname === '/rest/videos' && u.searchParams.get('action') === 'initializeUpload'
          ? { body: { value: { video: 'urn:li:video:V1', uploadToken: 'ut', uploadInstructions: [{ uploadUrl: 'https://upload.li.test/p1', firstByte: 0, lastByte: 599 }, { uploadUrl: 'https://upload.li.test/p2', firstByte: 600, lastByte: 999 }] } } }
          : undefined,
      (u) => (u.pathname === '/p1' ? { status: 200, headers: { etag: 'e1' } } : undefined),
      (u) => {
        if (u.pathname !== '/p2') return undefined;
        if (failPart2) {
          failPart2 = false;
          return { status: 503, body: { message: 'Service unavailable' } };
        }
        return { status: 200, headers: { etag: 'e2' } };
      },
      (u) => (u.pathname === '/rest/videos' && u.searchParams.get('action') === 'finalizeUpload' ? { status: 200, body: {} } : undefined),
      (u) => (u.pathname === `/rest/videos/${encodeURIComponent('urn:li:video:V1')}` || u.pathname === '/rest/videos/urn:li:video:V1' ? { body: { status: videoStatus } } : undefined),
      (u) => (u.pathname === '/rest/posts' ? { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } } : undefined),
    ]);
    const li = new LinkedInProvider(LI, f.impl);
    const req = request({ platform: 'LINKEDIN_PAGE', externalId: '77001', media: [media('video', 0, 1000)] });
    expect(isRetryable(await li.publish(req).catch((e) => e))).toBe(true);
    expect((req.saved.video as { etags: string[] }).etags).toEqual(['e1']);
    expect(await li.publish(req)).toEqual({ status: 'processing', retryAfterMs: 15_000 });
    videoStatus = 'AVAILABLE';
    expect(await li.publish(req)).toMatchObject({ externalId: 'urn:li:share:9' });
    expect(f.calls.filter((c) => c.url.pathname === '/p1')).toHaveLength(1);
    const p2 = f.calls.filter((c) => c.url.pathname === '/p2').at(-1)!;
    expect((p2.init.body as Uint8Array).length).toBe(400);
    const fin = f.calls.find((c) => c.url.searchParams.get('action') === 'finalizeUpload')!;
    expect(JSON.parse(fin.init.body as string)).toEqual({ finalizeUploadRequest: { video: 'urn:li:video:V1', uploadToken: 'ut', uploadedPartIds: ['e1', 'e2'] } });
    expect(f.calls.filter((c) => c.url.searchParams.get('action') === 'finalizeUpload')).toHaveLength(1);
  });
});

const YT = { clientId: 'g1', clientSecret: 'gs', authUrl: 'https://a.test', tokenUrl: 'https://t.test', revokeUrl: 'https://r.test', apiUrl: 'https://yt.test/youtube/v3', uploadUrl: 'https://upload.yt.test/youtube/v3' };

describe('YouTube publishing', () => {
  it('starts a resumable session, uploads in chunks and resumes from the stored session', async () => {
    const size = UPLOAD_CHUNK_BYTES + 5_000;
    let received = 0;
    let dropSecond = true;
    const f = fakeFetch([
      (u, i) => (u.host === 'upload.yt.test' && i.method === 'POST' ? { status: 200, headers: { location: 'https://upload.yt.test/session/abc' } } : undefined),
      (u, i) => {
        if (u.pathname !== '/session/abc' || i.method !== 'PUT') return undefined;
        const range = new Headers(i.headers).get('content-range')!;
        if (range.startsWith('bytes */')) return { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : ({} as Record<string, string>) };
        const [, start, end] = range.match(/bytes (\d+)-(\d+)\//)!.map(Number) as [number, number, number];
        if (start === UPLOAD_CHUNK_BYTES && dropSecond) {
          dropSecond = false;
          return { status: 503, body: { error: { message: 'Backend Error' } } };
        }
        received = end + 1;
        return received < size ? { status: 308, headers: { range: `bytes=0-${end}` } } : { status: 201, body: { id: 'vid123' } };
      },
    ]);
    const yt = new YouTubeProvider(YT, f.impl);
    const req = request({ platform: 'YOUTUBE_CHANNEL', externalId: 'UC1', media: [media('video', 0, size)], options: { title: 'Kochi store tour', privacy: 'unlisted', madeForKids: false } });
    expect(isRetryable(await yt.publish(req).catch((e) => e))).toBe(true);
    expect(req.saved.uploadUrl).toBe('https://upload.yt.test/session/abc');
    expect(await yt.publish(req)).toEqual({ status: 'published', externalId: 'vid123', url: 'https://www.youtube.com/watch?v=vid123' });
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    const init = f.calls[0]!;
    expect(init.url.searchParams.get('uploadType')).toBe('resumable');
    expect(new Headers(init.init.headers).get('x-upload-content-length')).toBe(String(size));
    expect(JSON.parse(init.init.body as string)).toEqual({
      snippet: { title: 'Kochi store tour', description: 'Onam offers! #Onam', tags: ['Onam'], categoryId: '22' },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, embeddable: true },
    });
    expect(req.saved).toMatchObject({ videoId: 'vid123' });
    expect(req.saved.uploadUrl).toBeUndefined();
  });

  it('starts over when the upload session expired', async () => {
    const f = fakeFetch([
      (u, i) => (u.pathname === '/session/old' && i.method === 'PUT' ? { status: 404, body: { error: { message: 'gone' } } } : undefined),
      (u, i) => (u.host === 'upload.yt.test' && i.method === 'POST' ? { status: 200, headers: { location: 'https://upload.yt.test/session/new' } } : undefined),
      (u, i) => (u.pathname === '/session/new' && i.method === 'PUT' ? { status: 200, body: { id: 'v2' } } : undefined),
    ]);
    const req = request({ platform: 'YOUTUBE_CHANNEL', externalId: 'UC1', media: [media('video')], options: { title: 'T', privacy: 'public', madeForKids: false }, state: { uploadUrl: 'https://upload.yt.test/session/old' } });
    expect(await new YouTubeProvider(YT, f.impl).publish(req)).toMatchObject({ externalId: 'v2' });
  });
});

describe('error classification', () => {
  it('retries outages and throttling, not auth or validation errors', () => {
    expect(isRetryable(new ProviderError('x'))).toBe(true);
    expect(isRetryable(new ProviderError('x', 429))).toBe(true);
    expect(isRetryable(new ProviderError('x', 502))).toBe(true);
    expect(isRetryable(new ProviderError('x', 400, { error: { code: 32 } }))).toBe(true);
    expect(isRetryable(new ProviderError('x', 400, { error: { code: 100 } }))).toBe(false);
    expect(isRetryable(new ProviderAuthError('x'))).toBe(false);
    expect(isRetryable(new Error('x'))).toBe(false);
  });
});
