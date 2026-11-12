import { z } from 'zod';
import { countGraphemes } from './copy.js';
import { withoutDefaults } from './patch.js';

// ───────────── Enums ─────────────

export const AD_PLATFORMS = ['META', 'GOOGLE'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];
export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = { META: 'Meta (Facebook & Instagram)', GOOGLE: 'Google Ads' };

export const AD_OBJECTIVES = ['TRAFFIC', 'ENGAGEMENT', 'MESSAGES', 'AWARENESS', 'LEADS', 'SEARCH'] as const;
export type AdObjective = (typeof AD_OBJECTIVES)[number];
export const OBJECTIVES_BY_PLATFORM: Record<AdPlatform, AdObjective[]> = { META: ['TRAFFIC', 'ENGAGEMENT', 'MESSAGES', 'AWARENESS', 'LEADS'], GOOGLE: ['SEARCH'] };
export const OBJECTIVE_INFO: Record<AdObjective, { label: string; description: string }> = {
  TRAFFIC: { label: 'Traffic', description: 'Send people to your website or landing page.' },
  ENGAGEMENT: { label: 'Engagement', description: 'Get more likes, comments and shares on your post.' },
  MESSAGES: { label: 'Messages', description: 'Start conversations on WhatsApp or Messenger.' },
  AWARENESS: { label: 'Awareness', description: 'Show your ad to as many people nearby as possible.' },
  LEADS: { label: 'Leads', description: 'Collect names and phone numbers with an instant form.' },
  SEARCH: { label: 'Search', description: 'Appear on Google when people search for what you sell.' },
};

export const CAMPAIGN_STATUSES = ['DRAFT', 'PUBLISHING', 'PAUSED', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'ERROR'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHING: 'Creating…',
  PAUSED: 'Paused',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
  ERROR: 'Error',
};
export const BUDGET_TYPES = ['DAILY', 'LIFETIME'] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number];

export const META_CTAS = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'BOOK_NOW', 'CONTACT_US', 'GET_OFFER', 'ORDER_NOW', 'WHATSAPP_MESSAGE', 'MESSAGE_PAGE'] as const;
export type MetaCta = (typeof META_CTAS)[number];
export const CTA_LABELS: Record<MetaCta, string> = {
  LEARN_MORE: 'Learn more',
  SHOP_NOW: 'Shop now',
  SIGN_UP: 'Sign up',
  BOOK_NOW: 'Book now',
  CONTACT_US: 'Contact us',
  GET_OFFER: 'Get offer',
  ORDER_NOW: 'Order now',
  WHATSAPP_MESSAGE: 'Send WhatsApp message',
  MESSAGE_PAGE: 'Send message',
};
export const LEAD_QUESTIONS = ['FULL_NAME', 'PHONE', 'EMAIL', 'CITY', 'COMPANY_NAME', 'JOB_TITLE'] as const;
export const KEYWORD_MATCH_TYPES = ['BROAD', 'PHRASE', 'EXACT'] as const;

// ───────────── Money (exact: integer hundredths, never floats) ─────────────

/** Currencies Meta counts in whole units (offset 1); every other currency uses hundredths. */
export const META_ZERO_DECIMAL = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);

/** "1499.5" → 149950n (hundredths). Rejects more than two decimals. */
export function toCents(amount: string): bigint {
  const m = amount.trim().match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`Invalid amount: ${amount}`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}
export const fromCents = (cents: bigint): string => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
export const amountSchema = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount like 500 or 499.50');

/** Meta budget value (account currency minor units, or whole units for zero-decimal currencies). */
export function toMetaMinor(amount: string, currency: string): string {
  const cents = toCents(amount);
  return String(META_ZERO_DECIMAL.has(currency) ? cents / 100n : cents);
}
export function fromMetaMinor(minor: string | number, currency: string): string {
  const v = BigInt(minor);
  return fromCents(META_ZERO_DECIMAL.has(currency) ? v * 100n : v);
}
/** Google Ads micros (1,000,000 per unit). */
export const toMicros = (amount: string): string => String(toCents(amount) * 10_000n);
export const fromMicros = (micros: string | number): string => fromCents(BigInt(micros) / 10_000n);

export function formatMoney(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: toCents(amount) % 100n === 0n ? 0 : 2 }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

const DAY = 86_400_000;

/**
 * Most a campaign can spend from `now`: lifetime budget, or daily budget × remaining days (until the end date,
 * or until the end of the current month when it runs indefinitely). Used both in the UI and, recomputed, on the server.
 */
