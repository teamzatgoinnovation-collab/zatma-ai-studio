import { z } from 'zod';

// ───────────── Catalogue ─────────────

export const COPY_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube', 'whatsapp', 'google_ads', 'meta_ads', 'email', 'sms', 'generic'] as const;
export type CopyPlatform = (typeof COPY_PLATFORMS)[number];

export const COPY_PLATFORM_LABELS: Record<CopyPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  email: 'Email',
  sms: 'SMS',
  generic: 'Any platform',
};

export const COPY_KINDS = [
  'headline',
  'caption',
  'hashtags',
  'ad_primary_text',
  'ad_headline',
  'ad_description',
  'product_description',
  'cta',
  'whatsapp_message',
  'email_subject',
  'sms',
] as const;
export type CopyKind = (typeof COPY_KINDS)[number];

export interface CopyKindInfo {
  label: string;
  description: string;
  defaultPlatform: CopyPlatform;
  /** Recommended length in characters (graphemes); longer text gets a soft warning. */
  recommended: number | null;
}

export const COPY_KIND_INFO: Record<CopyKind, CopyKindInfo> = {
  headline: { label: 'Headline', description: 'Short, punchy line for a poster or post', defaultPlatform: 'generic', recommended: 60 },
  caption: { label: 'Social caption', description: 'Post caption with a hook and call to action', defaultPlatform: 'instagram', recommended: 300 },
  hashtags: { label: 'Hashtags', description: 'Relevant, local and niche hashtags', defaultPlatform: 'instagram', recommended: null },
  ad_primary_text: { label: 'Ad primary text', description: 'Main text shown above an ad', defaultPlatform: 'meta_ads', recommended: 125 },
  ad_headline: { label: 'Ad headline', description: 'Headline under an ad image', defaultPlatform: 'meta_ads', recommended: 40 },
  ad_description: { label: 'Ad description', description: 'Supporting line for an ad', defaultPlatform: 'meta_ads', recommended: 30 },
  product_description: { label: 'Product description', description: 'Benefits-first description for a product or service', defaultPlatform: 'generic', recommended: 600 },
  cta: { label: 'Call to action', description: 'Button or closing line', defaultPlatform: 'generic', recommended: 25 },
  whatsapp_message: { label: 'WhatsApp message', description: 'Friendly broadcast or follow-up message', defaultPlatform: 'whatsapp', recommended: 500 },
  email_subject: { label: 'Email subject', description: 'Subject line that gets opened', defaultPlatform: 'email', recommended: 60 },
  sms: { label: 'SMS', description: 'Short text message', defaultPlatform: 'sms', recommended: 160 },
};

/** Hard platform limits (characters), where the platform enforces one for this kind of text. */
export function hardLimit(kind: CopyKind, platform: CopyPlatform): number | null {
  if (kind === 'hashtags') return null;
  if (platform === 'google_ads') {
    if (kind === 'ad_headline' || kind === 'headline') return 30;
    if (kind === 'ad_description' || kind === 'ad_primary_text') return 90;
  }
  if (kind === 'email_subject') return 150;
  switch (platform) {
    case 'instagram':
      return 2200;
    case 'linkedin':
      return 3000;
    case 'youtube':
      return 5000;
    case 'whatsapp':
      return 4096;
    case 'facebook':
    case 'meta_ads':
      return 63206;
    default:
      return null;
  }
}

export const MAX_HASHTAGS: Partial<Record<CopyPlatform, number>> = { instagram: 30, linkedin: 5, youtube: 15, facebook: 10 };

export const COPY_TONES = ['professional', 'friendly', 'persuasive', 'luxury', 'playful', 'urgent', 'festive', 'informative'] as const;
export type CopyTone = (typeof COPY_TONES)[number];

export const COPY_GOALS = ['awareness', 'engagement', 'leads', 'sales', 'event', 'announcement'] as const;
export type CopyGoal = (typeof COPY_GOALS)[number];

export const REWRITE_ACTIONS = ['shorter', 'longer', 'more_formal', 'more_casual', 'more_persuasive', 'add_emojis', 'remove_emojis', 'custom'] as const;
export type RewriteAction = (typeof REWRITE_ACTIONS)[number];

export const REWRITE_ACTION_LABELS: Record<RewriteAction, string> = {
  shorter: 'Make shorter',
  longer: 'Make longer',
  more_formal: 'More formal',
  more_casual: 'More casual',
  more_persuasive: 'More persuasive',
  add_emojis: 'Add emojis',
  remove_emojis: 'Remove emojis',
  custom: 'Custom instruction…',
};

