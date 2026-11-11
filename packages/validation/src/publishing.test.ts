import { describe, expect, it } from 'vitest';
import { presignUploadSchema } from './index.js';
import {
  calendarQuerySchema,
  composeText,
  createPostSchema,
  monthWindow,
  publishNowSchema,
  schedulePostSchema,
  updatePostSchema,
  validateForPlatform,
  validatePost,
  zonedDateKey,
  zonedParts,
  zonedToUtc,
  type PostMedia,
} from './publishing.js';

const img = (w = 1080, h = 1080, mimeType = 'image/jpeg'): PostMedia => ({ fileId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', kind: 'image', mimeType, width: w, height: h, sizeBytes: 200_000 });
const vid = (durationSec = 30, mimeType = 'video/mp4'): PostMedia => ({ fileId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c', kind: 'video', mimeType, width: 1080, height: 1920, durationSec, sizeBytes: 5_000_000 });
const codes = (issues: Array<{ code: string; level: string }>, level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);

describe('composeText', () => {
  it('appends hashtags not already in the caption and prefers overrides', () => {
    expect(composeText('Onam sale! #Onam', ['onam', 'Kochi'])).toBe('Onam sale! #Onam\n\n#Kochi');
    expect(composeText('Hi', ['a'], 'LinkedIn text')).toBe('LinkedIn text\n\n#a');
    expect(composeText('', ['a'])).toBe('#a');
    // Malayalam vowel signs are combining marks and belong to the hashtag
    expect(composeText('ഓണം സെയിൽ #കേരളം', ['കേരളം'])).toBe('ഓണം സെയിൽ #കേരളം');
  });
});

describe('platform rules', () => {
  it('Facebook and LinkedIn allow text-only posts; Instagram and YouTube need media', () => {
    const post = { caption: 'Hello Kochi', hashtags: [], media: [] };
    expect(codes(validateForPlatform(post, { platform: 'FACEBOOK_PAGE' }))).toEqual([]);
    expect(codes(validateForPlatform(post, { platform: 'LINKEDIN_PAGE' }))).toEqual([]);
    expect(codes(validateForPlatform(post, { platform: 'INSTAGRAM_BUSINESS' }))).toContain('MEDIA_REQUIRED');
    expect(codes(validateForPlatform(post, { platform: 'YOUTUBE_CHANNEL', options: { title: 'T', privacy: 'public', madeForKids: false } }))).toContain('MEDIA_REQUIRED');
    expect(codes(validateForPlatform({ caption: '', hashtags: [], media: [] }, { platform: 'FACEBOOK_PAGE' }))).toEqual(['EMPTY']);
  });

  it('counts graphemes, not UTF-16 units, against text limits', () => {
    const ml = 'മലയാളം '.repeat(400); // 2,800 code units, 2,000 graphemes approx
    expect(codes(validateForPlatform({ caption: ml.slice(0, 2_000), hashtags: [], media: [img()] }, { platform: 'INSTAGRAM_BUSINESS' }))).not.toContain('TEXT_TOO_LONG');
    expect(codes(validateForPlatform({ caption: 'x'.repeat(3_001), hashtags: [], media: [] }, { platform: 'LINKEDIN_PAGE' }))).toContain('TEXT_TOO_LONG');
  });

  it('enforces Instagram hashtags, carousel size, JPEG and aspect ratio', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `t${i}`);
    expect(codes(validateForPlatform({ caption: 'x', hashtags: tags, media: [img()] }, { platform: 'INSTAGRAM_BUSINESS' }))).toContain('TOO_MANY_HASHTAGS');
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: Array.from({ length: 11 }, () => img()) }, { platform: 'INSTAGRAM_BUSINESS' }))).toContain('TOO_MANY_IMAGES');
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [img(1080, 1080, 'image/png')] }, { platform: 'INSTAGRAM_BUSINESS' }))).toContain('IMAGE_FORMAT');
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [img(1080, 1920)] }, { platform: 'INSTAGRAM_BUSINESS' }))).toContain('ASPECT_RATIO');
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [img(1080, 1350)] }, { platform: 'INSTAGRAM_BUSINESS' }))).toEqual([]);
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [img(1080, 1920)] }, { platform: 'FACEBOOK_PAGE' }))).toEqual([]);
  });

  it('checks video kinds, counts and durations', () => {
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [img(), vid()] }, { platform: 'FACEBOOK_PAGE' }))).toContain('MIXED_MEDIA');
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [vid(2)] }, { platform: 'INSTAGRAM_BUSINESS' }))).toContain('VIDEO_DURATION');
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [vid(30, 'video/quicktime')] }, { platform: 'LINKEDIN_PAGE' }))).toContain('VIDEO_FORMAT');
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [vid(), vid()] }, { platform: 'FACEBOOK_PAGE' }))).toContain('TOO_MANY_VIDEOS');
    const unknown = { ...vid(), durationSec: undefined };
    expect(codes(validateForPlatform({ caption: 'x', hashtags: [], media: [unknown] }, { platform: 'FACEBOOK_PAGE' }), 'warning')).toContain('VIDEO_DURATION_UNKNOWN');
  });

  it('requires YouTube title, privacy and made-for-kids, and rejects angle brackets', () => {
    const post = { caption: 'Watch our tour', hashtags: [], media: [vid()] };
    expect(codes(validateForPlatform(post, { platform: 'YOUTUBE_CHANNEL' }))).toEqual(['TITLE_REQUIRED', 'PRIVACY_REQUIRED', 'MADE_FOR_KIDS_REQUIRED']);
    expect(codes(validateForPlatform(post, { platform: 'YOUTUBE_CHANNEL', options: { title: 'Tour <2026>', privacy: 'unlisted', madeForKids: false } }))).toEqual(['TITLE_INVALID']);
    expect(codes(validateForPlatform(post, { platform: 'YOUTUBE_CHANNEL', options: { title: 'Tour', privacy: 'public', madeForKids: false } }))).toEqual([]);
    expect(codes(validateForPlatform({ ...post, media: [img()] }, { platform: 'YOUTUBE_CHANNEL', options: { title: 'T', privacy: 'public', madeForKids: true } }))).toContain('TOO_MANY_IMAGES');
  });

  it('warns about hashtag overuse and small images', () => {
    const issues = validateForPlatform({ caption: 'x', hashtags: ['a', 'b', 'c', 'd', 'e', 'f'], media: [img(400, 400, 'image/png')] }, { platform: 'LINKEDIN_PAGE' });
    expect(codes(issues, 'warning')).toEqual(['MANY_HASHTAGS', 'LOW_RESOLUTION']);
    expect(codes(issues)).toEqual([]);
  });

  it('summarises per-target results', () => {
    const r = validatePost({ caption: 'Hello', hashtags: [], media: [] }, [{ platform: 'FACEBOOK_PAGE' }, { platform: 'INSTAGRAM_BUSINESS', captionOverride: 'IG text' }]);
    expect(r.ok).toBe(false);
    expect(r.targets.map((t) => t.issues.length)).toEqual([0, 1]);
  });
});