export function maxSpend(c: { budgetType: BudgetType; budgetAmount: string; startAt?: string | null; endAt?: string | null }, now = new Date()): { amount: string; days: number; untilMonthEnd: boolean } {
  if (c.budgetType === 'LIFETIME') return { amount: fromCents(toCents(c.budgetAmount)), days: 0, untilMonthEnd: false };
  const start = Math.max(now.getTime(), c.startAt ? new Date(c.startAt).getTime() : 0);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const end = c.endAt ? new Date(c.endAt).getTime() : Math.max(monthEnd, start + DAY);
  const days = Math.max(1, Math.ceil((end - start) / DAY));
  return { amount: fromCents(toCents(c.budgetAmount) * BigInt(days)), days, untilMonthEnd: !c.endAt };
}

/** Portion of `maxSpend` that falls in the current UTC month (for the monthly cap). */
export function maxSpendThisMonth(c: { budgetType: BudgetType; budgetAmount: string; startAt?: string | null; endAt?: string | null }, now = new Date()): string {
  if (c.budgetType === 'LIFETIME') return fromCents(toCents(c.budgetAmount));
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const start = Math.max(now.getTime(), c.startAt ? new Date(c.startAt).getTime() : 0);
  const end = Math.min(monthEnd, c.endAt ? new Date(c.endAt).getTime() : monthEnd);
  if (end <= start) return '0.00';
  return fromCents(toCents(c.budgetAmount) * BigInt(Math.max(1, Math.ceil((end - start) / DAY))));
}

// ───────────── Targeting & creative ─────────────

const url = z.url({ protocol: /^https$/, error: 'Use a full https:// link' }).max(1000);

export const metaTargetingSchema = z
  .object({
    locations: z
      .array(z.object({ key: z.string().min(1).max(40), name: z.string().max(200), type: z.enum(['country', 'region', 'city', 'zip']), countryCode: z.string().length(2).optional(), radiusKm: z.number().int().min(1).max(80).optional() }).strict())
      .min(1, 'Add at least one location')
      .max(50),
    ageMin: z.number().int().min(18).max(65).default(18),
    ageMax: z.number().int().min(18).max(65).default(65),
    genders: z.array(z.union([z.literal(1), z.literal(2)])).max(2).default([]),
    interests: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().max(200) }).strict()).max(25).default([]),
    locales: z.array(z.object({ key: z.number().int(), name: z.string().max(100) }).strict()).max(10).default([]),
  })
  .strict()
  .refine((t) => t.ageMin <= t.ageMax, { message: 'Minimum age must not exceed maximum age', path: ['ageMax'] });
export type MetaTargeting = z.infer<typeof metaTargetingSchema>;

export const googleTargetingSchema = z
  .object({
    locations: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().max(200) }).strict()).min(1, 'Add at least one location').max(50),
    languages: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().max(60) }).strict()).max(10).default([]),
    keywords: z.array(z.object({ text: z.string().trim().min(1).max(80), matchType: z.enum(KEYWORD_MATCH_TYPES) }).strict()).min(1, 'Add at least one keyword').max(200),
  })
  .strict();
export type GoogleTargeting = z.infer<typeof googleTargetingSchema>;

export const META_TEXT_LIMITS = { primaryText: { max: 2_200, recommended: 125 }, headline: { max: 40, recommended: 27 }, description: { max: 30, recommended: 27 } } as const;
export const GOOGLE_RSA_LIMITS = { headlines: { min: 3, max: 15, length: 30 }, descriptions: { min: 2, max: 4, length: 90 }, path: 15 } as const;

export const leadFormSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    intro: z.string().trim().max(300).optional(),
    questions: z.array(z.enum(LEAD_QUESTIONS)).min(1).max(6),
    privacyPolicyUrl: url,
    thankYouUrl: url.optional(),
  })
  .strict();

export const metaCreativeSchema = z
  .object({
    pageId: z.string().regex(/^\d+$/, 'Choose a Facebook Page'),
    primaryText: z.string().trim().min(1, 'Write the ad text').max(META_TEXT_LIMITS.primaryText.max),
    headline: z.string().trim().max(255).default(''),
    description: z.string().trim().max(255).default(''),
    cta: z.enum(META_CTAS).default('LEARN_MORE'),
    link: url.optional(),
    imageFileId: z.uuid(),
    imageWidth: z.number().int().positive(),
    imageHeight: z.number().int().positive(),
    sourceDesignId: z.uuid().optional(),
    copyAssetId: z.uuid().optional(),
    messaging: z.object({ channel: z.enum(['WHATSAPP', 'MESSENGER']), whatsappNumber: z.string().regex(/^\+?\d{8,15}$/).optional(), greeting: z.string().max(300).optional() }).strict().optional(),
    leadForm: leadFormSchema.optional(),
  })
  .strict();
