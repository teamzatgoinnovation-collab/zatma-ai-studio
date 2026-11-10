'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarClock, KanbanSquare, Trophy, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Card, CardContent, EmptyState, ErrorState, Label, Select, Skeleton, Tabs } from '@zatma/ui';
import { ACTIVITY_TYPES, LEAD_STATUSES } from '@zatma/validation';
import { api } from '@/lib/api';
import { ACTIVITY_LABELS, formatMoney, LEAD_STATUS_LABELS, toQuery } from '@/lib/crm';
import { Pager } from './lists';
import { useCrmAccess } from './shared';
import { ActivityItem } from './timeline';

function Stat({ label, value, href, icon }: { label: string; value: string; href: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardContent className="flex items-center gap-4 p-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5" aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="truncate text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function CrmOverview() {
  const summary = useQuery({ queryKey: ['crm', 'summary'], queryFn: api.crm.summary });
  if (summary.isPending) return <Skeleton className="h-64" />;
  if (summary.isError) return <ErrorState description="Couldn't load the CRM overview." onRetry={() => void summary.refetch()} />;
  const s = summary.data;
  const openLeads = s.leadsByStatus.NEW + s.leadsByStatus.CONTACTED + s.leadsByStatus.QUALIFIED;
  const maxStatus = Math.max(1, ...LEAD_STATUSES.map((k) => s.leadsByStatus[k]));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open leads" value={openLeads.toLocaleString()} href="/crm/leads" icon={<UserRound />} />
        <Stat label="Open pipeline" value={formatMoney(s.openPipelineValue, s.currency, { compact: s.openPipelineValue >= 1e6 })} href="/crm/pipeline" icon={<KanbanSquare />} />
        <Stat label={`Won this month (${s.wonThisMonth.count})`} value={formatMoney(s.wonThisMonth.value, s.currency, { compact: s.wonThisMonth.value >= 1e6 })} href="/crm/deals?status=WON" icon={<Trophy />} />
        <Stat label={`Follow-ups due today${s.followUps.overdue ? ` · ${s.followUps.overdue} overdue` : ''}`} value={s.followUps.today.toLocaleString()} href="/crm/follow-ups" icon={<CalendarClock />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="font-semibold">Leads by status</h2>
            <ul className="space-y-2">
              {LEAD_STATUSES.map((k) => (
                <li key={k} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
                  <span>{LEAD_STATUS_LABELS[k]}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${(s.leadsByStatus[k] / maxStatus) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{s.leadsByStatus[k]}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-3 gap-4 p-5 text-center">
            <h2 className="col-span-3 text-left font-semibold">Relationships</h2>
            {(
              [
                ['Contacts', s.contacts, '/crm/contacts'],
                ['Customers', s.customers, '/crm/customers'],
                ['Companies', s.companies, '/crm/companies'],
              ] as const
            ).map(([label, n, href]) => (
              <Link key={label} href={href} className="rounded-xl bg-muted p-4 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="text-2xl font-semibold tabular-nums">{n.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ───────────── Follow-ups ─────────────

const RANGES = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'all', label: 'All open' },
] as const;

export function FollowUps() {
  const access = useCrmAccess();
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('today');
  const [mine, setMine] = useState(!access.seesAll);
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const list = useQuery({ queryKey: ['crm', 'follow-ups', range, mine, tz], queryFn: () => api.crm.activities.followUps({ range, owner: mine ? 'me' : 'all', ...(tz ? { tz } : {}) }) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Due" items={RANGES.map((r) => ({ id: r.id, label: r.label }))} value={range} onChange={(v) => setRange(v as typeof range)} withPanels />
        {access.seesAll && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine
          </label>
        )}
      </div>
      <div role="tabpanel" id={`panel-${range}`} aria-labelledby={`tab-${range}`}>
        {list.isPending ? (
          <Skeleton className="h-48" />
        ) : list.isError ? (
          <ErrorState description="Couldn't load follow-ups." onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title={range === 'overdue' ? 'Nothing overdue' : 'No follow-ups here'} description="Schedule follow-ups from any lead, contact, company or deal." />
        ) : (
          <ul className="space-y-4 rounded-2xl border border-border bg-card p-4">
            {list.data.map((a) => (
              <ActivityItem key={a.id} a={a} canWrite={access.canWrite} showTarget />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ───────────── Activities ─────────────

export function ActivitiesList() {
  const access = useCrmAccess();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['crm', 'activities', type, status, page],
    queryFn: () => api.crm.activities.list(toQuery({ type, status, page, pageSize: 30 })),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="w-48">
          <Label htmlFor="activity-type" className="sr-only">
            Type
          </Label>
          <Select
            id="activity-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Type: all</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Label htmlFor="activity-status" className="sr-only">
            Status
          </Label>
          <Select
            id="activity-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Status: all</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
          </Select>
        </div>
      </div>
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : list.isError ? (
        <ErrorState description="Couldn't load activities." onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState icon={<Users />} title="No activities yet" description="Calls, WhatsApp messages, emails, meetings and notes you log on records appear here." />
      ) : (
        <>
          <ul className="space-y-4 rounded-2xl border border-border bg-card p-4">
            {list.data.data.map((a) => (
              <ActivityItem key={a.id} a={a} canWrite={access.canWrite} showTarget />
            ))}
          </ul>
          <Pager meta={list.data.meta} page={page} onPage={setPage} />
        </>
      )}
    </div>
  );
}