describe('schemas', () => {
  it('validates posts, schedules and explicit publish confirmation', () => {
    expect(createPostSchema.safeParse({ workspaceId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', caption: 'Hi' }).success).toBe(true);
    expect(createPostSchema.safeParse({ workspaceId: 'x' }).success).toBe(false);
    expect(schedulePostSchema.safeParse({ scheduledAt: '2026-12-01T10:00:00+05:30', timezone: 'Asia/Kolkata' }).success).toBe(true);
    expect(schedulePostSchema.safeParse({ scheduledAt: '2026-12-01T10:00:00+05:30', timezone: 'Mars/Base' }).success).toBe(false);
    expect(updatePostSchema.parse({ caption: 'x' })).toEqual({ caption: 'x' }); // omitted fields stay omitted
    expect(publishNowSchema.safeParse({}).success).toBe(false);
    expect(publishNowSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(calendarQuerySchema.safeParse({ from: '2026-12-01T00:00:00Z', to: '2027-03-01T00:00:00Z' }).success).toBe(false);
  });

  it('allows large videos only as post media', () => {
    const base = { fileName: 'reel.mp4', mimeType: 'video/mp4', sizeBytes: 120 * 1024 * 1024 };
    expect(presignUploadSchema.safeParse({ ...base, purpose: 'POST_MEDIA' }).success).toBe(true);
    expect(presignUploadSchema.safeParse({ ...base, purpose: 'OTHER' }).success).toBe(false);
    expect(presignUploadSchema.safeParse({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 25 * 1024 * 1024, purpose: 'POST_MEDIA' }).success).toBe(false);
    expect(presignUploadSchema.safeParse({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000, purpose: 'POST_MEDIA' }).success).toBe(false);
  });
});

describe('time zones', () => {
  it('converts wall-clock time in a zone to UTC and back', () => {
    const d = zonedToUtc({ year: 2026, month: 12, day: 1, hour: 10, minute: 30 }, 'Asia/Kolkata');
    expect(d.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(zonedParts(d, 'Asia/Kolkata')).toMatchObject({ year: 2026, month: 12, day: 1, hour: 10, minute: 30, weekday: 2 });
    expect(zonedDateKey(new Date('2026-11-30T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-12-01');
    expect(zonedDateKey(new Date('2026-11-30T20:00:00Z'), 'Asia/Dubai')).toBe('2026-12-01');
    expect(zonedDateKey(new Date('2026-11-30T19:00:00Z'), 'Asia/Dubai')).toBe('2026-11-30');
  });
  it('handles daylight saving zones', () => {
    expect(zonedToUtc({ year: 2026, month: 7, day: 1, hour: 9 }, 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc({ year: 2026, month: 1, day: 1, hour: 9 }, 'Europe/London').toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });
  it('builds the monthly quota window in UTC', () => {
    const w = monthWindow(new Date('2026-12-31T23:59:00Z'));
    expect([w.start.toISOString(), w.end.toISOString()]).toEqual(['2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z']);
  });
});
