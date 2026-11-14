'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays, Flag, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { buttonVariants, Card, EmptyState, ErrorState, Input, Meter, Select, Skeleton } from '@zatma/ui';
import {
  CAMPAIGN_CHANNEL_INFO,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_TYPE_INFO,
  formatMoney,
  MARKETING_CAMPAIGN_STATUSES,
  MARKETING_CAMPAIGN_TYPES,
  MARKETING_STATUS_LABELS,
  type CampaignChannel,
  type MarketingCampaignStatus,
  type MarketingCampaignType,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { formatRange, MarketingStatusBadge, moneyList } from './shared';

export function MarketingCampaignsList() {
  const [type, setType] = useState<'' | MarketingCampaignType>('');
  const [status, setStatus] = useState<'' | MarketingCampaignStatus>('');
  const [channel, setChannel] = useState<'' | CampaignChannel>('');
  const [q, setQ] = useState('');
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: api.billing.usage });
  const list = useQuery({
    queryKey: ['campaigns', 'list', type, status, channel, q],
    queryFn: () => api.campaigns.list({ type: type || undefined, status: status || undefined, channel: channel || undefined, q: q.trim() || undefined, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const canWrite = org.data?.permissions.includes('campaign:write') ?? false;
  const tz = org.data?.timezone ?? 'Asia/Kolkata';
  const limit = usage.data?.metrics.find((m) => m.metric === 'campaigns');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search campaigns" placeholder="Search name or CMP-0001" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Type" className="w-44" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="">All types</option>
          {MARKETING_CAMPAIGN_TYPES.map((t) => (
            <option key={t} value={t}>
              {CAMPAIGN_TYPE_INFO[t].label}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">All statuses</option>
          {MARKETING_CAMPAIGN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {MARKETING_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Channel" className="w-44" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
          <option value="">All channels</option>
          {CAMPAIGN_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CAMPAIGN_CHANNEL_INFO[c].label}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex gap-2">
          <Link href="/marketing/campaigns/calendar" className={buttonVariants({ variant: 'outline' })}>
            <CalendarDays aria-hidden="true" /> Calendar
          </Link>
          {canWrite && (
            <Link href="/marketing/campaigns/new" className={buttonVariants()}>
              <Plus aria-hidden="true" /> New campaign
            </Link>
          )}
        </div>
      </div>
      {limit && limit.limit !== -1 && (
        <Card className="p-4">
          <Meter label="Active campaigns on your plan" used={limit.used} limit={limit.limit} />
        </Card>
      )}
      {list.isPending ? (
        <Skeleton className="h-64" />
      ) : list.isError ? (
        <ErrorState description="Couldn't load campaigns." onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          icon={<Flag />}
          title={type || status || channel || q ? 'No matching campaigns' : 'No campaigns yet'}
          description="Group posts, ads, tracked links and leads under one campaign with a budget, dates and an audience."
          action={
            canWrite && !(type || status || channel || q) ? (
              <Link href="/marketing/campaigns/new" className={buttonVariants()}>
                <Plus aria-hidden="true" /> New campaign
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">Campaigns</caption>
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Campaign</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Dates</th>
                <th className="p-3 font-medium">Budget</th>
                <th className="p-3 font-medium">Ad spend</th>
                <th className="p-3 font-medium">Leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.data.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="p-3">
                    <Link href={`/marketing/campaigns/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {c.code} · {CAMPAIGN_TYPE_INFO[c.type].label} · {c.channels.map((ch) => CAMPAIGN_CHANNEL_INFO[ch].label).join(', ') || 'No channels'}
                    </span>
                  </td>
                  <td className="p-3">
                    <MarketingStatusBadge status={c.status} />
                  </td>
                  <td className="p-3 whitespace-nowrap">{formatRange(c.startAt, c.endAt, c.timezone || tz)}</td>
                  <td className="p-3">{c.budgetAmount ? formatMoney(c.budgetAmount, c.currency) : '–'}</td>
                  <td className="p-3">{moneyList(c.spend)}</td>
                  <td className="p-3">{c.counts.leads.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
