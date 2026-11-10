import { z } from 'zod';

/**
 * Explainable lead scoring. The score is a deterministic sum of weighted signals; every signal
 * explains itself. AI never sets the score (it only writes insights on request).
 */

export const SCORING_SIGNALS = [
  'contactChannels',
  'company',
  'decisionMaker',
  'targetIndustry',
  'targetCity',
  'source',
  'recency',
  'engagement',
  'followUp',
  'status',
  'stale',
  'overdue',
] as const;
export type ScoringSignal = (typeof SCORING_SIGNALS)[number];

export const SIGNAL_INFO: Record<ScoringSignal, { label: string; group: 'Fit' | 'Engagement' | 'Risk'; description: string }> = {
  contactChannels: { label: 'Reachability', group: 'Fit', description: 'Has phone, WhatsApp and email' },
  company: { label: 'Business lead', group: 'Fit', description: 'A company name is known' },
  decisionMaker: { label: 'Decision maker', group: 'Fit', description: 'Job title matches your decision-maker keywords' },
  targetIndustry: { label: 'Target industry', group: 'Fit', description: 'Industry is one you focus on' },
  targetCity: { label: 'Target location', group: 'Fit', description: 'City is one you serve' },
  source: { label: 'Source quality', group: 'Fit', description: 'Referrals and walk-ins convert best' },
  recency: { label: 'Recent contact', group: 'Engagement', description: 'Contacted in the last few days' },
  engagement: { label: 'Activity', group: 'Engagement', description: 'Calls, WhatsApp, emails or meetings in the last 14 days' },
  followUp: { label: 'Follow-up planned', group: 'Engagement', description: 'An upcoming follow-up is scheduled' },
  status: { label: 'Qualification', group: 'Engagement', description: 'Lead status progress' },
  stale: { label: 'Going cold', group: 'Risk', description: 'No contact for more than 30 days' },
  overdue: { label: 'Overdue follow-up', group: 'Risk', description: 'A follow-up is past its due date' },
};

export const SCORE_GRADES = ['HOT', 'WARM', 'COLD'] as const;
export type ScoreGrade = (typeof SCORE_GRADES)[number];

export const DEFAULT_DECISION_MAKER_KEYWORDS = ['owner', 'founder', 'co-founder', 'director', 'ceo', 'md', 'managing director', 'proprietor', 'partner', 'gm', 'general manager', 'head', 'manager', 'president'];

const term = z.string().trim().min(1).max(60);
const weight = z.number().min(0).max(3);

export const scoringSettingsSchema = z
  .object({
    /** Multiplier per signal: 0 = off, 1 = default, up to 3×. */
    weights: z.partialRecord(z.enum(SCORING_SIGNALS), weight).default({}),
    targetIndustries: z.array(term).max(30).default([]),
    targetCities: z.array(term).max(50).default([]),
    decisionMakerKeywords: z.array(term).max(40).default(DEFAULT_DECISION_MAKER_KEYWORDS),
    hotThreshold: z.number().int().min(2).max(100).default(70),
    warmThreshold: z.number().int().min(1).max(99).default(40),
  })
  .strict()
  .refine((s) => s.warmThreshold < s.hotThreshold, { message: 'Warm threshold must be below the hot threshold', path: ['warmThreshold'] });
export type ScoringSettings = z.infer<typeof scoringSettingsSchema>;
export const updateScoringSettingsSchema = scoringSettingsSchema;
export type ScoringSettingsInput = z.input<typeof scoringSettingsSchema>;

export const DEFAULT_SCORING_SETTINGS: ScoringSettings = scoringSettingsSchema.parse({});

/** Settings stored on the organization (or defaults when missing/invalid). */
export function resolveScoringSettings(raw: unknown): ScoringSettings {
  const r = scoringSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_SCORING_SETTINGS;
}

const SOURCE_POINTS: Record<string, number> = {
  referral: 12,
  walk_in: 10,
  website: 9,
  whatsapp: 9,
  phone: 8,
  event: 8,
  email: 6,
  instagram: 6,
  facebook: 6,
  google_ads: 6,
  meta_ads: 6,
  other: 4,
  import: 3,
};

const CONTACT_TYPES = new Set(['CALL', 'EMAIL', 'MEETING', 'WHATSAPP']);