// ───────────── Counting & limits ─────────────

/** User-perceived characters (grapheme clusters): a Malayalam conjunct or a flag emoji counts once. */
export function countGraphemes(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) n++;
    return n;
  }
  return Array.from(text).length;
}

const GSM_CHARS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€",
);

/** SMS segments: 160/153 characters in the GSM alphabet, otherwise 70/67 UTF-16 units (Malayalam, Arabic, emoji). */
export function smsSegments(text: string): { encoding: 'GSM-7' | 'UCS-2'; segments: number; perSegment: number } {
  const gsm = [...text].every((c) => GSM_CHARS.has(c));
  const units = gsm ? [...text].length : text.length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return { encoding: gsm ? 'GSM-7' : 'UCS-2', segments: units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi), perSegment: single };
}

export interface LimitCheck {
  count: number;
  recommended: number | null;
  max: number | null;
  /** Exceeds a hard platform limit. */
  overLimit: boolean;
  /** Longer than recommended (soft). */
  long: boolean;
  hashtagCount: number;
  maxHashtags: number | null;
  sms?: ReturnType<typeof smsSegments>;
}

export function checkLimits(kind: CopyKind, platform: CopyPlatform, text: string, hashtags: string[] = []): LimitCheck {
  const count = countGraphemes(text);
  const recommended = COPY_KIND_INFO[kind].recommended;
  const max = hardLimit(kind, platform);
  const maxHashtags = MAX_HASHTAGS[platform] ?? null;
  const hashtagCount = hashtags.length + (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0);
  return {
    count,
    recommended,
    max,
    overLimit: (max !== null && count > max) || (maxHashtags !== null && hashtagCount > maxHashtags),
    long: recommended !== null && count > recommended,
    hashtagCount,
    maxHashtags,
    ...(kind === 'sms' || platform === 'sms' ? { sms: smsSegments(text) } : {}),
  };
}

/** Right-to-left scripts among our languages. */
export const isRtlLanguage = (language: string) => language === 'ar';

/** Normalises hashtags: one leading '#', no spaces, de-duplicated (case-insensitive). */
export function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = `#${raw.trim().replace(/^#+/, '').replace(/\s+/g, '')}`;
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** Digit runs, phone numbers and URLs that must survive translation unchanged. */
export function protectedTokens(text: string): string[] {
  const urls = text.match(/https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|in|ae|net|org|io|co)\b\S*/gi) ?? [];
  const rest = urls.reduce((t, u) => t.replace(u, ' '), text);
  const numbers = (rest.match(/[+]?\d(?:[\s,.-]?\d)*/g) ?? []).map((n) => n.replace(/[\s,.-]/g, ''));
  return [...urls.map((u) => u.toLowerCase().replace(/[.,!?)]+$/, '')), ...numbers];
}

/** Tokens from the source that are missing in the translation (digits compared after normalising any script's digits). */
export function missingTokens(source: string, translated: string): string[] {
  const norm = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const target = protectedTokens(norm(translated));
  const pool = [...target];
  const missing: string[] = [];
  for (const tok of protectedTokens(norm(source))) {
    const i = pool.indexOf(tok);
    if (i === -1) missing.push(tok);
    else pool.splice(i, 1);
  }
  return missing;
}

// ───────────── API inputs ─────────────

/** Same list as `LANGUAGES` in index.ts (kept local to avoid an import cycle). */
export const COPY_LANGUAGES = ['en', 'ml', 'ar', 'hi', 'ta', 'kn', 'te'] as const;
const language = z.enum(COPY_LANGUAGES);

export const generateCopySchema = z
  .object({
    kind: z.enum(COPY_KINDS),
    brief: z.string().trim().min(10, 'Describe what the copy is for in a sentence or two').max(2000),
    language: language.default('en'),
    tone: z.enum(COPY_TONES).default('friendly'),
    platform: z.enum(COPY_PLATFORMS).default('generic'),
    goal: z.enum(COPY_GOALS).default('sales'),
    audience: z.string().trim().max(200).optional(),
    keywords: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    brandKitId: z.uuid().nullable().optional(),
    variants: z.number().int().min(1).max(5).default(3),
    includeEmojis: z.boolean().default(true),
    includeHashtags: z.boolean().default(true),
  })
  .strict();
export type GenerateCopyInput = z.infer<typeof generateCopySchema>;

