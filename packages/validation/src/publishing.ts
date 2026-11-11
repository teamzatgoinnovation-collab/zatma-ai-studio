import { z } from 'zod';
import { countGraphemes, normalizeHashtags } from './copy.js';
import { PLATFORM_LABELS, type SocialPlatform } from './social.js';

// ───────────── Statuses ─────────────

export const POST_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'CANCELED'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const TARGET_STATUSES = ['PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED'] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

/** Posts can be edited until publishing starts. */
export const EDITABLE_POST_STATUSES: readonly PostStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED'];
export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  SCHEDULED: 'Scheduled',
  PUBLISHING: 'Publishing',
  PUBLISHED: 'Published',
  PARTIALLY_PUBLISHED: 'Partly published',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
};

// ───────────── Platform rules (official limits) ─────────────

export interface PlatformRules {
  /** Max characters (graphemes) of the post text / description. */
  maxText: number;
  /** Hard hashtag cap (error) and the recommended count (warning). */
  maxHashtags: number | null;
  recommendedHashtags: number | null;
  textOnly: boolean;
  maxImages: number;
  video: boolean;
  videoRequired: boolean;
  minVideoSec: number;
  maxVideoSec: number;
  imageMimeTypes: readonly string[];
  videoMimeTypes: readonly string[];
  /** Allowed image aspect ratio (width / height). */
  aspect: { min: number; max: number } | null;
}

export const PLATFORM_RULES: Record<SocialPlatform, PlatformRules> = {
  FACEBOOK_PAGE: {
    maxText: 63_206,
    maxHashtags: null,
    recommendedHashtags: 10,
    textOnly: true,
    maxImages: 10,
    video: true,
    videoRequired: false,
    minVideoSec: 1,
    maxVideoSec: 240 * 60,
    imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    videoMimeTypes: ['video/mp4', 'video/quicktime'],
    aspect: null,
  },
  INSTAGRAM_BUSINESS: {
    maxText: 2_200,
    maxHashtags: 30,
    recommendedHashtags: null,
    textOnly: false,
    maxImages: 10,
    video: true,
    videoRequired: false,
    minVideoSec: 3,
    maxVideoSec: 15 * 60,
    imageMimeTypes: ['image/jpeg'],
    videoMimeTypes: ['video/mp4', 'video/quicktime'],
    aspect: { min: 4 / 5, max: 1.91 },
  },
  LINKEDIN_PAGE: {
    maxText: 3_000,
    maxHashtags: null,
    recommendedHashtags: 5,
    textOnly: true,
    maxImages: 20,
    video: true,
    videoRequired: false,
    minVideoSec: 3,
    maxVideoSec: 30 * 60,
    imageMimeTypes: ['image/jpeg', 'image/png'],
    videoMimeTypes: ['video/mp4'],
    aspect: null,
  },
  YOUTUBE_CHANNEL: {
    maxText: 5_000,
    maxHashtags: 15,
    recommendedHashtags: null,
    textOnly: false,
    maxImages: 0,
    video: true,
    videoRequired: true,
    minVideoSec: 1,
    maxVideoSec: 12 * 3600,
    imageMimeTypes: [],
    videoMimeTypes: ['video/mp4', 'video/quicktime'],
    aspect: null,
  },
};

// ───────────── Schemas ─────────────

const uuid = z.uuid();
const IANA = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
export const timezoneSchema = z.string().min(1).max(64).refine(IANA, 'Unknown time zone');

export const postMediaSchema = z
  .object({
    fileId: uuid,
    kind: z.enum(['image', 'video']),
    mimeType: z.string().max(100),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
    durationSec: z.number().positive().max(12 * 3600).optional(),
    sizeBytes: z.number().int().positive(),
    altText: z.string().trim().max(1_000).optional(),
  })
  .strict();
export type PostMedia = z.infer<typeof postMediaSchema>;

export const YOUTUBE_PRIVACY = ['public', 'unlisted', 'private'] as const;
export const targetOptionsSchema = z
  .object({
    /** YouTube video title. */
    title: z.string().trim().max(100).optional(),
    privacy: z.enum(YOUTUBE_PRIVACY).optional(),
    madeForKids: z.boolean().optional(),
  })
  .strict();
export type TargetOptions = z.infer<typeof targetOptionsSchema>;

export const postTargetInputSchema = z
  .object({
    socialAccountId: uuid,
    captionOverride: z.string().max(63_206).nullable().optional(),
    options: targetOptionsSchema.optional(),
  })
  .strict();
export type PostTargetInput = z.infer<typeof postTargetInputSchema>;

const postFields = {
  caption: z.string().max(63_206).default(''),
  hashtags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  media: z.array(postMediaSchema).max(20).default([]),
  targets: z.array(postTargetInputSchema).max(25).default([]),
  sourceDesignId: uuid.nullable().optional(),
  copyAssetId: uuid.nullable().optional(),
};

export const createPostSchema = z.object({ workspaceId: uuid, ...postFields }).strict();
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type CreatePostRequest = z.input<typeof createPostSchema>;