export interface ScoreActivity {
  type: string;
  createdAt: Date | string;
  dueAt: Date | string | null;
  completedAt: Date | string | null;
}

export interface ScoreInput {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  company: string | null;
  jobTitle: string | null;
  industry: string | null;
  city: string | null;
  source: string;
  status: string;
  lastContactedAt: Date | string | null;
  createdAt: Date | string;
  activities: ScoreActivity[];
}

export interface ScoreSignalResult {
  key: ScoringSignal;
  label: string;
  points: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  grade: ScoreGrade;
  signals: ScoreSignalResult[];
  /** Short text for lists and tooltips (top reasons). */
  reason: string;
}

const t = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);
const DAY = 86_400_000;
const norm = (s: string) => s.toLowerCase().trim();
const matchesAny = (value: string | null, terms: string[]) => {
  if (!value) return null;
  const v = norm(value);
  return terms.find((x) => {
    const k = norm(x);
    return k && (v === k || new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(v));
  }) ?? null;
};

export function gradeFor(score: number, s: Pick<ScoringSettings, 'hotThreshold' | 'warmThreshold'>): ScoreGrade {
  return score >= s.hotThreshold ? 'HOT' : score >= s.warmThreshold ? 'WARM' : 'COLD';
}

/** Computes the score at `now` (pure and deterministic). */
export function scoreLead(input: ScoreInput, settings: ScoringSettings = DEFAULT_SCORING_SETTINGS, now: Date = new Date()): ScoreResult {
  const nowMs = now.getTime();
  const raw: Array<{ key: ScoringSignal; points: number; detail: string }> = [];

  // ── Fit ──
  const channels = [input.phone && 'phone', input.whatsapp && 'WhatsApp', input.email && 'email'].filter(Boolean) as string[];
  const channelPoints = (input.phone ? 6 : 0) + (input.whatsapp ? 4 : 0) + (input.email ? 5 : 0);
  if (channelPoints) raw.push({ key: 'contactChannels', points: channelPoints, detail: `Reachable by ${channels.join(', ')}` });
  if (input.company?.trim()) raw.push({ key: 'company', points: 8, detail: `Works at ${input.company.trim()}` });
  const dm = matchesAny(input.jobTitle, settings.decisionMakerKeywords);
  if (dm) raw.push({ key: 'decisionMaker', points: 10, detail: `“${input.jobTitle}” is a decision-maker role` });
  const ind = matchesAny(input.industry, settings.targetIndustries);
  if (ind) raw.push({ key: 'targetIndustry', points: 10, detail: `${input.industry} is a target industry` });
  const city = matchesAny(input.city, settings.targetCities);
  if (city) raw.push({ key: 'targetCity', points: 6, detail: `${input.city} is a target location` });
  const src = SOURCE_POINTS[input.source] ?? 4;
  raw.push({ key: 'source', points: src, detail: `Source: ${input.source.replace(/_/g, ' ')}` });

  // ── Engagement ──
  const last = t(input.lastContactedAt);
  if (last !== null) {
    const days = Math.max(0, Math.floor((nowMs - last) / DAY));
    const pts = days <= 3 ? 15 : days <= 7 ? 12 : days <= 14 ? 8 : days <= 30 ? 4 : 0;
    if (pts) raw.push({ key: 'recency', points: pts, detail: days === 0 ? 'Contacted today' : `Last contacted ${days} day${days === 1 ? '' : 's'} ago` });
  }
  const recent = input.activities.filter((a) => CONTACT_TYPES.has(a.type) && a.completedAt && nowMs - t(a.completedAt)! <= 14 * DAY).length;
  if (recent) raw.push({ key: 'engagement', points: Math.min(recent, 4) * 3, detail: `${recent} interaction${recent === 1 ? '' : 's'} in the last 14 days` });
  const open = input.activities.filter((a) => a.dueAt && !a.completedAt);
  if (open.some((a) => t(a.dueAt)! >= nowMs)) raw.push({ key: 'followUp', points: 6, detail: 'A follow-up is scheduled' });
  if (input.status === 'QUALIFIED') raw.push({ key: 'status', points: 12, detail: 'Qualified' });
  else if (input.status === 'CONTACTED') raw.push({ key: 'status', points: 4, detail: 'Contacted' });

  // ── Risk ──
  const staleSince = last ?? (nowMs - t(input.createdAt)! > 14 * DAY ? t(input.createdAt) : null);
  if (staleSince !== null && nowMs - staleSince > 30 * DAY) {
    raw.push({ key: 'stale', points: -10, detail: last ? `No contact for ${Math.floor((nowMs - last) / DAY)} days` : 'Never contacted since it was added' });
  }
  const overdue = open.filter((a) => t(a.dueAt)! < nowMs).length;
  if (overdue) raw.push({ key: 'overdue', points: -8, detail: `${overdue} overdue follow-up${overdue === 1 ? '' : 's'}` });

  // Weights (0 = off).
  const signals: ScoreSignalResult[] = raw
    .map((r) => ({ key: r.key, label: SIGNAL_INFO[r.key].label, points: Math.round(r.points * (settings.weights[r.key] ?? 1)), detail: r.detail }))
    .filter((s) => s.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || a.key.localeCompare(b.key));

  let score = Math.max(0, Math.min(100, signals.reduce((sum, s) => sum + s.points, 0)));
  if (input.status === 'UNQUALIFIED' || input.status === 'LOST') {
    score = 0;
    signals.unshift({ key: 'status', label: SIGNAL_INFO.status.label, points: 0, detail: input.status === 'LOST' ? 'Marked lost: not scored' : 'Marked unqualified: not scored' });
  }
  const grade = gradeFor(score, settings);
  const reason = signals
    .filter((s) => s.points > 0)
    .slice(0, 3)
    .map((s) => s.detail)
    .join(' · ');
  return { score, grade, signals, reason };
}

