import type { ActivityType, BoardColumn, DealDto, LeadSource, LeadStatus, Lifecycle } from '@zatma/validation';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  UNQUALIFIED: 'Unqualified',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};

export const LEAD_STATUS_TONES: Record<LeadStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  NEW: 'primary',
  CONTACTED: 'warning',
  QUALIFIED: 'success',
  UNQUALIFIED: 'neutral',
  CONVERTED: 'success',
  LOST: 'danger',
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website: 'Website',
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  referral: 'Referral',
  walk_in: 'Walk-in',
  phone: 'Phone',
  email: 'Email',
  event: 'Event',
  import: 'Import',
  other: 'Other',
};

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = { LEAD: 'Lead', PROSPECT: 'Prospect', CUSTOMER: 'Customer', CHURNED: 'Churned' };

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  WHATSAPP: 'WhatsApp',
  NOTE: 'Note',
  TASK: 'Task',
  FOLLOW_UP: 'Follow-up',
};

/** Currency amount in the organization's currency (Indian digit grouping for INR). */
export function formatMoney(value: number, currency = 'INR', opts: { compact?: boolean } = {}): string {
  const locale = currency === 'INR' ? 'en-IN' : 'en';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: opts.compact ? 1 : value % 1 === 0 ? 0 : 2,
      ...(opts.compact ? { notation: 'compact' } : {}),
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale)}`;
  }
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** "in 2 days" / "3 hours ago" style relative time. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(0, 'minute');
}

/** Drops empty values so filters become a clean query string. */
export function toQuery(filters: Record<string, string | number | boolean | undefined | null>): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    out[k] = typeof v === 'boolean' ? 'true' : v;
  }
  return out;
}

export function queryString(filters: Record<string, string | number | boolean | undefined | null>): string {
  const q = toQuery(filters);
  const s = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
}

/**
 * Optimistically moves a deal on the board: removes it from its column and inserts it before
 * `beforeId` (or at the end) of the target stage, updating counts and totals.
 */
export function moveOnBoard(columns: BoardColumn[], dealId: string, toStageId: string, beforeId: string | null): BoardColumn[] {
  let moved: DealDto | undefined;
  const without = columns.map((c) => {
    const idx = c.deals.findIndex((d) => d.id === dealId);
    if (idx === -1) return c;
    moved = c.deals[idx];
    const deals = c.deals.filter((d) => d.id !== dealId);
    return { ...c, deals, count: deals.length, total: round2(deals.reduce((s, d) => s + d.value, 0)) };
  });
  if (!moved) return columns;
  return without.map((c) => {
    if (c.stage.id !== toStageId) return c;
    const deals = [...c.deals];
    const at = beforeId ? deals.findIndex((d) => d.id === beforeId) : -1;
    deals.splice(at === -1 ? deals.length : at, 0, { ...moved!, stageId: toStageId, stageName: c.stage.name });
    return { ...c, deals, count: deals.length, total: round2(deals.reduce((s, d) => s + d.value, 0)) };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Initials for avatars. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';