export type MetaCreative = z.infer<typeof metaCreativeSchema>;

export const googleRsaSchema = z
  .object({
    headlines: z.array(z.string().trim().min(1).max(60)).max(GOOGLE_RSA_LIMITS.headlines.max),
    descriptions: z.array(z.string().trim().min(1).max(180)).max(GOOGLE_RSA_LIMITS.descriptions.max),
    finalUrl: url,
    path1: z.string().trim().max(GOOGLE_RSA_LIMITS.path).optional(),
    path2: z.string().trim().max(GOOGLE_RSA_LIMITS.path).optional(),
  })
  .strict();
export type GoogleRsa = z.infer<typeof googleRsaSchema>;

const adSchema = z.object({ name: z.string().trim().min(1).max(120), creative: z.union([metaCreativeSchema, googleRsaSchema]) }).strict();
const adGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    targeting: z.union([metaTargetingSchema, googleTargetingSchema]),
    ads: z.array(adSchema).min(1).max(5),
  })
  .strict();

export const campaignDraftSchema = z
  .object({
    workspaceId: z.uuid(),
    adAccountId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    objective: z.enum(AD_OBJECTIVES),
    budgetType: z.enum(BUDGET_TYPES).default('DAILY'),
    budgetAmount: amountSchema,
    startAt: z.iso.datetime({ offset: true }).nullable().optional(),
    endAt: z.iso.datetime({ offset: true }).nullable().optional(),
    adGroups: z.array(adGroupSchema).min(1).max(5),
  })
  .strict();
export type CampaignDraftInput = z.infer<typeof campaignDraftSchema>;
export type CampaignDraftRequest = z.input<typeof campaignDraftSchema>;
export const updateCampaignSchema = withoutDefaults(campaignDraftSchema.omit({ workspaceId: true, adAccountId: true }).partial()).strict();
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

/** Spend decisions: the client echoes the maximum spend it showed; the server recomputes and compares. */
export const activateCampaignSchema = z.object({ confirm: z.literal(true, 'Confirm that this campaign may spend money'), maxSpend: amountSchema }).strict();
export const budgetChangeSchema = z.object({ budgetAmount: amountSchema, confirm: z.literal(true).optional(), maxSpend: amountSchema.optional() }).strict();
export const spendCapSchema = z.object({ monthlySpendCap: amountSchema.nullable() }).strict();
export const updateAdAccountSchema = z.object({ workspaceIds: z.array(z.uuid()).max(50).optional(), monthlySpendCap: amountSchema.nullable().optional() }).strict();
export const insightsQuerySchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, { message: '`from` must not be after `to`', path: ['to'] });
export const listCampaignsSchema = z.object({
  platform: z.enum(AD_PLATFORMS).optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  adAccountId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsSchema>;

// ───────────── AI campaign draft ─────────────

export const aiCampaignRequestSchema = z
  .object({
    adAccountId: z.uuid(),
    brief: z.string().trim().min(10, 'Describe what you are promoting').max(2_000),
    objective: z.enum(AD_OBJECTIVES).optional(),
    location: z.string().trim().max(120).optional(),
    language: z.enum(['en', 'ml', 'ar', 'hi', 'ta', 'kn', 'te']).default('en'),
    budgetMax: amountSchema.optional(),
    link: url.optional(),
    brandKitId: z.uuid().optional(),
  })
  .strict();
export type AiCampaignRequest = z.infer<typeof aiCampaignRequestSchema>;

/** What the model returns (ids are never trusted: locations and interests are resolved via the platform search APIs). */
export const aiCampaignOutputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  objective: z.enum(AD_OBJECTIVES),
  dailyBudget: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  locationQueries: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
  interestQueries: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  ageMin: z.number().int().min(18).max(65).default(18),
  ageMax: z.number().int().min(18).max(65).default(65),
  variants: z
    .array(z.object({ primaryText: z.string().trim().min(1).max(2_200), headline: z.string().trim().max(60), description: z.string().trim().max(60).default('') }))
    .min(1)
    .max(3),
  keywords: z.array(z.object({ text: z.string().trim().min(1).max(80), matchType: z.enum(KEYWORD_MATCH_TYPES) })).max(30).default([]),
  rsa: z.object({ headlines: z.array(z.string().trim().min(1).max(60)).max(15), descriptions: z.array(z.string().trim().min(1).max(180)).max(4) }).optional(),
  cta: z.enum(META_CTAS).default('LEARN_MORE'),
  rationale: z.string().trim().max(600).default(''),
});
export type AiCampaignOutput = z.infer<typeof aiCampaignOutputSchema>;

