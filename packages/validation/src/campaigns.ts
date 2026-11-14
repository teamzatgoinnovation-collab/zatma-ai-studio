import { z } from 'zod';
import { amountSchema, fromCents, toCents } from './ads.js';
import { LEAD_SOURCES, LEAD_STATUSES } from './crm.js';
import { withoutDefaults } from './patch.js';

// Phase 12: multi-channel marketing campaigns. A campaign groups organic posts, ad campaigns, assets, tracked links
// and leads. Its status is a *planning* status: it never starts, schedules or approves anything that spends money.

// ───────────── Enums ─────────────

export const MARKETING_CAMPAIGN_TYPES = ['SOCIAL', 'META_ADS', 'GOOGLE_ADS', 'EMAIL', 'WHATSAPP', 'PRODUCT_PROMOTION', 'FESTIVAL', 'LEAD_GENERATION', 'CUSTOMER_RETENTION'] as const;
export type MarketingCampaignType = (typeof MARKETING_CAMPAIGN_TYPES)[number];

export const CAMPAIGN_CHANNELS = ['social', 'meta_ads', 'google_ads', 'email', 'whatsapp', 'other'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_CHANNEL_INFO: Record<CampaignChannel, { label: string; utmSource: string; utmMedium: string; available: boolean; note?: string }> = {
  social: { label: 'Social posts', utmSource: 'social', utmMedium: 'social', available: true },
  meta_ads: { label: 'Meta Ads', utmSource: 'facebook', utmMedium: 'paid_social', available: true },
  google_ads: { label: 'Google Ads', utmSource: 'google', utmMedium: 'cpc', available: true },
  email: { label: 'Email', utmSource: 'newsletter', utmMedium: 'email', available: false, note: 'Sending available in Phase 14' },
  whatsapp: { label: 'WhatsApp', utmSource: 'whatsapp', utmMedium: 'messaging', available: false, note: 'Sending available in Phase 14' },
  other: { label: 'Other (offline, website, partners)', utmSource: 'other', utmMedium: 'referral', available: true },
};

export const CAMPAIGN_TYPE_INFO: Record<MarketingCampaignType, { label: string; description: string; channels: CampaignChannel[] }> = {
  SOCIAL: { label: 'Social media', description: 'Organic posts across your connected pages and profiles.', channels: ['social'] },
  META_ADS: { label: 'Meta Ads', description: 'Paid Facebook and Instagram ads.', channels: ['meta_ads'] },
  GOOGLE_ADS: { label: 'Google Ads', description: 'Paid Google Search ads.', channels: ['google_ads'] },
  EMAIL: { label: 'Email', description: 'Email to a CRM segment (sending in Phase 14).', channels: ['email'] },
  WHATSAPP: { label: 'WhatsApp', description: 'WhatsApp messages to a CRM segment (sending in Phase 14).', channels: ['whatsapp'] },
  PRODUCT_PROMOTION: { label: 'Product promotion', description: 'Promote a product or offer across channels.', channels: ['social', 'meta_ads'] },
  FESTIVAL: { label: 'Festival', description: 'Onam, Diwali, Eid, Christmas and other seasonal campaigns.', channels: ['social', 'meta_ads', 'whatsapp'] },
  LEAD_GENERATION: { label: 'Lead generation', description: 'Collect enquiries with ads, forms and tracked links.', channels: ['meta_ads', 'google_ads'] },
  CUSTOMER_RETENTION: { label: 'Customer retention', description: 'Bring existing customers back.', channels: ['email', 'whatsapp'] },
};

export const MARKETING_OBJECTIVES = ['AWARENESS', 'TRAFFIC', 'ENGAGEMENT', 'LEADS', 'SALES', 'RETENTION'] as const;
export type MarketingObjective = (typeof MARKETING_OBJECTIVES)[number];
export const MARKETING_OBJECTIVE_LABELS: Record<MarketingObjective, string> = { AWARENESS: 'Awareness', TRAFFIC: 'Traffic', ENGAGEMENT: 'Engagement', LEADS: 'Leads', SALES: 'Sales', RETENTION: 'Retention' };

export const MARKETING_CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export type MarketingCampaignStatus = (typeof MARKETING_CAMPAIGN_STATUSES)[number];
export const MARKETING_STATUS_LABELS: Record<MarketingCampaignStatus, string> = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', ACTIVE: 'Active', PAUSED: 'Paused', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const MANUAL_STATUSES = ['PAUSED', 'CANCELLED'] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

// ───────────── Status ─────────────

export interface StatusInput {
  manualStatus: ManualStatus | null;
  readyAt: string | Date | null;
  startAt: string | Date | null;
  endAt: string | Date | null;
  channels: readonly string[];
}

const ms = (d: string | Date | null) => (d === null ? null : new Date(d).getTime());

/**
 * Planning status. Cancelled/Paused are set by people; everything else follows the dates once the campaign is
 * marked ready. Draft until it is ready and has a start date, an end date after it and at least one channel.
 */
export function deriveStatus(c: StatusInput, now = new Date()): MarketingCampaignStatus {
  if (c.manualStatus) return c.manualStatus;
  const start = ms(c.startAt);
  const end = ms(c.endAt);
  if (!c.readyAt || start === null || end === null || end <= start || c.channels.length === 0) return 'DRAFT';
  const t = now.getTime();
  if (t < start) return 'SCHEDULED';
  if (t < end) return 'ACTIVE';
  return 'COMPLETED';
}

/** Why a campaign cannot leave Draft yet (empty when it can be marked ready). */
export function readinessIssues(c: Omit<StatusInput, 'manualStatus' | 'readyAt'>): string[] {
  const issues: string[] = [];
  const start = ms(c.startAt);
  const end = ms(c.endAt);
  if (start === null) issues.push('Set a start date');
  if (end === null) issues.push('Set an end date');
  if (start !== null && end !== null && end <= start) issues.push('The end date must be after the start date');
  if (!c.channels.length) issues.push('Choose at least one channel');
  return issues;
}

// ───────────── UTM & tracked links ─────────────

/** UTM-safe value: lowercase ASCII letters, digits, `-` and `_` (other scripts are dropped). */
export function slugifyUtm(value: string, fallback = 'campaign'): string {
  const s = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
  return s || fallback;
}

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content?: string | null;
  term?: string | null;
}

