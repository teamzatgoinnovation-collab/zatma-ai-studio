import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Paginated } from '@zatma/types';
import {
  DEFAULT_SOCIAL_SETTINGS,
  EDITABLE_POST_STATUSES,
  MAX_SCHEDULE_AHEAD_DAYS,
  monthWindow,
  normalizeHashtags,
  socialSettingsSchema,
  validatePost,
  type CalendarEntry,
  type CalendarQuery,
  type CreatePostInput,
  type ListPostsQuery,
  type PostMedia,
  type PostTargetInput,
  type PublishingSettingsDto,
  type SchedulePostInput,
  type SocialPlatform,
  type SocialPostDto,
  type SocialSettings,
  type TargetOptions,
  type UpdatePostInput,
} from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { emailTemplates } from '../email/templates.js';
import type { Prisma, SocialPost, SocialPostTarget } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

export const SOCIAL_PUBLISH_QUEUE = 'social-publish';

export type PublishJob = { kind: 'post'; organizationId: string; postId: string; scheduledAtMs: number } | { kind: 'target'; organizationId: string; postId: string; targetId: string } | { kind: 'sweep' };

type PostRow = SocialPost & {
  targets: Array<SocialPostTarget & { account: { name: string; username: string | null; avatarUrl: string | null; status: string } | null }>;
  createdBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
};