// No defaults here: a PATCH must leave omitted fields untouched (Zod 4 applies defaults even inside .optional()).
export const updatePostSchema = z
  .object({
    caption: z.string().max(63_206).optional(),
    hashtags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    media: z.array(postMediaSchema).max(20).optional(),
    targets: z.array(postTargetInputSchema).max(25).optional(),
    sourceDesignId: postFields.sourceDesignId,
    copyAssetId: postFields.copyAssetId,
  })
  .strict();
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type UpdatePostRequest = z.input<typeof updatePostSchema>;

export const MAX_SCHEDULE_AHEAD_DAYS = 183;
export const schedulePostSchema = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }),
    timezone: timezoneSchema,
  })
  .strict();
export type SchedulePostInput = z.infer<typeof schedulePostSchema>;

/** Publishing now is an outward action: the client must confirm explicitly. */
export const publishNowSchema = z.object({ confirm: z.literal(true, 'Confirm publishing to the selected accounts') }).strict();
export const approvePostSchema = z.object({ note: z.string().trim().max(1_000).optional() }).strict();
export const rejectPostSchema = z.object({ note: z.string().trim().min(1, 'Say what needs to change').max(1_000) }).strict();

export const listPostsSchema = z.object({
  status: z.enum(POST_STATUSES).optional(),
  platform: z.enum(['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'LINKEDIN_PAGE', 'YOUTUBE_CHANNEL']).optional(),
  workspaceId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListPostsQuery = z.infer<typeof listPostsSchema>;

export const calendarQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    workspaceId: uuid.optional(),
    platform: listPostsSchema.shape.platform,
    status: z.enum(POST_STATUSES).optional(),
  })
  .refine((v) => new Date(v.to).getTime() > new Date(v.from).getTime(), { message: '`to` must be after `from`', path: ['to'] })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 62 * 86_400_000, { message: 'Range is limited to 62 days', path: ['to'] });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const socialSettingsSchema = z.object({ requireApproval: z.boolean() }).strict();
export type SocialSettings = z.infer<typeof socialSettingsSchema>;
export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = { requireApproval: false };

// ───────────── Composition & validation ─────────────

const HASHTAG_RE = /(^|\s)#[\p{L}\p{M}\p{N}_]+/gu;

/** Final text sent to the platform: caption (or per-account override) followed by hashtags not already in it. */
export function composeText(caption: string, hashtags: string[], override?: string | null): string {
  const base = (override ?? caption).trim();
  const present = new Set((base.match(HASHTAG_RE) ?? []).map((t) => t.trim().toLowerCase()));
  const extra = normalizeHashtags(hashtags).filter((t) => !present.has(t.toLowerCase()));
  return extra.length ? `${base}${base ? '\n\n' : ''}${extra.join(' ')}` : base;
}

export const countHashtags = (text: string) => (text.match(HASHTAG_RE) ?? []).length;

export interface PostIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidateTarget {
  platform: SocialPlatform;
  captionOverride?: string | null;
  options?: TargetOptions;
}

export interface ValidatePostInput {
  caption: string;
  hashtags: string[];
  media: PostMedia[];
}

/** Checks one post against one platform's rules. Errors block publishing; warnings inform. */
export function validateForPlatform(post: ValidatePostInput, target: ValidateTarget): PostIssue[] {
  const rules = PLATFORM_RULES[target.platform];
  const label = PLATFORM_LABELS[target.platform];
  const issues: PostIssue[] = [];
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });

  const text = composeText(post.caption, post.hashtags, target.captionOverride);
  const length = countGraphemes(text);
  if (length > rules.maxText) err('TEXT_TOO_LONG', `${label} allows ${rules.maxText.toLocaleString('en-US')} characters (${length.toLocaleString('en-US')} used).`);
  const tags = countHashtags(text);
  if (rules.maxHashtags !== null && tags > rules.maxHashtags) err('TOO_MANY_HASHTAGS', `${label} allows at most ${rules.maxHashtags} hashtags (${tags} used).`);
  else if (rules.recommendedHashtags !== null && tags > rules.recommendedHashtags) warn('MANY_HASHTAGS', `${label} posts usually do best with ${rules.recommendedHashtags} or fewer hashtags.`);

  const images = post.media.filter((m) => m.kind === 'image');
  const videos = post.media.filter((m) => m.kind === 'video');
  if (images.length && videos.length) err('MIXED_MEDIA', 'Use either images or one video in a post, not both.');
  if (!post.media.length && !text) err('EMPTY', 'Add text or media.');
  if (!post.media.length && !rules.textOnly) err('MEDIA_REQUIRED', rules.videoRequired ? `${label} needs a video.` : `${label} needs at least one image or a video.`);
  if (rules.videoRequired && videos.length !== 1) {
    if (images.length || videos.length > 1) err('VIDEO_REQUIRED', `${label} needs exactly one video.`);
  }
  if (images.length > rules.maxImages) err('TOO_MANY_IMAGES', rules.maxImages ? `${label} allows up to ${rules.maxImages} images.` : `${label} doesn't support images.`);
  if (videos.length > 1) err('TOO_MANY_VIDEOS', `${label} allows one video per post.`);

  for (const [i, m] of images.entries()) {
    const n = images.length > 1 ? ` (image ${i + 1})` : '';
    if (rules.imageMimeTypes.length && !rules.imageMimeTypes.includes(m.mimeType)) {
      err('IMAGE_FORMAT', `${label} needs ${rules.imageMimeTypes.map((t) => t.split('/')[1]!.toUpperCase()).join(' or ')} images${n}.`);
    }
    const ratio = m.width / m.height;
    if (rules.aspect && (ratio < rules.aspect.min - 0.005 || ratio > rules.aspect.max + 0.005)) {
      err('ASPECT_RATIO', `${label} images must be between 4:5 portrait and 1.91:1 landscape${n}.`);
    }
    if (Math.min(m.width, m.height) < 600) warn('LOW_RESOLUTION', `Image${n} is small (${m.width}×${m.height}); it may look blurry.`);
  }
  for (const v of videos) {
    if (!rules.video) continue;
    if (!rules.videoMimeTypes.includes(v.mimeType)) err('VIDEO_FORMAT', `${label} needs ${rules.videoMimeTypes.map((t) => (t === 'video/quicktime' ? 'MOV' : 'MP4')).join(' or ')} video.`);
    if (v.durationSec === undefined) warn('VIDEO_DURATION_UNKNOWN', 'The video length could not be read; the platform may reject it.');
    else if (v.durationSec < rules.minVideoSec || v.durationSec > rules.maxVideoSec) {
      err('VIDEO_DURATION', `${label} videos must be ${rules.minVideoSec} s to ${formatDuration(rules.maxVideoSec)} long.`);
    }
  }

  if (target.platform === 'YOUTUBE_CHANNEL') {
    const title = target.options?.title?.trim() ?? '';
    if (!title) err('TITLE_REQUIRED', 'Add a YouTube title.');
    else if (/[<>]/.test(title)) err('TITLE_INVALID', 'YouTube titles cannot contain < or >.');
    if (/[<>]/.test(text)) err('DESCRIPTION_INVALID', 'YouTube descriptions cannot contain < or >.');
    if (!target.options?.privacy) err('PRIVACY_REQUIRED', 'Choose who can see the video (public, unlisted or private).');
    if (target.options?.madeForKids === undefined) err('MADE_FOR_KIDS_REQUIRED', 'Say whether the video is made for kids (required by YouTube).');
  }
  return issues;
}