/** Adds UTM parameters to a destination, keeping its other query parameters and fragment (UTM keys are replaced). */
export function buildTrackedUrl(destination: string, utm: UtmParams): string {
  const u = new URL(destination);
  const set: [string, string | null | undefined][] = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
    ['utm_content', utm.content],
    ['utm_term', utm.term],
  ];
  for (const [k, v] of set) {
    if (v) u.searchParams.set(k, v);
    else u.searchParams.delete(k);
  }
  return u.toString();
}

/** Reads UTM parameters from a landing URL (e.g. a form's page URL). */
export function parseUtm(url: string): Partial<UtmParams> {
  try {
    const p = new URL(url).searchParams;
    const out: Partial<UtmParams> = {};
    for (const k of ['source', 'medium', 'campaign', 'content', 'term'] as const) {
      const v = p.get(`utm_${k}`);
      if (v) out[k] = v.slice(0, 100);
    }
    return out;
  } catch {
    return {};
  }
}

// ───────────── Budget ─────────────

/** Splits a total into per-channel amounts by percentage, exactly (the rounding remainder goes to the largest share). */
export function splitBudget(total: string, shares: { channel: CampaignChannel; percent: number }[]): { channel: CampaignChannel; amount: string }[] {
  // Integer weights (percent to 2 decimals) keep the arithmetic exact.
  const valid = shares.filter((s) => Math.round(s.percent * 100) > 0);
  const weights = valid.map((s) => BigInt(Math.round(s.percent * 100)));
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (!valid.length) return [];
  const cents = toCents(total);
  const parts = weights.map((w) => (cents * w) / sum);
  const rest = cents - parts.reduce((a, b) => a + b, 0n);
  const largest = valid.reduce((best, s, i) => (s.percent > valid[best]!.percent ? i : best), 0);
  parts[largest] = parts[largest]! + rest;
  return valid.map((s, i) => ({ channel: s.channel, amount: fromCents(parts[i]!) }));
}