const POST_INCLUDE = {
  targets: { include: { account: { select: { name: true, username: true, avatarUrl: true, status: true } } }, orderBy: { createdAt: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.SocialPostInclude;

const preview = (caption: string) => (caption.length > 80 ? `${caption.slice(0, 77)}…` : caption) || 'Untitled post';

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @InjectQueue(SOCIAL_PUBLISH_QUEUE) private readonly queue: Queue<PublishJob>,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  private ctx() {
    const c = TenantContext.get()!;
    const permissions = c.permissions ?? [];
    return {
      organizationId: c.organizationId!,
      userId: c.userId ?? null,
      canPublish: permissions.includes('social:publish'),
      isAdmin: c.role === 'ORGANIZATION_OWNER' || c.role === 'ADMIN',
    };
  }

  // ───────────── Settings ─────────────

  async settings(organizationId = this.ctx().organizationId): Promise<SocialSettings> {
    const org = await this.prisma.system.organization.findUnique({ where: { id: organizationId }, select: { socialSettings: true } });
    const parsed = socialSettingsSchema.safeParse(org?.socialSettings ?? {});
    return parsed.success ? parsed.data : DEFAULT_SOCIAL_SETTINGS;
  }

  async settingsDto(): Promise<PublishingSettingsDto> {
    const perms = TenantContext.get()?.permissions ?? [];
    return { ...(await this.settings()), canPublish: perms.includes('social:publish'), canDraft: perms.includes('social:draft') };
  }

  async updateSettings(input: SocialSettings): Promise<PublishingSettingsDto> {
    await this.prisma.system.organization.update({ where: { id: this.ctx().organizationId }, data: { socialSettings: input } });
    return this.settingsDto();
  }

  // ───────────── Reading ─────────────

  private async row(id: string): Promise<PostRow> {
    const row = await this.db.socialPost.findFirst({ where: { id, deletedAt: null }, include: POST_INCLUDE });
    if (!row) throw notFound('Post');
    return row as PostRow;
  }

  async get(id: string): Promise<SocialPostDto> {
    return this.toDto(await this.row(id));
  }

  async list(q: ListPostsQuery): Promise<Paginated<SocialPostDto>> {
    const where: Prisma.SocialPostWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.platform ? { targets: { some: { platform: q.platform } } } : {}),
      ...(q.q ? { caption: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.socialPost.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'first' } }, { updatedAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.socialPost.count({ where }),
    ]);
    const urls = await this.mediaUrls(rows.flatMap((r) => (r.media as PostMedia[]).slice(0, 1)));
    return { data: (rows as PostRow[]).map((r) => this.toDto(r, urls)), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
  }

  async calendar(q: CalendarQuery): Promise<CalendarEntry[]> {
    const from = new Date(q.from);
    const to = new Date(q.to);
    const rows = await this.db.socialPost.findMany({
      where: {
        deletedAt: null,
        ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.platform ? { targets: { some: { platform: q.platform } } } : {}),
        OR: [{ scheduledAt: { gte: from, lt: to } }, { scheduledAt: null, publishedAt: { gte: from, lt: to } }],
      },
      include: { targets: { select: { socialAccountId: true, accountName: true, platform: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 1000,
    });
    const urls = await this.mediaUrls(rows.flatMap((r) => (r.media as PostMedia[]).slice(0, 1)));
    return rows.map((r) => {
      const first = (r.media as PostMedia[])[0];
      return {
        id: r.id,
        status: r.status,
        at: (r.scheduledAt ?? r.publishedAt)!.toISOString(),
        caption: r.caption,
        thumbnailUrl: first?.kind === 'image' ? (urls[first.fileId] ?? null) : null,
        platforms: [...new Set(r.targets.map((t) => t.platform as SocialPlatform))],
        accounts: r.targets.map((t) => ({ id: t.socialAccountId ?? '', name: t.accountName, platform: t.platform as SocialPlatform })),
      };
    });
  }

  private async mediaUrls(media: PostMedia[]): Promise<Record<string, string>> {
    const ids = [...new Set(media.map((m) => m.fileId))];
    if (!ids.length) return {};
    const files = await this.db.storedFile.findMany({ where: { id: { in: ids }, status: 'UPLOADED' }, select: { id: true, key: true } });
    const pairs = await Promise.all(files.map(async (f) => [f.id, await this.storage.signedUrlForKey(f.key)] as const));
    return Object.fromEntries(pairs);
  }

  toDto(r: PostRow, urls?: Record<string, string>): SocialPostDto {
    const media = r.media as PostMedia[];
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      caption: r.caption,
      hashtags: r.hashtags,
      media: media.map((m) => ({ ...m, url: urls?.[m.fileId] ?? null })),
      status: r.status,
      scheduledAt: r.scheduledAt?.toISOString() ?? null,
      timezone: r.timezone,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      sourceDesignId: r.sourceDesignId,
      copyAssetId: r.copyAssetId,
      createdBy: r.createdBy,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      reviewNote: r.reviewNote,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      targets: r.targets.map((t) => ({
        id: t.id,
        socialAccountId: t.socialAccountId ?? '',
        platform: t.platform as SocialPlatform,
        account: t.account ?? { name: t.accountName, username: null, avatarUrl: null, status: 'DISCONNECTED' },
        captionOverride: t.captionOverride,
        options: (t.options ?? {}) as TargetOptions,
        status: t.status,
        attempts: t.attempts,
        externalId: t.externalId,
        externalUrl: t.externalUrl,
        error: t.error,
        errorCode: t.errorCode,
        lastAttemptAt: t.lastAttemptAt?.toISOString() ?? null,
        publishedAt: t.publishedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Detail view: media preview URLs included. */
  async getWithMedia(id: string): Promise<SocialPostDto> {
    const r = await this.row(id);
    return this.toDto(r, await this.mediaUrls(r.media as PostMedia[]));
  }

  // ───────────── Writing ─────────────

  /** Media must be uploaded files of this organization; type and size come from storage, not the client. */
  private async resolveMedia(media: PostMedia[]): Promise<PostMedia[]> {
    if (!media.length) return [];
    const files = await this.db.storedFile.findMany({ where: { id: { in: media.map((m) => m.fileId) }, status: 'UPLOADED' } });
    return media.map((m) => {
      const f = files.find((x) => x.id === m.fileId);
      if (!f) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'MEDIA_NOT_FOUND', 'A media file is missing or has not finished uploading');
      const kind = f.mimeType.startsWith('video/') ? 'video' : f.mimeType.startsWith('image/') ? 'image' : null;
      if (!kind || kind !== m.kind) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'MEDIA_INVALID', `${f.fileName} is not a supported ${m.kind}`);
      return { ...m, mimeType: f.mimeType, sizeBytes: f.sizeBytes };
    });
  }

  /** Targets must be connected accounts available in the post's workspace. */
  private async resolveTargets(workspaceId: string, targets: PostTargetInput[]) {
    if (new Set(targets.map((t) => t.socialAccountId)).size !== targets.length) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'DUPLICATE_TARGET', 'Each account can be selected once');
    if (!targets.length) return [];
    const accounts = await this.db.socialAccount.findMany({ where: { id: { in: targets.map((t) => t.socialAccountId) }, status: { not: 'DISCONNECTED' } } });
    return targets.map((t) => {
      const a = accounts.find((x) => x.id === t.socialAccountId);
      if (!a) throw notFound('Social account');
      if (a.workspaceIds.length && !a.workspaceIds.includes(workspaceId)) {
        throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'ACCOUNT_NOT_IN_WORKSPACE', `${a.name} is not available in this workspace`);
      }
      return { account: a, input: t };
    });
  }

  private async assertLinks(input: { sourceDesignId?: string | null; copyAssetId?: string | null }) {
    if (input.sourceDesignId && !(await this.db.design.findFirst({ where: { id: input.sourceDesignId }, select: { id: true } }))) throw notFound('Design');
    if (input.copyAssetId && !(await this.db.copyAsset.findFirst({ where: { id: input.copyAssetId, deletedAt: null }, select: { id: true } }))) throw notFound('Copy');
  }

  async create(input: CreatePostInput): Promise<SocialPostDto> {
    const { organizationId, userId } = this.ctx();
    if (!(await this.db.workspace.findFirst({ where: { id: input.workspaceId }, select: { id: true } }))) throw notFound('Workspace');
    const [media, targets] = await Promise.all([this.resolveMedia(input.media), this.resolveTargets(input.workspaceId, input.targets)]);
    await this.assertLinks(input);
    const post = await this.db.socialPost.create({
      data: {
        organizationId,
        workspaceId: input.workspaceId,
        caption: input.caption,
        hashtags: normalizeHashtags(input.hashtags),
        media: media as unknown as Prisma.InputJsonValue,
        sourceDesignId: input.sourceDesignId ?? null,
        copyAssetId: input.copyAssetId ?? null,
        createdById: userId,
        targets: { create: targets.map((t) => this.targetData(organizationId, t.account, t.input)) },
      },
    });
    await this.audit.record('social.post_created', 'social_post', post.id, { targets: targets.length });
    return this.getWithMedia(post.id);
  }

  private targetData(organizationId: string, a: { id: string; platform: string; name: string }, t: PostTargetInput) {
    return { organizationId, socialAccountId: a.id, platform: a.platform, accountName: a.name, captionOverride: t.captionOverride ?? null, options: (t.options ?? {}) as Prisma.InputJsonValue };
  }

  /** Drafters may edit only their own drafts; publishers may edit any post until publishing starts. */
  private assertCanEdit(p: PostRow) {
    const { userId, canPublish } = this.ctx();
    if (!EDITABLE_POST_STATUSES.includes(p.status)) throw new AppException(HttpStatus.CONFLICT, 'POST_LOCKED', 'This post can no longer be edited');
    if (!canPublish && (p.createdById !== userId || p.status === 'SCHEDULED')) throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You can only edit your own drafts');
  }

  async update(id: string, input: UpdatePostInput): Promise<SocialPostDto> {
    const p = await this.row(id);
    this.assertCanEdit(p);
    const { organizationId } = this.ctx();
    const media = input.media ? await this.resolveMedia(input.media) : undefined;
    const targets = input.targets ? await this.resolveTargets(p.workspaceId, input.targets) : undefined;
    await this.assertLinks(input);
    const settings = await this.settings();
    // Changing an approved post's content needs approval again when approval is required.
    const reapprove = settings.requireApproval && !!p.approvedAt;
    await this.prisma.tenant.$transaction(async (tx) => {
      await tx.socialPost.update({
        where: { id },
        data: {
          ...(input.caption !== undefined ? { caption: input.caption } : {}),
          ...(input.hashtags ? { hashtags: normalizeHashtags(input.hashtags) } : {}),
          ...(media ? { media: media as unknown as Prisma.InputJsonValue } : {}),
          ...(input.sourceDesignId !== undefined ? { sourceDesignId: input.sourceDesignId } : {}),
          ...(input.copyAssetId !== undefined ? { copyAssetId: input.copyAssetId } : {}),
          revision: { increment: 1 },
          ...(reapprove ? { approvedAt: null, approvedById: null, ...(p.status === 'SCHEDULED' ? { status: 'DRAFT' as const, scheduledAt: null } : {}) } : {}),
        },
      });
      if (targets) {
        const keep = targets.map((t) => t.account.id);
        await tx.socialPostTarget.deleteMany({ where: { postId: id, socialAccountId: { notIn: keep } } });
        for (const t of targets) {
          const data = this.targetData(organizationId, t.account, t.input);
          await tx.socialPostTarget.upsert({
            where: { postId_socialAccountId: { postId: id, socialAccountId: t.account.id } },
            create: { ...data, postId: id },
            update: { captionOverride: data.captionOverride, options: data.options, accountName: data.accountName },
          });
        }
      }
    });
    if (reapprove && p.status === 'SCHEDULED') await this.removeJob(p);
    return this.getWithMedia(id);
  }

  async remove(id: string): Promise<void> {
    const p = await this.row(id);
    if (p.status === 'PUBLISHING') throw new AppException(HttpStatus.CONFLICT, 'POST_LOCKED', 'Wait until publishing finishes');
    const { userId, canPublish } = this.ctx();
    if (!canPublish && !(p.createdById === userId && (p.status === 'DRAFT' || p.status === 'PENDING_APPROVAL'))) throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You can only delete your own drafts');
    await this.db.socialPost.update({ where: { id }, data: { deletedAt: new Date() } });
    if (p.status === 'SCHEDULED') await this.removeJob(p);
    await this.audit.record('social.post_deleted', 'social_post', id, { status: p.status });
  }

  async duplicate(id: string): Promise<SocialPostDto> {
    const p = await this.row(id);
    const { organizationId, userId } = this.ctx();
    const active = p.targets.filter((t) => t.socialAccountId && t.account && t.account.status !== 'DISCONNECTED');
    const copy = await this.db.socialPost.create({
      data: {
        organizationId,
        workspaceId: p.workspaceId,
        caption: p.caption,
        hashtags: p.hashtags,
        media: p.media as Prisma.InputJsonValue,
        sourceDesignId: p.sourceDesignId,
        copyAssetId: p.copyAssetId,
        createdById: userId,
        targets: {
          create: active.map((t) => ({ organizationId, socialAccountId: t.socialAccountId, platform: t.platform, accountName: t.accountName, captionOverride: t.captionOverride, options: t.options as Prisma.InputJsonValue })),
        },
      },
    });
    return this.getWithMedia(copy.id);
  }

  // ───────────── Validation ─────────────

  private validation(p: Pick<PostRow, 'caption' | 'hashtags' | 'media' | 'targets'>) {
    return validatePost(
      { caption: p.caption, hashtags: p.hashtags, media: p.media as PostMedia[] },
      p.targets.map((t) => ({ platform: t.platform as SocialPlatform, captionOverride: t.captionOverride, options: t.options as TargetOptions, socialAccountId: t.socialAccountId ?? undefined })),
    );
  }

  async validateDraft(input: { caption: string; hashtags: string[]; media: PostMedia[]; targets: PostTargetInput[] }) {
    const accounts = input.targets.length ? await this.db.socialAccount.findMany({ where: { id: { in: input.targets.map((t) => t.socialAccountId) } }, select: { id: true, platform: true } }) : [];
    return validatePost(
      input,
      input.targets.flatMap((t) => {
        const a = accounts.find((x) => x.id === t.socialAccountId);
        return a ? [{ platform: a.platform as SocialPlatform, captionOverride: t.captionOverride, options: t.options, socialAccountId: a.id }] : [];
      }),
    );
  }

  /** Everything that must hold before a post may go out (schedule, publish now, approve). */
  private assertReady(p: PostRow) {
    if (!p.targets.length) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'NO_TARGETS', 'Choose at least one account');
    const v = this.validation(p);
    if (!v.ok) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'POST_INVALID', 'The post does not meet the platform requirements', { targets: v.targets });
    const bad = p.targets.filter((t) => !t.account || t.account.status !== 'ACTIVE');
    if (bad.length) throw new AppException(HttpStatus.CONFLICT, 'ACCOUNT_NEEDS_ATTENTION', `${bad.map((t) => t.accountName).join(', ')} must be reconnected first`, { accounts: bad.map((t) => t.socialAccountId) });
  }

  // ───────────── Approval ─────────────

  async submit(id: string): Promise<SocialPostDto> {
    const p = await this.row(id);
    const { userId, canPublish } = this.ctx();
    if (p.status !== 'DRAFT') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'Only drafts can be submitted');
    if (!canPublish && p.createdById !== userId) throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You can only submit your own drafts');
    this.assertReady(p);
    await this.db.socialPost.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date(), approvedAt: null, approvedById: null, reviewNote: null } });
    await this.audit.record('social.post_submitted', 'social_post', id, { preview: preview(p.caption) });
    return this.getWithMedia(id);
  }

  async approve(id: string, note?: string): Promise<SocialPostDto> {
    const p = await this.row(id);
    const { userId, isAdmin } = this.ctx();
    if (p.status !== 'PENDING_APPROVAL') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'This post is not waiting for approval');
    const settings = await this.settings();
    if (settings.requireApproval && p.createdById === userId && !isAdmin) {
      throw new AppException(HttpStatus.FORBIDDEN, 'SELF_APPROVAL_NOT_ALLOWED', 'Another publisher must approve your post');
    }
    this.assertReady(p);
    await this.db.socialPost.update({ where: { id }, data: { status: 'DRAFT', approvedAt: new Date(), approvedById: userId, reviewNote: note ?? null } });
    await this.audit.record('social.post_approved', 'social_post', id, { preview: preview(p.caption) });
    await this.notifyReview(p, true, note ?? null);
    return this.getWithMedia(id);
  }

  async reject(id: string, note: string): Promise<SocialPostDto> {
    const p = await this.row(id);
    if (p.status !== 'PENDING_APPROVAL') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'This post is not waiting for approval');
    await this.db.socialPost.update({ where: { id }, data: { status: 'DRAFT', approvedAt: null, approvedById: null, reviewNote: note } });
    await this.audit.record('social.post_rejected', 'social_post', id, { preview: preview(p.caption) });
    await this.notifyReview(p, false, note);
    return this.getWithMedia(id);
  }

  private async notifyReview(p: PostRow, approved: boolean, note: string | null) {
    const { userId } = this.ctx();
    if (!p.createdById || p.createdById === userId) return;
    const [author, reviewer] = await Promise.all([
      this.prisma.system.user.findUnique({ where: { id: p.createdById }, select: { email: true, name: true } }),
      userId ? this.prisma.system.user.findUnique({ where: { id: userId }, select: { name: true } }) : null,
    ]);
    if (!author) return;
    const t = emailTemplates.postReviewed({ name: author.name, approved, reviewer: reviewer?.name ?? 'A publisher', note, preview: preview(p.caption), url: `${this.env.WEB_URL}/marketing/social/${p.id}` });
    await this.email.send({ to: author.email, subject: t.subject, html: t.html, text: t.text, tag: t.tag, organizationId: p.organizationId }).catch((e) => this.logger.warn(`Review email failed: ${(e as Error).message}`));
  }

  // ───────────── Scheduling & publishing ─────────────

  private async assertApproved(p: PostRow) {
    const settings = await this.settings();
    if (settings.requireApproval && !p.approvedAt) throw new AppException(HttpStatus.CONFLICT, 'APPROVAL_REQUIRED', 'This post must be approved before it can be scheduled or published');
    if (p.status === 'PENDING_APPROVAL') throw new AppException(HttpStatus.CONFLICT, 'APPROVAL_REQUIRED', 'Approve or reject the post first');
  }

  /** Quota: each target counts once in the month it publishes; moving within the same month is free. */
  private async assertQuota(p: PostRow, at: Date) {
    const alreadyCounted = p.status === 'SCHEDULED' && p.scheduledAt && monthWindow(p.scheduledAt).start.getTime() === monthWindow(at).start.getTime();
    const thisMonth = monthWindow(new Date()).start.getTime() === monthWindow(at).start.getTime();
    // Usage covers the current month only; schedules for later months are checked when that month's usage is known.
    if (!alreadyCounted && thisMonth) await this.usage.assertWithinLimit(p.organizationId, 'postsPerMonth', p.targets.length);
  }

  async schedule(id: string, input: SchedulePostInput): Promise<SocialPostDto> {
    const at = new Date(input.scheduledAt);
    const now = Date.now();
    if (at.getTime() <= now) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'SCHEDULE_IN_PAST', 'Choose a time in the future');
    if (at.getTime() > now + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'SCHEDULE_TOO_FAR', 'Posts can be scheduled up to 6 months ahead');
    return this.queuePost(id, at, input.timezone, 'social.post_scheduled');
  }

  async publishNow(id: string): Promise<SocialPostDto> {
    return this.queuePost(id, new Date(), null, 'social.post_publish_requested');
  }

  private async queuePost(id: string, at: Date, timezone: string | null, action: string): Promise<SocialPostDto> {
    const p = await this.row(id);
    if (p.status !== 'DRAFT' && p.status !== 'SCHEDULED') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', `A ${p.status.toLowerCase().replace('_', ' ')} post cannot be scheduled`);
    await this.assertApproved(p);
    this.assertReady(p);
    await this.assertQuota(p, at);
    if (p.status === 'SCHEDULED') await this.removeJob(p);
    const tz = timezone ?? p.timezone ?? (await this.prisma.system.organization.findUnique({ where: { id: p.organizationId }, select: { timezone: true } }))?.timezone ?? 'UTC';
    await this.db.socialPost.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt: at, timezone: tz } });
    await this.db.socialPostTarget.updateMany({ where: { postId: id }, data: { status: 'PENDING', attempts: 0, error: null, errorCode: null, nextAttemptAt: null } });
    await this.enqueuePost(p.organizationId, id, at);
    await this.audit.record(action, 'social_post', id, { at: at.toISOString(), accounts: p.targets.map((t) => t.accountName) });
    return this.getWithMedia(id);
  }

  async cancel(id: string): Promise<SocialPostDto> {
    const p = await this.row(id);
    if (p.status !== 'SCHEDULED') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'Only scheduled posts can be canceled');
    const res = await this.db.socialPost.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'DRAFT', scheduledAt: null } });
    if (!res.count) throw new AppException(HttpStatus.CONFLICT, 'POST_LOCKED', 'Publishing has already started');
    await this.removeJob(p);
    await this.audit.record('social.post_unscheduled', 'social_post', id, {});
    return this.getWithMedia(id);
  }

  async retry(postId: string, targetId: string): Promise<SocialPostDto> {
    const p = await this.row(postId);
    const t = p.targets.find((x) => x.id === targetId);
    if (!t) throw notFound('Target');
    if (t.status !== 'FAILED') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'Only failed accounts can be retried');
    if (!t.account || t.account.status !== 'ACTIVE') throw new AppException(HttpStatus.CONFLICT, 'ACCOUNT_NEEDS_ATTENTION', `${t.accountName} must be reconnected first`);
    await this.usage.assertWithinLimit(p.organizationId, 'postsPerMonth', 1);
    await this.db.socialPostTarget.update({ where: { id: targetId }, data: { status: 'PENDING', attempts: 0, error: null, errorCode: null, nextAttemptAt: null } });
    await this.db.socialPost.update({ where: { id: postId }, data: { status: 'PUBLISHING' } });
    await this.enqueueTarget(p.organizationId, postId, targetId, 0);
    await this.audit.record('social.post_retried', 'social_post', postId, { account: t.accountName });
    return this.getWithMedia(postId);
  }

  // ───────────── Queue plumbing ─────────────

  jobIdFor(postId: string, at: Date) {
    return `post-${postId}-${at.getTime()}`;
  }

  async enqueuePost(organizationId: string, postId: string, at: Date) {
    await this.queue.add('post', { kind: 'post', organizationId, postId, scheduledAtMs: at.getTime() }, { jobId: this.jobIdFor(postId, at), delay: Math.max(0, at.getTime() - Date.now()), removeOnComplete: true, removeOnFail: 100 });
  }

  async enqueueTarget(organizationId: string, postId: string, targetId: string, delayMs: number) {
    await this.queue.add('target', { kind: 'target', organizationId, postId, targetId }, { jobId: `target-${targetId}-${Date.now()}`, delay: delayMs, removeOnComplete: true, removeOnFail: 100 });
  }

  private async removeJob(p: Pick<SocialPost, 'id' | 'scheduledAt'>) {
    if (!p.scheduledAt) return;
    const job = await this.queue.getJob(this.jobIdFor(p.id, p.scheduledAt));
    await job?.remove().catch(() => undefined);
  }
}
