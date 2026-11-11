import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { composeText, PLATFORM_LABELS, type PostMedia, type SocialPlatform, type TargetOptions } from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { emailTemplates } from '../email/templates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { isRetryable, ProviderAuthError, type PublishMedia } from '../social/providers/provider.js';
import { SocialService } from '../social/social.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PublishingService, SOCIAL_PUBLISH_QUEUE, type PublishJob } from './publishing.service.js';

/** Attempts per target before a retryable failure becomes permanent. */
export const MAX_ATTEMPTS = 5;
/** Backoff after attempt n (1-based): 30 s, 2 min, 8 min, 32 min. */
export const backoffMs = (attempt: number) => 30_000 * 4 ** (attempt - 1);
/** Processing polls (Instagram containers, LinkedIn video) before giving up: about 30 minutes. */
const MAX_POLLS = 180;
const STUCK_MS = 15 * 60_000;

const errorText = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 500);

@Injectable()
export class PublishingWorkerService {
  private readonly logger = new Logger(PublishingWorkerService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
    private readonly storage: StorageService,
    private readonly publishing: PublishingService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /** Scheduled time reached: lock the post and fan out one job per account. */
  async runPost(job: { organizationId: string; postId: string; scheduledAtMs: number }): Promise<void> {
    await TenantContext.run({ organizationId: job.organizationId }, async () => {
      const db = this.prisma.tenant;
      // Compare-and-set: only the job for the current schedule wins; edits/cancels make older jobs no-ops.
      const locked = await db.socialPost.updateMany({ where: { id: job.postId, status: 'SCHEDULED', scheduledAt: new Date(job.scheduledAtMs), deletedAt: null }, data: { status: 'PUBLISHING' } });
      if (!locked.count) return;
      const targets = await db.socialPostTarget.findMany({ where: { postId: job.postId, status: 'PENDING' }, select: { id: true } });
      for (const t of targets) await this.publishing.enqueueTarget(job.organizationId, job.postId, t.id, 0);
      if (!targets.length) await this.finalize(job.postId);
    });
  }

  /** Publishes one post to one account. Every outcome is written before returning, so a crash can be resumed. */
  async runTarget(job: { organizationId: string; postId: string; targetId: string }): Promise<void> {
    await TenantContext.run({ organizationId: job.organizationId }, async () => {
      const db = this.prisma.tenant;
      const target = await db.socialPostTarget.findFirst({ where: { id: job.targetId }, include: { post: true } });
      if (!target || target.post.deletedAt || !['PENDING', 'PUBLISHING'].includes(target.status)) return;
      if (!target.socialAccountId) return this.fail(target.id, 'ACCOUNT_REMOVED', 'The account was disconnected');

      // One publish at a time per account (platform rate limits, ordered posts).
      const lockKey = `publish:lock:${target.socialAccountId}`;
      if ((await this.redis.set(lockKey, target.id, 'PX', 10 * 60_000, 'NX')) !== 'OK') {
        await this.publishing.enqueueTarget(job.organizationId, job.postId, job.targetId, 5_000);
        return;
      }
      try {
        await this.attempt(target);
      } finally {
        if ((await this.redis.get(lockKey)) === target.id) await this.redis.del(lockKey);
      }
    });
  }

  private async attempt(target: Prisma.SocialPostTargetGetPayload<{ include: { post: true } }>) {
    const db = this.prisma.tenant;
    const post = target.post;
    const state = { ...((target.providerState ?? {}) as Record<string, unknown>) };
    const polls = Number(state._polls ?? 0);
    await db.socialPostTarget.update({ where: { id: target.id }, data: { status: 'PUBLISHING', lastAttemptAt: new Date(), nextAttemptAt: null } });
    try {
      const account = await this.social.publishingTarget(target.socialAccountId!);
      const media = await this.media(post.media as PostMedia[]);
      const result = await account.provider.publish!({
        platform: account.platform,
        externalId: account.externalId,
        capabilities: account.capabilities,
        token: account.token,
        text: composeText(post.caption, post.hashtags, target.captionOverride),
        hashtags: post.hashtags,
        media,
        options: (target.options ?? {}) as TargetOptions,
        state,
        saveState: async (patch) => {
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) delete state[k];
            else state[k] = v;
          }
          await db.socialPostTarget.update({ where: { id: target.id }, data: { providerState: state as Prisma.InputJsonValue } });
        },
      });
      if (result.status === 'processing') {
        if (polls >= MAX_POLLS) return this.fail(target.id, 'PROCESSING_TIMEOUT', 'The platform took too long to process the media');
        state._polls = polls + 1;
        await db.socialPostTarget.update({ where: { id: target.id }, data: { providerState: state as Prisma.InputJsonValue, nextAttemptAt: new Date(Date.now() + result.retryAfterMs) } });
        await this.publishing.enqueueTarget(post.organizationId, post.id, target.id, result.retryAfterMs);
        return;
      }
      await db.socialPostTarget.update({
        where: { id: target.id },
        data: { status: 'PUBLISHED', externalId: result.externalId, externalUrl: result.url, publishedAt: new Date(), error: null, errorCode: null, providerState: state as Prisma.InputJsonValue },
      });
      await this.finalize(post.id);
    } catch (e) {
      const auth = e instanceof ProviderAuthError || (e instanceof AppException && e.code === 'SOCIAL_REAUTH_REQUIRED');
      if (auth) {
        await this.social.markNeedsReauth(target.socialAccountId!, errorText(e));
        return this.fail(target.id, 'REAUTH_REQUIRED', `Reconnect the account and retry: ${errorText(e)}`);
      }
      const attempts = target.attempts + 1;
      if (isRetryable(e) && attempts < MAX_ATTEMPTS) {
        const delay = backoffMs(attempts);
        await db.socialPostTarget.update({ where: { id: target.id }, data: { attempts, error: errorText(e), errorCode: 'RETRYING', nextAttemptAt: new Date(Date.now() + delay) } });
        await this.publishing.enqueueTarget(post.organizationId, post.id, target.id, delay);
        return;
      }
      const code = e instanceof AppException ? e.code : 'PLATFORM_ERROR';
      await db.socialPostTarget.update({ where: { id: target.id }, data: { attempts } });
      return this.fail(target.id, code, errorText(e));
    }
  }

  /** Media as the adapters see it: signed URLs and byte ranges on demand. */
  private async media(items: PostMedia[]): Promise<PublishMedia[]> {
    if (!items.length) return [];
    const files = await this.prisma.tenant.storedFile.findMany({ where: { id: { in: items.map((m) => m.fileId) }, status: 'UPLOADED' } });
    return items.map((m) => {
      const f = files.find((x) => x.id === m.fileId);
      if (!f) throw new AppException(422, 'MEDIA_NOT_FOUND', 'A media file of this post was deleted');
      return {
        kind: m.kind,
        mimeType: f.mimeType,
        width: m.width,
        height: m.height,
        durationSec: m.durationSec,
        sizeBytes: f.sizeBytes,
        altText: m.altText,
        signedUrl: () => this.storage.presignForPlatform(f.key),
        read: (start, end) => this.storage.readRange(f.key, start, end),
      };
    });
  }

  private async fail(targetId: string, code: string, message: string) {
    const db = this.prisma.tenant;
    const t = await db.socialPostTarget.update({ where: { id: targetId }, data: { status: 'FAILED', errorCode: code, error: message, nextAttemptAt: null }, include: { post: true } });
    await this.audit.record('social.post_failed', 'social_post', t.postId, { account: t.accountName, platform: t.platform, error: message });
    await this.notifyFailure(t.post, t.accountName, t.platform as SocialPlatform, message);
    await this.finalize(t.postId);
  }

  private async notifyFailure(post: { id: string; caption: string; organizationId: string; createdById: string | null }, accountName: string, platform: SocialPlatform, error: string) {
    if (!post.createdById) return;
    const user = await this.prisma.system.user.findUnique({ where: { id: post.createdById }, select: { email: true, name: true } });
    if (!user) return;
    const t = emailTemplates.postFailed({ name: user.name, accountName, platformLabel: PLATFORM_LABELS[platform], error, preview: post.caption.slice(0, 80) || 'Untitled post', url: `${this.env.WEB_URL}/marketing/social/${post.id}` });
    await this.email.send({ to: user.email, subject: t.subject, html: t.html, text: t.text, tag: t.tag, organizationId: post.organizationId }).catch((e) => this.logger.warn(`Failure email: ${(e as Error).message}`));
  }

  /** When every account is done, the post becomes PUBLISHED, PARTIALLY_PUBLISHED or FAILED (exactly once). */
  async finalize(postId: string) {
    const db = this.prisma.tenant;
    const targets = await db.socialPostTarget.findMany({ where: { postId }, select: { status: true, publishedAt: true } });
    if (targets.some((t) => t.status === 'PENDING' || t.status === 'PUBLISHING')) return;
    const published = targets.filter((t) => t.status === 'PUBLISHED');
    const status = published.length === targets.length ? 'PUBLISHED' : published.length ? 'PARTIALLY_PUBLISHED' : 'FAILED';
    const last = published.reduce<Date | null>((m, t) => (t.publishedAt && (!m || t.publishedAt > m) ? t.publishedAt : m), null);
    const res = await db.socialPost.updateMany({ where: { id: postId, status: 'PUBLISHING' }, data: { status, publishedAt: last } });
    if (res.count && status !== 'FAILED') await this.audit.record(status === 'PUBLISHED' ? 'social.post_published' : 'social.post_partially_published', 'social_post', postId, { accounts: published.length, of: targets.length });
  }

  /**
   * Safety net (every minute): re-enqueue overdue scheduled posts and stuck targets, and settle posts whose
   * targets all finished. Restarts or lost Redis jobs therefore delay a post but never drop it.
   */
  async sweep(now = new Date()): Promise<{ posts: number; targets: number }> {
    const sys = this.prisma.system;
    const overdue = await sys.socialPost.findMany({ where: { status: 'SCHEDULED', deletedAt: null, scheduledAt: { lte: new Date(now.getTime() - 30_000) } }, select: { id: true, organizationId: true, scheduledAt: true }, take: 500 });
    for (const p of overdue) await this.publishing.enqueuePost(p.organizationId, p.id, p.scheduledAt!);
    const stuck = await sys.socialPostTarget.findMany({
      where: {
        OR: [
          { status: 'PUBLISHING', lastAttemptAt: { lt: new Date(now.getTime() - STUCK_MS) }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: new Date(now.getTime() - 5 * 60_000) } }] },
          { status: 'PENDING', post: { status: 'PUBLISHING' }, OR: [{ nextAttemptAt: null, updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }, { nextAttemptAt: { lt: new Date(now.getTime() - 5 * 60_000) } }] },
        ],
      },
      select: { id: true, postId: true, organizationId: true },
      take: 500,
    });
    for (const t of stuck) await this.publishing.enqueueTarget(t.organizationId, t.postId, t.id, 0);
    const settling = await sys.socialPost.findMany({ where: { status: 'PUBLISHING', targets: { every: { status: { in: ['PUBLISHED', 'FAILED', 'CANCELED'] } } } }, select: { id: true, organizationId: true }, take: 500 });
    for (const p of settling) await TenantContext.run({ organizationId: p.organizationId }, () => this.finalize(p.id));
    return { posts: overdue.length, targets: stuck.length };
  }
}

@Injectable()
export class PublishingScheduler implements OnModuleInit {
  private readonly logger = new Logger(PublishingScheduler.name);
  constructor(@InjectQueue(SOCIAL_PUBLISH_QUEUE) private readonly queue: Queue<PublishJob>) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.queue.upsertJobScheduler('publish-sweep', { every: 60_000 }, { name: 'sweep', data: { kind: 'sweep' } });
    } catch (err) {
      this.logger.warn(`Could not register the publishing sweep: ${(err as Error).message}`);
    }
  }
}

@Processor(SOCIAL_PUBLISH_QUEUE, { concurrency: 4 })
export class PublishingProcessor extends WorkerHost {
  constructor(private readonly publisher: PublishingWorkerService) {
    super();
  }

  async process(job: Job<PublishJob>): Promise<void> {
    const d = job.data;
    if (d.kind === 'post') return this.publisher.runPost(d);
    if (d.kind === 'target') return this.publisher.runTarget(d);
    await this.publisher.sweep();
  }
}