// ───────────── Schemas ─────────────

const uuid = z.uuid();
const isoDate = z.iso.datetime({ offset: true });
const timezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid IANA timezone' },
);
const utmValue = z.string().trim().min(1).max(60).regex(/^[a-z0-9_-]+$/, 'Use lowercase letters, numbers, - and _');
const words = (max: number) => z.array(z.string().trim().min(1).max(60)).max(max);

export const audienceSegmentSchema = z
  .object({
    /** leads, or converted customers (contacts with a won deal) */
    kind: z.enum(['leads', 'customers']).default('leads'),
    statuses: z.array(z.enum(LEAD_STATUSES)).max(10).default([]),
    sources: z.array(z.enum(LEAD_SOURCES)).max(20).default([]),
    tags: words(20).default([]),
    cities: words(20).default([]),
    countries: words(20).default([]),
    minScore: z.number().int().min(0).max(100).nullable().default(null),
  })
  .strict();
export type AudienceSegment = z.infer<typeof audienceSegmentSchema>;

export const campaignAudienceSchema = z
  .object({
    description: z.string().trim().max(1000).default(''),
    /** Locations, ages and interests as planning notes (ad targeting itself lives on each ad campaign). */
    locations: words(20).default([]),
    ageMin: z.number().int().min(13).max(65).nullable().default(null),
    ageMax: z.number().int().min(13).max(65).nullable().default(null),
    interests: words(30).default([]),
    segment: audienceSegmentSchema.nullable().default(null),
  })
  .strict()
  .refine((a) => a.ageMin === null || a.ageMax === null || a.ageMin <= a.ageMax, { message: 'Minimum age must not exceed maximum age', path: ['ageMax'] });
export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;

export const contentPlanItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    date: z.iso.date().nullable().default(null),
    notes: z.string().trim().max(1000).default(''),
  })
  .strict();
export type ContentPlanItem = z.infer<typeof contentPlanItemSchema>;

export const channelPlanSchema = z
  .object({
    channel: z.enum(CAMPAIGN_CHANNELS),
    plannedBudget: amountSchema.nullable().default(null),
    notes: z.string().trim().max(2000).default(''),
    content: z.array(contentPlanItemSchema).max(50).default([]),
  })
  .strict();
export type ChannelPlanInput = z.infer<typeof channelPlanSchema>;

const campaignFields = {
  workspaceId: uuid,
  name: z.string().trim().min(2).max(120),
  type: z.enum(MARKETING_CAMPAIGN_TYPES),
  objective: z.enum(MARKETING_OBJECTIVES).default('AWARENESS'),
  description: z.string().trim().max(4000).default(''),
  ownerId: z.string().min(1).max(64).nullable().default(null),
  startAt: isoDate.nullable().default(null),
  endAt: isoDate.nullable().default(null),
  timezone: timezone.default('Asia/Kolkata'),
  budgetAmount: amountSchema.nullable().default(null),
  currency: z.string().length(3).toUpperCase().optional(),
  channels: z.array(z.enum(CAMPAIGN_CHANNELS)).max(CAMPAIGN_CHANNELS.length).optional(),
  channelPlans: z.array(channelPlanSchema).max(CAMPAIGN_CHANNELS.length).optional(),
  audience: campaignAudienceSchema.optional(),
  utmCampaign: utmValue.optional(),
};