// ───────────── Validation ─────────────

export interface AdIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

const isMeta = (c: unknown): c is MetaCreative => !!c && typeof c === 'object' && 'primaryText' in c;

/** Platform rules beyond the schema (objective needs, creative limits, budget minimums). */
export function validateCampaign(c: Pick<CampaignDraftInput, 'objective' | 'budgetType' | 'budgetAmount' | 'startAt' | 'endAt' | 'adGroups'>, platform: AdPlatform, now = new Date()): AdIssue[] {
  const issues: AdIssue[] = [];
  const err = (code: string, message: string, path?: string) => issues.push({ level: 'error', code, message, path });
  const warn = (code: string, message: string, path?: string) => issues.push({ level: 'warning', code, message, path });

  if (!OBJECTIVES_BY_PLATFORM[platform].includes(c.objective)) err('OBJECTIVE_UNSUPPORTED', `${OBJECTIVE_INFO[c.objective].label} is not available on ${AD_PLATFORM_LABELS[platform]}.`, 'objective');
  const cents = (() => {
    try {
      return toCents(c.budgetAmount);
    } catch {
      return 0n;
    }
  })();
  if (cents < 100n) err('BUDGET_TOO_LOW', 'The budget must be at least 1.00 in the account currency.', 'budgetAmount');
  if (platform === 'GOOGLE' && c.budgetType === 'LIFETIME') err('BUDGET_TYPE_UNSUPPORTED', 'Google Search campaigns use a daily budget.', 'budgetType');
  if (platform === 'GOOGLE' && (c.startAt || c.endAt)) err('SCHEDULE_UNSUPPORTED', 'Google campaigns start when activated and run until paused.', 'endAt');
  if (c.budgetType === 'LIFETIME' && !c.endAt) err('END_REQUIRED', 'A lifetime budget needs an end date.', 'endAt');
  if (c.startAt && c.endAt && new Date(c.endAt) <= new Date(c.startAt)) err('END_BEFORE_START', 'The end date must be after the start date.', 'endAt');
  if (c.endAt && new Date(c.endAt).getTime() <= now.getTime()) err('END_IN_PAST', 'The end date has already passed.', 'endAt');
  if (c.budgetType === 'LIFETIME' && c.startAt && c.endAt) {
    const days = Math.ceil((new Date(c.endAt).getTime() - new Date(c.startAt).getTime()) / DAY);
    if (days > 0 && cents / BigInt(days) < 100n) err('BUDGET_TOO_LOW', 'A lifetime budget must allow at least 1.00 per day.', 'budgetAmount');
  }

  c.adGroups.forEach((g, gi) => {
    g.ads.forEach((ad, ai) => {
      const at = `adGroups.${gi}.ads.${ai}`;
      if (platform === 'META') {
        if (!isMeta(ad.creative)) return err('CREATIVE_INVALID', 'Meta ads need ad text and an image.', at);
        const cr = ad.creative;
        if (countGraphemes(cr.headline) > META_TEXT_LIMITS.headline.max) err('HEADLINE_TOO_LONG', `Headlines can have ${META_TEXT_LIMITS.headline.max} characters.`, `${at}.headline`);
        if (countGraphemes(cr.description) > META_TEXT_LIMITS.description.max) err('DESCRIPTION_TOO_LONG', `Descriptions can have ${META_TEXT_LIMITS.description.max} characters.`, `${at}.description`);
        if (countGraphemes(cr.primaryText) > META_TEXT_LIMITS.primaryText.recommended) warn('TEXT_TRUNCATED', `Text after ${META_TEXT_LIMITS.primaryText.recommended} characters is hidden behind "See more".`, `${at}.primaryText`);
        const ratio = cr.imageWidth / cr.imageHeight;
        if (ratio < 0.5 || ratio > 1.91) err('IMAGE_RATIO', 'Use a square (1:1), portrait (4:5) or landscape (1.91:1) image.', `${at}.image`);
        if (Math.min(cr.imageWidth, cr.imageHeight) < 600) warn('IMAGE_SMALL', 'Images of at least 1080 px look sharper.', `${at}.image`);
        if (c.objective === 'TRAFFIC' && !cr.link) err('LINK_REQUIRED', 'Traffic ads need a website link.', `${at}.link`);
        if (c.objective === 'MESSAGES') {
          if (!cr.messaging) err('MESSAGING_REQUIRED', 'Choose WhatsApp or Messenger for message ads.', `${at}.messaging`);
          else if (cr.messaging.channel === 'WHATSAPP' && !cr.messaging.whatsappNumber) err('WHATSAPP_NUMBER_REQUIRED', 'Add the WhatsApp Business number connected to your Page.', `${at}.messaging`);
        }
        if (c.objective === 'LEADS' && !cr.leadForm) err('LEAD_FORM_REQUIRED', 'Lead ads need an instant form with a privacy policy link.', `${at}.leadForm`);
      } else {
        if (isMeta(ad.creative)) return err('CREATIVE_INVALID', 'Google Search ads need headlines and descriptions.', at);
        const r = ad.creative;
        const L = GOOGLE_RSA_LIMITS;
        if (r.headlines.length < L.headlines.min) err('HEADLINES_TOO_FEW', `Add at least ${L.headlines.min} headlines.`, `${at}.headlines`);
        if (r.descriptions.length < L.descriptions.min) err('DESCRIPTIONS_TOO_FEW', `Add at least ${L.descriptions.min} descriptions.`, `${at}.descriptions`);
        r.headlines.forEach((h, i) => countGraphemes(h) > L.headlines.length && err('HEADLINE_TOO_LONG', `Headline ${i + 1} is longer than ${L.headlines.length} characters.`, `${at}.headlines.${i}`));
        r.descriptions.forEach((d, i) => countGraphemes(d) > L.descriptions.length && err('DESCRIPTION_TOO_LONG', `Description ${i + 1} is longer than ${L.descriptions.length} characters.`, `${at}.descriptions.${i}`));
        if (new Set(r.headlines.map((h) => h.toLowerCase())).size !== r.headlines.length) err('HEADLINES_DUPLICATE', 'Headlines must be different from each other.', `${at}.headlines`);
        if (r.headlines.length < 8) warn('HEADLINES_FEW', 'Google recommends 8 or more headlines for better results.', `${at}.headlines`);
      }
    });
  });
  return issues;
}

