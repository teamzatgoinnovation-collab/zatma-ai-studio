'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants, Card, EmptyState, ErrorState, Select, Skeleton } from '@zatma/ui';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES, OBJECTIVE_INFO, type CampaignStatus } from '@zatma/validation';
import { api } from '@/lib/api';
import { AdPlatformMark, CampaignStatusBadge, money } from './shared';

export function CampaignsList() {
  const params = useSearchParams();
  const [platform, setPlatform] = useState<'' | 'META' | 'GOOGLE'>('');
  const [status, setStatus] = useState<'' | CampaignStatus>('');
  const [adAccountId, setAdAccountId] = useState(params.get('adAccountId') ?? '');
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const accounts = useQuery({ queryKey: ['ads', 'accounts', 'all'], queryFn: () => api.ads.accounts() });
  const list = useQuery({
    queryKey: ['ads', 'campaigns', platform, status, adAccountId],
    queryFn: () => api.ads.campaigns.list({ platform: platform || undefined, status: status || undefined, adAccountId: adAccountId || undefined, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const canManage = org.data?.permissions.includes('ads:manage') ?? false;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Platform" className="w-40" value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
          <option value="">All platforms</option>
          <option value="META">Meta</option>
          <option value="GOOGLE">Google</option>
        </Select>
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">All statuses</option>
          {CAMPAIGN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CAMPAIGN_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Ad account" className="w-56" value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)}>
          <option value="">All ad accounts</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {canManage && (
          <Link href="/ads/campaigns/new" className={`${buttonVariants()} ml-auto`}>
            <Plus aria-hidden="true" /> New campaign
          </Link>
        )}
      </div>
      {list.isPending ? (
        <Skeleton className="h-64" />
      ) : list.isError ? (
        <ErrorState description="Couldn't load campaigns." onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState icon={<Megaphone />} title="No campaigns yet" description="Build a campaign from your designs and copy. It is created paused; nothing is spent until an Owner or Admin activates it." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Campaigns</caption>
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Campaign</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Budget</th>
                <th className="p-3 font-medium">Spent</th>
                <th className="p-3 font-medium">Most it can spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.data.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="p-3">
                    <Link href={`/ads/campaigns/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <AdPlatformMark platform={c.platform} className="size-6 text-[10px]" />
                      {c.name}
                    </Link>
                    <span className="ml-8 block text-xs text-muted-foreground">
                      {OBJECTIVE_INFO[c.objective].label} · {c.adAccount.name}
                      {c.source === 'IMPORTED' ? ' · Imported' : ''}
                    </span>
                  </td>
                  <td className="p-3">
                    <CampaignStatusBadge status={c.status} />
                  </td>
                  <td className="p-3">
                    {money(c.budgetAmount, c.currency)}
                    <span className="text-xs text-muted-foreground">{c.budgetType === 'DAILY' ? '/day' : ' total'}</span>
                  </td>
                  <td className="p-3">{money(c.spend, c.currency)}</td>
                  <td className="p-3">{['ACTIVE', 'PAUSED', 'DRAFT'].includes(c.status) ? money(c.maxSpend.amount, c.currency) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