const datesInOrder = (v: { startAt?: string | null; endAt?: string | null }) => !v.startAt || !v.endAt || new Date(v.endAt) > new Date(v.startAt);
const uniqueChannels = (v: { channelPlans?: { channel: string }[] }) => !v.channelPlans || new Set(v.channelPlans.map((p) => p.channel)).size === v.channelPlans.length;

export const createMarketingCampaignSchema = z
  .object(campaignFields)
  .strict()
  .refine(datesInOrder, { message: 'The end date must be after the start date', path: ['endAt'] })
  .refine(uniqueChannels, { message: 'Each channel can only be planned once', path: ['channelPlans'] });
export type CreateMarketingCampaignInput = z.infer<typeof createMarketingCampaignSchema>;
export type CreateMarketingCampaignRequest = z.input<typeof createMarketingCampaignSchema>;

export const updateMarketingCampaignSchema = withoutDefaults(z.object(campaignFields).omit({ workspaceId: true }).partial())
  .strict()
  .refine(datesInOrder, { message: 'The end date must be after the start date', path: ['endAt'] })
  .refine(uniqueChannels, { message: 'Each channel can only be planned once', path: ['channelPlans'] });
export type UpdateMarketingCampaignInput = z.infer<typeof updateMarketingCampaignSchema>;
export type UpdateMarketingCampaignRequest = Partial<Omit<CreateMarketingCampaignRequest, 'workspaceId'>>;

