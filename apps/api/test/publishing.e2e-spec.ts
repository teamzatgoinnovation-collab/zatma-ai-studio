import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SocialPlatform } from '@zatma/validation';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PublishingService } from '../src/publishing/publishing.service.js';
import { PublishingWorkerService } from '../src/publishing/publishing.worker.js';
import { ProviderAuthError, ProviderError, type DiscoveredAccount, type OAuthGrant, type PublishRequest, type PublishResult, type SocialProvider } from '../src/social/providers/provider.js';
import { SocialProviderRegistry } from '../src/social/social-registry.js';
import { TokenCipher } from '../src/social/token-cipher.js';
import { createTestApp, MemoryObjectStorage } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, waitForEmail, type TestUser } from './helpers.js';

const KEY = `k1:${randomBytes(32).toString('base64')}`;

type Outcome = 'ok' | 'retry' | 'permanent' | 'auth' | 'processing';

/** Platform stand-in: records every publish call and follows a per-account script of outcomes. */
class FakePublisher implements SocialProvider {
  readonly name: string;
  readonly scopes = ['publish'];
  readonly usesPkce = false;
  accounts: DiscoveredAccount[] = [];
  script = new Map<string, Outcome[]>();
  calls: Array<{ externalId: string; text: string; urls: string[]; options: unknown; state: Record<string, unknown>; token: string }> = [];
  private n = 0;
  constructor(
    readonly id: 'meta' | 'linkedin' | 'google',
    readonly platforms: SocialPlatform[],
  ) {
    this.name = id;
  }
  authorizeUrl({ state }: { state: string }) {
    return `https://auth.fake/${this.id}?state=${state}`;
  }
  async exchangeCode({ code }: { code: string }): Promise<OAuthGrant> {
    return { accessToken: `access-${this.id}-${code}`, refreshToken: null, expiresAt: new Date(Date.now() + 30 * 86_400_000), scopes: this.scopes, externalUserId: `${this.id}-user`, displayName: 'Zain' };
  }
  async listAccounts() {
    return this.accounts;
  }
  async checkAccount() {
    return { status: 'ACTIVE' as const };
  }
  async revoke() {}
  async publish(req: PublishRequest): Promise<PublishResult> {
    const outcome = this.script.get(req.externalId)?.shift() ?? 'ok';
    const urls = await Promise.all(req.media.map((m) => m.signedUrl()));
    this.calls.push({ externalId: req.externalId, text: req.text, urls, options: req.options, state: { ...req.state }, token: req.token });
    if (outcome === 'retry') {
      await req.saveState({ uploaded: true });
      throw new ProviderError('Service temporarily unavailable', 503);
    }
    if (outcome === 'permanent') throw new ProviderError('Unsupported media type', 400);
    if (outcome === 'auth') throw new ProviderAuthError('Error validating access token: Session has expired');
    if (outcome === 'processing') {
      await req.saveState({ containerId: 'c1' });
      return { status: 'processing', retryAfterMs: 200 };
    }
    const id = `${req.externalId}_${++this.n}`;
    return { status: 'published', externalId: id, url: `https://social.test/${id}` };
  }
}

const acct = (platform: SocialPlatform, externalId: string, name: string, token: string | null = null): DiscoveredAccount => ({ platform, externalId, name, username: null, avatarUrl: null, accountToken: token, capabilities: {} });