// ───────────── DTOs ─────────────

export interface AdAccountDto {
  id: string;
  platform: AdPlatform;
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  status: 'ACTIVE' | 'DISABLED' | 'NEEDS_REAUTH' | 'ERROR';
  monthlySpendCap: string | null;
  spentThisMonth: string;
  committedThisMonth: string;
  workspaceIds: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  connection: { id: string; provider: string; status: string; displayName: string | null };
}

export interface AvailableAdAccount {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  manager: boolean;
  alreadyAdded: boolean;
}

export interface AdDto {
  id: string;
  name: string;
  status: string;
  externalId: string | null;
  creative: MetaCreative | GoogleRsa;
  imageUrl: string | null;
}

export interface AdGroupDto {
  id: string;
  name: string;
  status: string;
  externalId: string | null;
  targeting: MetaTargeting | GoogleTargeting;
  ads: AdDto[];
}

export interface AdCampaignDto {
  id: string;
  workspaceId: string;
  platform: AdPlatform;
  adAccount: { id: string; name: string; currency: string; timezone: string; monthlySpendCap: string | null };
  name: string;
  objective: AdObjective;
  status: CampaignStatus;
  source: 'CREATED' | 'IMPORTED';
  budgetType: BudgetType;
  budgetAmount: string;
  currency: string;
  startAt: string | null;
  endAt: string | null;
  externalId: string | null;
  maxSpend: { amount: string; days: number; untilMonthEnd: boolean };
  spend: string;
  error: string | null;
  createdBy: { id: string; name: string } | null;
  activatedBy: { id: string; name: string } | null;
  activatedAt: string | null;
  lastSyncedAt: string | null;
  adGroups: AdGroupDto[];
  approvals: Array<{ id: string; action: string; maxSpend: string; currency: string; by: string; at: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AdInsightPoint {
  date: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: string;
  conversions: number;
  leads: number;
}

export interface AdInsights {
  currency: string;
  totals: { impressions: number; reach: number; clicks: number; spend: string; leads: number; conversions: number; ctr: number; cpc: string | null; cpm: string | null };
  daily: AdInsightPoint[];
}

export interface TargetingOption {
  id: string;
  name: string;
  type: string;
  description?: string;
  countryCode?: string;
}