export function formatDuration(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} h`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  return `${sec} s`;
}

export interface TargetValidation {
  platform: SocialPlatform;
  socialAccountId?: string;
  issues: PostIssue[];
}

export function validatePost(post: ValidatePostInput, targets: Array<ValidateTarget & { socialAccountId?: string }>): { ok: boolean; targets: TargetValidation[] } {
  const results = targets.map((t) => ({ platform: t.platform, socialAccountId: t.socialAccountId, issues: validateForPlatform(post, t) }));
  return { ok: results.every((r) => r.issues.every((i) => i.level !== 'error')), targets: results };
}

// ───────────── Time zones ─────────────

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute!, weekday: weekdays.indexOf(p.weekday!) };
}

/** UTC instant for a wall-clock time in `timeZone` (handles DST by re-checking the offset). */
export function zonedToUtc(local: { year: number; month: number; day: number; hour?: number; minute?: number }, timeZone: string): Date {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = asUtc - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/** "YYYY-MM-DD" of `date` in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** First instant of the UTC calendar month containing `date`, and of the next month (quota window). */
export function monthWindow(date: Date): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)), end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)) };
}

// ───────────── DTOs ─────────────

export interface PostMediaDto extends PostMedia {
  /** Short-lived URL for previews in the app. */
  url: string | null;
}

export interface PostTargetDto {
  id: string;
  socialAccountId: string;
  platform: SocialPlatform;
  account: { name: string; username: string | null; avatarUrl: string | null; status: string };
  captionOverride: string | null;
  options: TargetOptions;
  status: TargetStatus;
  attempts: number;
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  errorCode: string | null;
  lastAttemptAt: string | null;
  publishedAt: string | null;
}

export interface PersonRef {
  id: string;
  name: string;
}

export interface SocialPostDto {
  id: string;
  workspaceId: string;
  caption: string;
  hashtags: string[];
  media: PostMediaDto[];
  status: PostStatus;
  scheduledAt: string | null;
  timezone: string | null;
  publishedAt: string | null;
  sourceDesignId: string | null;
  copyAssetId: string | null;
  createdBy: PersonRef | null;
  submittedAt: string | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  reviewNote: string | null;
  targets: PostTargetDto[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEntry {
  id: string;
  status: PostStatus;
  at: string;
  caption: string;
  thumbnailUrl: string | null;
  platforms: SocialPlatform[];
  accounts: Array<{ id: string; name: string; platform: SocialPlatform }>;
}

export interface PublishingSettingsDto extends SocialSettings {
  canPublish: boolean;
  canDraft: boolean;
}