// ───────────── AI insights ─────────────

export const NEXT_ACTIONS = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'NURTURE', 'DISQUALIFY'] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];
export const ACTION_WHEN = ['today', 'tomorrow', 'this_week', 'next_week'] as const;

export const leadInsightsOutputSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  nextBestAction: z.object({
    action: z.enum(NEXT_ACTIONS),
    reason: z.string().trim().min(1).max(300),
    when: z.enum(ACTION_WHEN).catch('this_week'),
  }),
  talkingPoints: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
  followUpMessage: z.object({
    channel: z.enum(['whatsapp', 'email']).catch('whatsapp'),
    subject: z.string().trim().max(150).optional(),
    text: z.string().trim().min(1).max(1500),
  }),
});
export type LeadInsightsOutput = z.infer<typeof leadInsightsOutputSchema>;

export interface LeadInsights extends LeadInsightsOutput {
  language: string;
  generatedAt: string;
  provider: string;
  model: string;
  credits: number;
}

export const leadInsightsRequestSchema = z.object({ language: z.enum(['en', 'ml', 'ar', 'hi', 'ta', 'kn', 'te']).optional() }).strict();

export const MESSAGE_GOALS = ['follow_up', 'reengage', 'thank_you', 'meeting_request', 'offer'] as const;
export const draftMessageSchema = z
  .object({
    channel: z.enum(['whatsapp', 'email', 'sms']).default('whatsapp'),
    goal: z.enum(MESSAGE_GOALS).default('follow_up'),
    language: z.enum(['en', 'ml', 'ar', 'hi', 'ta', 'kn', 'te']).optional(),
    context: z.string().trim().max(500).optional(),
  })
  .strict();
export type DraftMessageInput = z.infer<typeof draftMessageSchema>;
export const draftMessageOutputSchema = z.object({ subject: z.string().trim().max(150).optional(), text: z.string().trim().min(1).max(1500) });
export interface DraftMessageResult {
  channel: DraftMessageInput['channel'];
  language: string;
  subject: string | null;
  text: string;
  provider: string;
  model: string;
  credits: number;
}

/** Due date suggested for a next-best-action. */
export function dueFor(when: (typeof ACTION_WHEN)[number], now: Date = new Date()): Date {
  const d = new Date(now);
  const days = when === 'today' ? 0 : when === 'tomorrow' ? 1 : when === 'this_week' ? 2 : 7;
  d.setDate(d.getDate() + days);
  if (when === 'today') d.setHours(Math.max(d.getHours() + 2, 10), 0, 0, 0);
  else d.setHours(10, 0, 0, 0);
  return d;
}

export interface LeadScoreDto extends ScoreResult {
  scoredAt: string | null;
}
