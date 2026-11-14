'use client';

import { Badge } from '@zatma/ui';
import { CAMPAIGN_CHANNEL_INFO, formatMoney, MARKETING_STATUS_LABELS, type CampaignChannel, type MarketingCampaignStatus, type MoneyByCurrency } from '@zatma/validation';
import { addDays, fromLocalInput, keyOf } from '@/lib/publishing';

const TONE: Record<MarketingCampaignStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'primary',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

export function MarketingStatusBadge({ status }: { status: MarketingCampaignStatus }) {
  return <Badge tone={TONE[status]}>{MARKETING_STATUS_LABELS[status]}</Badge>;
}

export function ChannelChip({ channel }: { channel: CampaignChannel }) {
  const info = CAMPAIGN_CHANNEL_INFO[channel];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
      {info.label}
      {!info.available && <span className="text-muted-foreground">· planned</span>}
    </span>
  );
}

/** Money per currency, never summed across currencies. */
export const moneyList = (list: MoneyByCurrency[], empty = '–') => (list.length ? list.map((m) => formatMoney(m.amount, m.currency)).join(' + ') : empty);

export const errorText = (e: unknown) => (e as Error)?.message ?? 'Something went wrong';

/** A campaign runs from the start of its first day to the end of its last day, in the campaign's time zone. */
export const startFromDate = (date: string, tz: string) => fromLocalInput(`${date}T00:00`, tz);
export const endFromDate = (date: string, tz: string) => fromLocalInput(`${addDays(date, 1)}T00:00`, tz);
export const dateOfStart = (iso: string | null, tz: string) => (iso ? keyOf(iso, tz) : '');
export const dateOfEnd = (iso: string | null, tz: string) => (iso ? keyOf(new Date(new Date(iso).getTime() - 1).toISOString(), tz) : '');

export function formatRange(startAt: string | null, endAt: string | null, tz: string): string {
  if (!startAt || !endAt) return 'Dates not set';
  const fmt = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${fmt(dateOfStart(startAt, tz))} – ${fmt(dateOfEnd(endAt, tz))}`;
}