export const listMarketingCampaignsSchema = z.object({
  type: z.enum(MARKETING_CAMPAIGN_TYPES).optional(),
  status: z.enum(MARKETING_CAMPAIGN_STATUSES).optional(),
  channel: z.enum(CAMPAIGN_CHANNELS).optional(),
  ownerId: z.string().max(64).optional(),
  workspaceId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  /** Campaigns overlapping [from, to) */
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListMarketingCampaignsQuery = z.infer<typeof listMarketingCampaignsSchema>;

export const campaignReadySchema = z.object({ ready: z.boolean() }).strict();

export const campaignStopSchema = z
  .object({
    /** Pause the linked ad campaigns that are running (stops spend). */
    pauseAds: z.boolean().default(false),
    /** Return the linked scheduled posts to drafts. */
    unschedulePosts: z.boolean().default(false),
  })
  .strict();
export type CampaignStopInput = z.infer<typeof campaignStopSchema>;

export const CAMPAIGN_LINK_KINDS = ['post', 'ad_campaign', 'design', 'copy', 'lead', 'deal'] as const;
export type CampaignLinkKind = (typeof CAMPAIGN_LINK_KINDS)[number];
export const campaignAttachSchema = z
  .object({ kind: z.enum(CAMPAIGN_LINK_KINDS), ids: z.array(uuid).min(1).max(100), detach: z.boolean().default(false) })
  .strict();
export type CampaignAttachInput = z.infer<typeof campaignAttachSchema>;

export const campaignAssetSchema = z
  .object({ fileId: uuid.optional(), designId: uuid.optional(), copyAssetId: uuid.optional(), label: z.string().trim().max(120).default('') })
  .strict()
  .refine((v) => [v.fileId, v.designId, v.copyAssetId].filter(Boolean).length === 1, { message: 'Choose exactly one file, design or copy' });
export type CampaignAssetInput = z.infer<typeof campaignAssetSchema>;

export const trackedLinkSchema = z
  .object({
    destinationUrl: z.url({ protocol: /^https?$/, error: 'Use a full http:// or https:// link' }).max(2000),
    label: z.string().trim().max(120).default(''),
    channel: z.enum(CAMPAIGN_CHANNELS).default('other'),
    utmSource: utmValue.optional(),
    utmMedium: utmValue.optional(),
    utmContent: utmValue.nullable().optional(),
    utmTerm: utmValue.nullable().optional(),
  })
  .strict();
export type TrackedLinkInput = z.infer<typeof trackedLinkSchema>;
export const updateTrackedLinkSchema = withoutDefaults(trackedLinkSchema.partial()).strict();
export type UpdateTrackedLinkInput = z.infer<typeof updateTrackedLinkSchema>;

export const campaignTaskSchema = z
  .object({ title: z.string().trim().min(1).max(200), dueAt: isoDate.nullable().default(null), assigneeId: z.string().min(1).max(64).nullable().default(null), done: z.boolean().default(false) })
  .strict();
export type CampaignTaskInput = z.infer<typeof campaignTaskSchema>;
export const updateCampaignTaskSchema = withoutDefaults(campaignTaskSchema.partial()).strict();
export type UpdateCampaignTaskInput = z.infer<typeof updateCampaignTaskSchema>;

export const campaignRangeSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, { message: '`from` must not be after `to`', path: ['to'] })
  .refine((v) => (new Date(v.to).getTime() - new Date(v.from).getTime()) / 86_400_000 <= 400, { message: 'Choose a range of at most 400 days', path: ['to'] });
export type CampaignRange = z.infer<typeof campaignRangeSchema>;

export const campaignCalendarSchema = z
  .object({ from: isoDate, to: isoDate, workspaceId: uuid.optional(), campaignId: uuid.optional() })
  .refine((v) => new Date(v.to) > new Date(v.from), { message: '`to` must be after `from`', path: ['to'] })
  .refine((v) => (new Date(v.to).getTime() - new Date(v.from).getTime()) / 86_400_000 <= 62, { message: 'Choose a range of at most 62 days', path: ['to'] });
export type CampaignCalendarQuery = z.infer<typeof campaignCalendarSchema>;

// ───────────── AI planner (suggestion only) ─────────────

export const aiCampaignPlanRequestSchema = z
  .object({
    brief: z.string().trim().min(10).max(2000),
    type: z.enum(MARKETING_CAMPAIGN_TYPES).optional(),
    totalBudget: amountSchema.optional(),
    startAt: isoDate.optional(),
    endAt: isoDate.optional(),
    language: z.string().min(2).max(5).default('en'),
    brandKitId: uuid.optional(),
  })
  .strict()
  .refine(datesInOrder, { message: 'The end date must be after the start date', path: ['endAt'] });
export type AiCampaignPlanRequest = z.infer<typeof aiCampaignPlanRequestSchema>;

export const aiCampaignPlanOutputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(MARKETING_CAMPAIGN_TYPES),
  objective: z.enum(MARKETING_OBJECTIVES),
  description: z.string().max(4000).default(''),
  channels: z.array(z.enum(CAMPAIGN_CHANNELS)).min(1).max(CAMPAIGN_CHANNELS.length),
  budgetSplit: z.array(z.object({ channel: z.enum(CAMPAIGN_CHANNELS), percent: z.number().min(0).max(100) })).max(CAMPAIGN_CHANNELS.length).default([]),
  audience: z.object({ description: z.string().max(1000).default(''), locations: z.array(z.string().max(60)).max(20).default([]), interests: z.array(z.string().max(60)).max(30).default([]), ageMin: z.number().int().min(13).max(65).nullable().default(null), ageMax: z.number().int().min(13).max(65).nullable().default(null) }),
  /** Content ideas with a day offset from the start date */
  contentPlan: z.array(z.object({ channel: z.enum(CAMPAIGN_CHANNELS), title: z.string().max(200), day: z.number().int().min(0).max(365).default(0), notes: z.string().max(1000).default('') })).max(40).default([]),
  tasks: z.array(z.object({ title: z.string().max(200), day: z.number().int().min(-60).max(365).default(0) })).max(30).default([]),
  rationale: z.string().max(2000).default(''),
});
export type AiCampaignPlanOutput = z.infer<typeof aiCampaignPlanOutputSchema>;

// ───────────── DTOs ─────────────

export interface MoneyByCurrency {
  currency: string;
  amount: string;
}

export interface ChannelPlanDto {
  channel: CampaignChannel;
  plannedBudget: string | null;
  notes: string;
  content: ContentPlanItem[];
}