export const translateCopySchema = z
  .object({
    text: z.string().trim().min(1).max(5000),
    hashtags: z.array(z.string().trim().max(60)).max(30).default([]),
    sourceLanguage: language.optional(),
    targetLanguages: z.array(language).min(1).max(6),
    tone: z.enum(COPY_TONES).optional(),
  })
  .strict()
  .refine((v) => new Set(v.targetLanguages).size === v.targetLanguages.length, { message: 'Languages must be unique', path: ['targetLanguages'] });
export type TranslateCopyInput = z.infer<typeof translateCopySchema>;

export const rewriteCopySchema = z
  .object({
    text: z.string().trim().min(1).max(5000),
    language: language.default('en'),
    action: z.enum(REWRITE_ACTIONS),
    instruction: z.string().trim().min(3).max(300).optional(),
  })
  .strict()
  .refine((v) => v.action !== 'custom' || !!v.instruction, { message: 'Describe how to rewrite the text', path: ['instruction'] });
export type RewriteCopyInput = z.infer<typeof rewriteCopySchema>;

export const saveCopyAssetSchema = z
  .object({
    kind: z.enum(COPY_KINDS),
    content: z.string().trim().min(1).max(5000),
    hashtags: z.array(z.string().trim().max(60)).max(30).default([]),
    language: language.default('en'),
    tone: z.enum(COPY_TONES).optional(),
    platform: z.enum(COPY_PLATFORMS).default('generic'),
    goal: z.enum(COPY_GOALS).optional(),
    audience: z.string().trim().max(200).optional(),
    brief: z.string().trim().max(2000).optional(),
    variants: z.array(z.string().max(5000)).max(5).optional(),
    workspaceId: z.uuid().optional(),
    brandKitId: z.uuid().nullable().optional(),
    sourceDesignId: z.uuid().nullable().optional(),
    favorite: z.boolean().default(false),
  })
  .strict();
export type SaveCopyAssetInput = z.infer<typeof saveCopyAssetSchema>;

export const updateCopyAssetSchema = z
  .object({
    content: z.string().trim().min(1).max(5000).optional(),
    hashtags: z.array(z.string().trim().max(60)).max(30).optional(),
    favorite: z.boolean().optional(),
  })
  .strict();
export type UpdateCopyAssetInput = z.infer<typeof updateCopyAssetSchema>;

export const listCopyAssetsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  kind: z.enum(COPY_KINDS).optional(),
  language: language.optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  workspaceId: z.uuid().optional(),
});
export type ListCopyAssetsInput = z.infer<typeof listCopyAssetsSchema>;

export const translateDesignSchema = z.object({ language }).strict();

// ───────────── Model output ─────────────

export const copyOutputSchema = z.object({
  variants: z
    .array(z.object({ text: z.string().trim().min(1).max(6000), hashtags: z.array(z.string().trim().max(80)).max(40).optional().default([]) }))
    .min(1)
    .max(5),
});

export const translationOutputSchema = z.object({
  translations: z.array(z.object({ language: z.string(), text: z.string().trim().min(1).max(6000), hashtags: z.array(z.string().trim().max(80)).max(40).optional().default([]) })).min(1),
});

export const rewriteOutputSchema = z.object({ text: z.string().trim().min(1).max(6000) });

export const designTranslationOutputSchema = z.object({
  layers: z.array(z.object({ id: z.string(), text: z.string().max(2000) })),
  caption: z.string().max(2200).optional().default(''),
  hashtags: z.array(z.string().trim().max(80)).max(40).optional().default([]),
});

// ───────────── API responses ─────────────

export interface CopyVariant {
  text: string;
  hashtags: string[];
  limits: LimitCheck;
}

export interface CopyGenerationResult {
  variants: CopyVariant[];
  provider: string;
  model: string;
  credits: number;
}

export interface CopyTranslation {
  language: string;
  text: string;
  hashtags: string[];
  /** Numbers, phone numbers or URLs from the source that the translation dropped or changed. */
  warnings: string[];
}

export interface CopyTranslationResult {
  translations: CopyTranslation[];
  provider: string;
  model: string;
  credits: number;
}

export interface CopyRewriteResult {
  text: string;
  provider: string;
  model: string;
  credits: number;
}

export interface CopyAssetDto {
  id: string;
  kind: CopyKind;
  content: string;
  hashtags: string[];
  language: string;
  tone: string | null;
  platform: string;
  goal: string | null;
  audience: string | null;
  brief: string | null;
  variants: string[];
  favorite: boolean;
  workspaceId: string;
  brandKitId: string | null;
  sourceDesignId: string | null;
  campaignId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}