describe('Social publishing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const storage = new MemoryObjectStorage();
  let owner: TestUser;
  let designer: TestUser;
  let manager: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let ws: string;
  let otherWs: string;
  let meta: FakePublisher;
  let linkedin: FakePublisher;
  let google: FakePublisher;
  const ids: Record<string, string> = {};
  let image: { fileId: string; kind: 'image'; mimeType: string; width: number; height: number; sizeBytes: number };
  let video: { fileId: string; kind: 'video'; mimeType: string; width: number; height: number; durationSec: number; sizeBytes: number };

  const upload = async (user: TestUser, mimeType: string, size: number) => {
    const up = await api(app, user).post('/storage/uploads', { fileName: mimeType.startsWith('video') ? 'reel.mp4' : 'post.jpg', mimeType, sizeBytes: size, purpose: 'POST_MEDIA' }).expect(201);
    storage.put(up.body.key, { sizeBytes: size, contentType: mimeType }, Buffer.alloc(size, 1));
    await api(app, user).post(`/storage/uploads/${up.body.fileId}/complete`).expect(201);
    return up.body.fileId as string;
  };

  const connect = async (user: TestUser, provider: 'meta' | 'linkedin' | 'google', externalIds: string[], workspaceIds: string[] = []) => {
    const start = await api(app, user).post(`/social/connect/${provider}`, {}).expect(200);
    const state = new URL(start.body.authorizeUrl).searchParams.get('state');
    const cb = await api(app, user).get(`/social/oauth/${provider}/callback?code=c&state=${state}`).expect(302);
    const connectionId = new URL(cb.headers.location as string).searchParams.get('connection');
    const added = await api(app, user).post('/social/accounts', { connectionId, externalIds, workspaceIds }).expect(201);
    for (const a of added.body) ids[a.externalId] = a.id;
  };

  const waitFor = async (user: TestUser, id: string, statuses: string[], ms = 10_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const r = await api(app, user).get(`/social/posts/${id}`).expect(200);
      if (statuses.includes(r.body.status)) return r.body;
      if (Date.now() > end) throw new Error(`Post ${id} stayed ${r.body.status}`);
      await new Promise((res) => setTimeout(res, 100));
    }
  };

  const draft = async (user: TestUser, body: Record<string, unknown>) => (await api(app, user).post('/social/posts', { workspaceId: ws, ...body }).expect(201)).body;

  beforeAll(async () => {
    app = await createTestApp({ env: { TOKEN_ENCRYPTION_KEYS: KEY, META_APP_ID: 'a', META_APP_SECRET: 's' }, storage });
    prisma = app.get(PrismaService);
    const registry = app.get(SocialProviderRegistry);
    registry.reset(new TokenCipher(KEY));
    meta = new FakePublisher('meta', ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS']);
    meta.accounts = [acct('FACEBOOK_PAGE', 'p1', 'ZatGo Kochi', 'page-token-p1'), acct('INSTAGRAM_BUSINESS', 'ig1', 'zatgo.kochi', 'page-token-p1'), acct('FACEBOOK_PAGE', 'p2', 'ZatGo Dubai', 'page-token-p2')];
    linkedin = new FakePublisher('linkedin', ['LINKEDIN_PAGE']);
    linkedin.accounts = [acct('LINKEDIN_PAGE', 'org1', 'ZatGo Innovation')];
    google = new FakePublisher('google', ['YOUTUBE_CHANNEL']);
    google.accounts = [acct('YOUTUBE_CHANNEL', 'UC1', 'ZatGo TV')];
    for (const p of [meta, linkedin, google]) registry.register(p);

    owner = await signUp(app, 'Publish Owner');
    orgId = await createOrg(app, owner, 'Publish Org');
    ws = (await api(app, owner).get('/workspaces').expect(200)).body.data[0].id;
    otherWs = (await api(app, owner).post('/workspaces', { name: 'Dubai' }).expect(201)).body.id;
    designer = await signUp(app, 'Dee Designer');
    await inviteAndAccept(app, owner, designer, orgId, 'designer');
    manager = await signUp(app, 'Max Manager');
    await inviteAndAccept(app, owner, manager, orgId, 'marketing_manager');
    viewer = await signUp(app, 'Vee Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');

    await connect(owner, 'meta', ['p1', 'ig1']);
    await connect(owner, 'meta', ['p2'], [otherWs]);
    await connect(owner, 'linkedin', ['org1']);
    await connect(owner, 'google', ['UC1']);
    image = { fileId: await upload(owner, 'image/jpeg', 2_000), kind: 'image', mimeType: 'image/jpeg', width: 1080, height: 1080, sizeBytes: 2_000 };
    video = { fileId: await upload(owner, 'video/mp4', 4_000), kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, durationSec: 30, sizeBytes: 4_000 };
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports settings and permissions per role', async () => {
    expect((await api(app, owner).get('/social/settings').expect(200)).body).toEqual({ requireApproval: false, canPublish: true, canDraft: true });
    expect((await api(app, designer).get('/social/settings').expect(200)).body).toEqual({ requireApproval: false, canPublish: false, canDraft: true });
    expect((await api(app, viewer).get('/social/settings').expect(200)).body).toMatchObject({ canPublish: false, canDraft: false });
    await api(app, viewer).post('/social/posts', { workspaceId: ws, caption: 'x' }).expect(403);
    await api(app, designer).patch('/social/settings', { requireApproval: true }).expect(403);
  });

  it('creates and edits drafts with validated media and accounts', async () => {
    await api(app, owner).post('/social/posts', { workspaceId: ws, targets: [{ socialAccountId: ids.p2 }] }).expect(422); // p2 only in the Dubai workspace
    await api(app, owner).post('/social/posts', { workspaceId: ws, targets: [{ socialAccountId: ids.p1 }, { socialAccountId: ids.p1 }] }).expect(422);
    await api(app, owner).post('/social/posts', { workspaceId: ws, media: [{ ...image, fileId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }] }).expect(422);
    await api(app, owner).post('/social/posts', { workspaceId: ws, media: [{ ...image, kind: 'video' }] }).expect(422);

    const post = await draft(owner, { caption: 'Onam offers at ZatGo!', hashtags: ['onam', 'Kochi'], media: [{ ...image, mimeType: 'image/png', sizeBytes: 1 }], targets: [{ socialAccountId: ids.p1 }] });
    expect(post).toMatchObject({ status: 'DRAFT', hashtags: ['#onam', '#Kochi'], revision: 0, createdBy: { name: 'Publish Owner' } });
    expect(post.media[0]).toMatchObject({ mimeType: 'image/jpeg', sizeBytes: 2_000 }); // from storage, not the client
    expect(post.media[0].url).toContain('X-Amz-Signature');
    const edited = (await api(app, owner).patch(`/social/posts/${post.id}`, { caption: 'Onam week offers', targets: [{ socialAccountId: ids.ig1 }, { socialAccountId: ids.org1, captionOverride: 'LinkedIn version' }] }).expect(200)).body;
    expect(edited.revision).toBe(1);
    expect(edited.targets.map((t: { platform: string; captionOverride: string | null }) => [t.platform, t.captionOverride])).toEqual([
      ['INSTAGRAM_BUSINESS', null],
      ['LINKEDIN_PAGE', 'LinkedIn version'],
    ]);

    const check = (await api(app, owner).post('/social/posts/validate', { caption: 'Text only', targets: [{ socialAccountId: ids.p1 }, { socialAccountId: ids.ig1 }] }).expect(200)).body;
    expect(check.ok).toBe(false);
    expect(check.targets.map((t: { issues: Array<{ code: string }> }) => t.issues.map((i) => i.code))).toEqual([[], ['MEDIA_REQUIRED']]);
    const dup = (await api(app, owner).post(`/social/posts/${post.id}/duplicate`).expect(201)).body;
    expect(dup).toMatchObject({ status: 'DRAFT', caption: 'Onam week offers' });
    expect(dup.targets).toHaveLength(2);
    await api(app, owner).delete(`/social/posts/${dup.id}`).expect(204);
    await api(app, owner).get(`/social/posts/${dup.id}`).expect(404);
  });

  it('publishes now to Facebook, Instagram, LinkedIn and YouTube only after explicit confirmation', async () => {
    const before = meta.calls.length;
    const textOnly = await draft(owner, { caption: 'Hello', targets: [{ socialAccountId: ids.ig1 }] });
    expect((await api(app, owner).post(`/social/posts/${textOnly.id}/publish`, { confirm: true }).expect(422)).body.code).toBe('POST_INVALID');

    const post = await draft(owner, { caption: 'Onam offers!', hashtags: ['Onam'], media: [image], targets: [{ socialAccountId: ids.p1 }, { socialAccountId: ids.ig1 }, { socialAccountId: ids.org1, captionOverride: 'Celebrating Onam with our clients' }] });
    await api(app, owner).post(`/social/posts/${post.id}/publish`, {}).expect(400);
    expect(meta.calls.length).toBe(before); // nothing was sent without confirmation
    await api(app, owner).post(`/social/posts/${post.id}/publish`, { confirm: true }).expect(200);
    const done = await waitFor(owner, post.id, ['PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED']);
    expect(done.status).toBe('PUBLISHED');
    expect(done.targets.every((t: { status: string; externalUrl: string }) => t.status === 'PUBLISHED' && t.externalUrl.startsWith('https://social.test/'))).toBe(true);
    const fb = meta.calls.find((c) => c.externalId === 'p1')!;
    expect(fb).toMatchObject({ text: 'Onam offers!\n\n#Onam', token: 'page-token-p1' });
    expect(fb.urls[0]).toMatch(/^https:\/\/storage\.test\/.*X-Amz-Signature/);
    expect(linkedin.calls.at(-1)).toMatchObject({ text: 'Celebrating Onam with our clients\n\n#Onam', token: 'access-linkedin-c' });

    const yt = await draft(owner, { caption: 'Store tour', media: [video], targets: [{ socialAccountId: ids.UC1, options: { title: 'ZatGo Kochi tour', privacy: 'unlisted', madeForKids: false } }] });
    await api(app, owner).post(`/social/posts/${yt.id}/publish`, { confirm: true }).expect(200);
    expect((await waitFor(owner, yt.id, ['PUBLISHED'])).targets[0].externalUrl).toMatch(/UC1_/);
    expect(google.calls.at(-1)!.options).toEqual({ title: 'ZatGo Kochi tour', privacy: 'unlisted', madeForKids: false });

    const usage = (await api(app, owner).get('/billing/usage').expect(200)).body.metrics.find((m: { metric: string }) => m.metric === 'postsPerMonth');
    expect(usage.used).toBe(4);
    const audit = await prisma.system.auditLog.findFirst({ where: { organizationId: orgId, action: 'social.post_published', resourceId: post.id } });
    expect(audit).not.toBeNull();
    const raw = JSON.stringify((await api(app, owner).get('/social/posts').expect(200)).body);
    expect(raw).not.toMatch(/page-token|access-linkedin|v1\.k1\./);
    await api(app, owner).patch(`/social/posts/${post.id}`, { caption: 'too late' }).expect(409);
  });

  it('schedules, reschedules, cancels and publishes at the scheduled time', async () => {
    const post = await draft(owner, { caption: 'Scheduled hello', targets: [{ socialAccountId: ids.p1 }] });
    await api(app, owner).post(`/social/posts/${post.id}/schedule`, { scheduledAt: new Date(Date.now() - 1000).toISOString(), timezone: 'Asia/Kolkata' }).expect(422);
    const later = new Date(Date.now() + 3_600_000);
    const s = (await api(app, owner).post(`/social/posts/${post.id}/schedule`, { scheduledAt: later.toISOString(), timezone: 'Asia/Kolkata' }).expect(200)).body;
    expect(s).toMatchObject({ status: 'SCHEDULED', timezone: 'Asia/Kolkata', scheduledAt: later.toISOString() });
    const publishing = app.get(PublishingService);
    const queue = (publishing as unknown as { queue: { getJob(id: string): Promise<unknown> } }).queue;
    expect(await queue.getJob(publishing.jobIdFor(post.id, later))).toBeTruthy();

    const cal = (await api(app, owner).get(`/social/calendar?from=${new Date(Date.now()).toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`).expect(200)).body;
    expect(cal.find((e: { id: string }) => e.id === post.id)).toMatchObject({ status: 'SCHEDULED', platforms: ['FACEBOOK_PAGE'], accounts: [{ name: 'ZatGo Kochi' }] });
    await api(app, owner).get(`/social/calendar?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`).expect(400);

    // Reschedule to 1.5 s from now: the old job is removed and the new one publishes.
    const soon = new Date(Date.now() + 1_500);
    await api(app, owner).post(`/social/posts/${post.id}/schedule`, { scheduledAt: soon.toISOString(), timezone: 'Asia/Kolkata' }).expect(200);
    expect(await queue.getJob(publishing.jobIdFor(post.id, later))).toBeFalsy();
    expect((await waitFor(owner, post.id, ['PUBLISHED'], 8_000)).publishedAt).not.toBeNull();

    const other = await draft(owner, { caption: 'Cancel me', targets: [{ socialAccountId: ids.p1 }] });
    const at = new Date(Date.now() + 1_000);
    await api(app, owner).post(`/social/posts/${other.id}/schedule`, { scheduledAt: at.toISOString(), timezone: 'UTC' }).expect(200);
    expect((await api(app, owner).post(`/social/posts/${other.id}/cancel`).expect(200)).body).toMatchObject({ status: 'DRAFT', scheduledAt: null });
    await new Promise((r) => setTimeout(r, 1_500));
    expect((await api(app, owner).get(`/social/posts/${other.id}`).expect(200)).body.status).toBe('DRAFT');
  });

  it('runs the approval workflow', async () => {
    // Designers draft and submit; they cannot schedule or publish.
    const p = await draft(designer, { caption: 'Designer post', media: [image], targets: [{ socialAccountId: ids.ig1 }] });
    await api(app, designer).post(`/social/posts/${p.id}/publish`, { confirm: true }).expect(403);
    await api(app, designer).post(`/social/posts/${p.id}/submit`).expect(200);
    const v2 = (await api(app, designer).patch(`/social/posts/${p.id}`, { caption: 'Designer post v2' }).expect(200)).body;
    expect(v2).toMatchObject({ status: 'PENDING_APPROVAL', caption: 'Designer post v2' });
    expect([v2.targets.length, v2.media.length]).toEqual([1, 1]); // a caption-only edit keeps accounts and media
    await api(app, owner).post(`/social/posts/${p.id}/schedule`, { scheduledAt: new Date(Date.now() + 60_000).toISOString(), timezone: 'UTC' }).expect(409);
    await api(app, owner).post(`/social/posts/${p.id}/reject`, {}).expect(400);
    const rejected = (await api(app, owner).post(`/social/posts/${p.id}/reject`, { note: 'Use the festive photo' }).expect(200)).body;
    expect(rejected).toMatchObject({ status: 'DRAFT', reviewNote: 'Use the festive photo' });
    expect((await waitForEmail(app, designer.email, 'post-rejected')).text).toContain('Use the festive photo');
    await api(app, designer).post(`/social/posts/${p.id}/submit`).expect(200);
    const approved = (await api(app, owner).post(`/social/posts/${p.id}/approve`, { note: 'Looks great' }).expect(200)).body;
    expect(approved).toMatchObject({ status: 'DRAFT', approvedBy: { name: 'Publish Owner' } });
    await waitForEmail(app, designer.email, 'post-approved');
    // The author can no longer edit content they don't own once someone else handles it? They can edit drafts, but not schedule.
    await api(app, designer).post(`/social/posts/${p.id}/schedule`, { scheduledAt: new Date(Date.now() + 60_000).toISOString(), timezone: 'UTC' }).expect(403);

    // Require approval for everyone.
    await api(app, owner).patch('/social/settings', { requireApproval: true }).expect(200);
    const mine = await draft(manager, { caption: 'Manager post', targets: [{ socialAccountId: ids.p1 }] });
    expect((await api(app, manager).post(`/social/posts/${mine.id}/publish`, { confirm: true }).expect(409)).body.code).toBe('APPROVAL_REQUIRED');
    await api(app, manager).post(`/social/posts/${mine.id}/submit`).expect(200);
    expect((await api(app, manager).post(`/social/posts/${mine.id}/approve`, {}).expect(403)).body.code).toBe('SELF_APPROVAL_NOT_ALLOWED');
    await api(app, owner).post(`/social/posts/${mine.id}/approve`, {}).expect(200);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    await api(app, manager).post(`/social/posts/${mine.id}/schedule`, { scheduledAt: at, timezone: 'UTC' }).expect(200);
    // Editing an approved, scheduled post sends it back for approval and unschedules it.
    const reset = (await api(app, manager).patch(`/social/posts/${mine.id}`, { caption: 'Manager post edited' }).expect(200)).body;
    expect(reset).toMatchObject({ status: 'DRAFT', approvedAt: null, scheduledAt: null });
    // Owners/Admins may approve their own posts.
    const own = await draft(owner, { caption: 'Owner post', targets: [{ socialAccountId: ids.p1 }] });
    await api(app, owner).post(`/social/posts/${own.id}/submit`).expect(200);
    await api(app, owner).post(`/social/posts/${own.id}/approve`, {}).expect(200);
    await api(app, owner).patch('/social/settings', { requireApproval: false }).expect(200);
  });

  it('handles partial failures, retries without duplicating, and token errors', async () => {
    linkedin.script.set('org1', ['permanent']);
    const post = await draft(owner, { caption: 'Partial', targets: [{ socialAccountId: ids.p1 }, { socialAccountId: ids.org1 }] });
    await api(app, owner).post(`/social/posts/${post.id}/publish`, { confirm: true }).expect(200);
    const partial = await waitFor(owner, post.id, ['PARTIALLY_PUBLISHED']);
    const failed = partial.targets.find((t: { platform: string }) => t.platform === 'LINKEDIN_PAGE');
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'PLATFORM_ERROR', error: 'Unsupported media type' });
    expect((await waitForEmail(app, owner.email, 'post-failed')).subject).toBe('A post to ZatGo Innovation (LinkedIn Page) failed');
    const fbCalls = meta.calls.filter((c) => c.text === 'Partial').length;
    await api(app, owner).post(`/social/posts/${post.id}/targets/${failed.id}/retry`).expect(200);
    expect((await waitFor(owner, post.id, ['PUBLISHED'])).targets.every((t: { status: string }) => t.status === 'PUBLISHED')).toBe(true);
    expect(meta.calls.filter((c) => c.text === 'Partial').length).toBe(fbCalls); // Facebook was not posted twice

    // A transient error is retried with backoff and resumes from saved progress.
    meta.script.set('p1', ['retry']);
    const flaky = await draft(owner, { caption: 'Flaky', targets: [{ socialAccountId: ids.p1 }] });
    await api(app, owner).post(`/social/posts/${flaky.id}/publish`, { confirm: true }).expect(200);
    let t = { errorCode: '' } as { id: string; errorCode: string; nextAttemptAt?: string };
    for (let i = 0; i < 50 && t.errorCode !== 'RETRYING'; i++) {
      t = (await prisma.system.socialPostTarget.findFirstOrThrow({ where: { postId: flaky.id } })) as never;
      await new Promise((r) => setTimeout(r, 100));
    }
    const row = await prisma.system.socialPostTarget.findFirstOrThrow({ where: { postId: flaky.id } });
    expect(row).toMatchObject({ status: 'PUBLISHING', attempts: 1, errorCode: 'RETRYING', providerState: { uploaded: true } });
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await app.get(PublishingWorkerService).runTarget({ organizationId: orgId, postId: flaky.id, targetId: row.id });
    expect((await waitFor(owner, flaky.id, ['PUBLISHED'])).targets[0].attempts).toBe(1);
    expect(meta.calls.at(-1)!.state).toEqual({ uploaded: true });

    // Instagram still processing: the job is re-queued until the container is ready.
    meta.script.set('ig1', ['processing']);
    const slow = await draft(owner, { caption: 'Slow', media: [image], targets: [{ socialAccountId: ids.ig1 }] });
    await api(app, owner).post(`/social/posts/${slow.id}/publish`, { confirm: true }).expect(200);
    await waitFor(owner, slow.id, ['PUBLISHED']);
    expect(meta.calls.filter((c) => c.externalId === 'ig1').at(-1)!.state).toMatchObject({ containerId: 'c1', _polls: 1 });

    // Expired token: the account is flagged for reconnection and the person who connected it is emailed.
    google.script.set('UC1', ['auth']);
    const yt = await draft(owner, { caption: 'Auth', media: [video], targets: [{ socialAccountId: ids.UC1, options: { title: 'T', privacy: 'public', madeForKids: false } }] });
    await api(app, owner).post(`/social/posts/${yt.id}/publish`, { confirm: true }).expect(200);
    const authFailed = await waitFor(owner, yt.id, ['FAILED']);
    expect(authFailed.targets[0]).toMatchObject({ status: 'FAILED', errorCode: 'REAUTH_REQUIRED' });
    expect((await api(app, owner).get('/social/accounts').expect(200)).body.find((a: { id: string }) => a.id === ids.UC1).status).toBe('NEEDS_REAUTH');
    await waitForEmail(app, owner.email, 'social-reauth');
    expect((await api(app, owner).post(`/social/posts/${yt.id}/targets/${authFailed.targets[0].id}/retry`).expect(409)).body.code).toBe('ACCOUNT_NEEDS_ATTENTION');
    const blocked = await draft(owner, { caption: 'x', media: [video], targets: [{ socialAccountId: ids.UC1, options: { title: 'T', privacy: 'public', madeForKids: false } }] });
    expect((await api(app, owner).post(`/social/posts/${blocked.id}/publish`, { confirm: true }).expect(409)).body.code).toBe('ACCOUNT_NEEDS_ATTENTION');
  });

  it('recovers overdue posts with the sweeper', async () => {
    const post = await draft(owner, { caption: 'Swept', targets: [{ socialAccountId: ids.p1 }] });
    const at = new Date(Date.now() + 3_600_000);
    await api(app, owner).post(`/social/posts/${post.id}/schedule`, { scheduledAt: at.toISOString(), timezone: 'UTC' }).expect(200);
    // Simulate a lost delayed job: the post is overdue and nothing is queued.
    const publishing = app.get(PublishingService);
    const queue = (publishing as unknown as { queue: { getJob(id: string): Promise<{ remove(): Promise<void> } | undefined> } }).queue;
    await (await queue.getJob(publishing.jobIdFor(post.id, at)))!.remove();
    const past = new Date(Date.now() - 120_000);
    await prisma.system.socialPost.update({ where: { id: post.id }, data: { scheduledAt: past } });
    const swept = await app.get(PublishingWorkerService).sweep();
    expect(swept.posts).toBeGreaterThanOrEqual(1);
    await waitFor(owner, post.id, ['PUBLISHED']);
  });

  it('enforces the monthly post quota, tenant isolation and read-only roles', async () => {
    const u = await signUp(app, 'Quota User');
    const org2 = await createOrg(app, u, 'Quota Org');
    await connect(u, 'meta', ['p1', 'ig1']);
    const free = await prisma.system.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    const limits = free.limits as Record<string, number>;
    expect(limits.postsPerMonth).toBe(10);
    const ws2 = (await api(app, u).get('/workspaces').expect(200)).body.data[0].id;
    const sub = await prisma.system.subscription.findUnique({ where: { organizationId: org2 } });
    const plan = sub ? await prisma.system.plan.findUniqueOrThrow({ where: { id: sub.planId } }) : free;
    const original = plan.limits;
    await prisma.system.plan.update({ where: { id: plan.id }, data: { limits: { ...(plan.limits as object), postsPerMonth: 1 } } });
    try {
      const pic = { ...image, fileId: await upload(u, 'image/jpeg', 2_000) };
      const two = (await api(app, u).post('/social/posts', { workspaceId: ws2, caption: 'Two accounts', media: [pic], targets: [{ socialAccountId: (await api(app, u).get('/social/accounts')).body[0].id }, { socialAccountId: (await api(app, u).get('/social/accounts')).body[1].id }] }).expect(201)).body;
      const res = await api(app, u).post(`/social/posts/${two.id}/publish`, { confirm: true }).expect(402);
      expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { metric: 'postsPerMonth', limit: 1 } });
    } finally {
      await prisma.system.plan.update({ where: { id: plan.id }, data: { limits: original as object } });
    }
    // Another organization's posts are invisible.
    const mine = (await api(app, owner).get('/social/posts').expect(200)).body.data[0];
    await api(app, u).get(`/social/posts/${mine.id}`).expect(404);
    await api(app, u).post(`/social/posts/${mine.id}/duplicate`).expect(404);
    expect((await api(app, u).get('/social/posts').expect(200)).body.meta.total).toBe(1);
    // Viewers read the calendar and posts, but cannot change anything.
    expect((await api(app, viewer).get('/social/posts').expect(200)).body.meta.total).toBeGreaterThan(3);
    await api(app, viewer).post(`/social/posts/${mine.id}/duplicate`).expect(403);
    await api(app, viewer).delete(`/social/posts/${mine.id}`).expect(403);
  });
});