export interface MarketingCampaignDto {
  id: string;
  code: string;
  workspaceId: string;
  name: string;
  type: MarketingCampaignType;
  objective: MarketingObjective;
  description: string;
  status: MarketingCampaignStatus;
  manualStatus: ManualStatus | null;
  readyAt: string | null;
  owner: { id: string; name: string } | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  budgetAmount: string | null;
  currency: string;
  channels: CampaignChannel[];
  channelPlans: ChannelPlanDto[];
  audience: CampaignAudience;
  utmCampaign: string;
  counts: { posts: number; adCampaigns: number; assets: number; links: number; leads: number; tasks: number };
  /** Spend of linked ad campaigns, per currency (never summed across currencies). */
  spend: MoneyByCurrency[];
  readinessIssues: string[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedLinkDto {
  id: string;
  slug: string;
  shortUrl: string;
  destinationUrl: string;
  trackedUrl: string;
  label: string;
  channel: CampaignChannel;
  utmSource: string;
  utmMedium: string;
  utmContent: string | null;
  utmTerm: string | null;
  clicks: number;
  uniqueClicks: number;
  createdAt: string;
}

export interface CampaignAssetDto {
  id: string;
  label: string;
  kind: 'file' | 'design' | 'copy';
  refId: string;
  name: string;
  previewUrl: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface CampaignTaskDto {
  id: string;
  title: string;
  dueAt: string | null;
  done: boolean;
  assignee: { id: string; name: string } | null;
}

export interface CampaignContentDto {
  posts: { id: string; caption: string; status: string; scheduledAt: string | null; publishedAt: string | null; platforms: string[] }[];
  adCampaigns: { id: string; name: string; platform: string; status: string; currency: string; budgetType: string; budgetAmount: string; spend: string; startAt: string | null; endAt: string | null }[];
}

export interface CampaignAnalyticsDto {
  range: CampaignRange;
  totals: {
    linkClicks: number;
    uniqueClicks: number;
    leads: number;
    wonDeals: number;
    wonValue: MoneyByCurrency[];
    spend: MoneyByCurrency[];
    impressions: number;
    adClicks: number;
    platformLeads: number;
    platformConversions: number;
    postsPublished: number;
    /** Leads ÷ link clicks, as a percentage (null without clicks). Can exceed 100%: leads also come from forms and ads. */
    clickToLead: number | null;
    /** Won deals ÷ leads, as a percentage (null without leads) */
    leadToWon: number | null;
  };
  daily: { date: string; linkClicks: number; leads: number; won: number; adClicks: number; impressions: number; spend: MoneyByCurrency[] }[];
  leadsBySource: { source: string; count: number }[];
  channels: { channel: CampaignChannel; plannedBudget: string | null; spend: MoneyByCurrency[]; leads: number; linkClicks: number; items: number }[];
}

export type CampaignCalendarEntry =
  | { kind: 'campaign'; id: string; campaignId: string; title: string; start: string; end: string; status: MarketingCampaignStatus; type: MarketingCampaignType }
  | { kind: 'post'; id: string; campaignId: string | null; title: string; start: string; status: string }
  | { kind: 'ad'; id: string; campaignId: string | null; title: string; start: string; end: string | null; status: string; platform: string }
  | { kind: 'task'; id: string; campaignId: string; title: string; start: string; done: boolean }
  | { kind: 'content'; id: string; campaignId: string; title: string; start: string; channel: CampaignChannel };

export interface AudiencePreviewDto {
  total: number;
  sample: { id: string; name: string; email: string | null; phone: string | null; status: string | null; city: string | null; score: number | null }[];
  withEmail: number;
  withPhone: number;
}

export interface AiCampaignPlanDto {
  draft: Omit<CreateMarketingCampaignRequest, 'workspaceId'>;
  tasks: { title: string; dueAt: string | null }[];
  rationale: string;
}
