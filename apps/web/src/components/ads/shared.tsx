'use client';

import { Badge } from '@zatma/ui';
import { CAMPAIGN_STATUS_LABELS, formatMoney, type CampaignStatus } from '@zatma/validation';

const TONE: Record<CampaignStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  PUBLISHING: 'primary',
  PAUSED: 'warning',
  ACTIVE: 'success',
  COMPLETED: 'neutral',
  ARCHIVED: 'neutral',
  ERROR: 'danger',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge tone={TONE[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}

export const money = (amount: string | null | undefined, currency: string) => (amount == null ? '–' : formatMoney(amount, currency));

/** Platform monogram (decorative; the name is always shown next to it). */
export function AdPlatformMark({ platform, className = 'size-8' }: { platform: 'META' | 'GOOGLE'; className?: string }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-lg text-xs font-bold text-white ${platform === 'META' ? 'bg-[#0866FF]' : 'bg-[#1A73E8]'} ${className}`}>
      {platform === 'META' ? '∞' : 'G'}
    </span>
  );
}

export const errorText = (e: unknown) => (e as Error)?.message ?? 'Something went wrong';
