'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Link2, Plus, Send } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@zatma/ui';
import { api } from '@/lib/api';
import { formatInZone } from '@/lib/publishing';
import { useNow } from '@/lib/use-now';
import { PlatformMark } from '@/components/social/accounts';
import { PostStatusBadge } from './shared';

function Stat({ label, value, href, icon }: { label: string; value: number | string; href: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-2xl border border-border bg-card p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </span>
      <span className="mt-1 block text-2xl font-semibold">{value}</span>
    </Link>
  );
}

/** Marketing home: what's going out next, what needs attention, and quick actions. */
export function MarketingOverview() {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const settings = useQuery({ queryKey: ['social', 'settings'], queryFn: api.social.settings });
  const accounts = useQuery({ queryKey: ['social', 'accounts'], queryFn: api.social.accounts });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: api.billing.usage });
  const pending = useQuery({ queryKey: ['social', 'posts', 'PENDING_APPROVAL'], queryFn: () => api.social.posts.list({ status: 'PENDING_APPROVAL', pageSize: 5 }) });
  const failed = useQuery({ queryKey: ['social', 'posts', 'FAILED'], queryFn: () => api.social.posts.list({ status: 'FAILED', pageSize: 5 }) });
  const now = useNow(60_000);
  const upcoming = useQuery({
    queryKey: ['social', 'calendar', 'next7', Math.floor(now / 3_600_000)],
    queryFn: () => api.social.calendar({ from: new Date(now).toISOString(), to: new Date(now + 7 * 86_400_000).toISOString(), status: 'SCHEDULED' }),
  });
  if (org.isPending || accounts.isPending) return <Skeleton className="h-96" />;
  const tz = org.data?.timezone ?? 'Asia/Kolkata';
  const attention = (accounts.data ?? []).filter((a) => a.status !== 'ACTIVE');
  const posts = usage.data?.metrics.find((m) => m.metric === 'postsPerMonth');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {settings.data?.canDraft && (
          <Link href="/marketing/social/new" className={buttonVariants()}>
            <Plus aria-hidden="true" /> New post
          </Link>
        )}
        <Link href="/marketing/calendar" className={buttonVariants({ variant: 'outline' })}>
          <CalendarDays aria-hidden="true" /> Content calendar
        </Link>
        <Link href="/marketing/accounts" className={buttonVariants({ variant: 'outline' })}>
          <Link2 aria-hidden="true" /> Social accounts
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Scheduled (7 days)" value={upcoming.data?.length ?? '–'} href="/marketing/calendar" icon={<CalendarDays />} />
        <Stat label="Posts this month" value={posts ? `${posts.used}${posts.limit === -1 ? '' : ` / ${posts.limit}`}` : '–'} href="/marketing/social" icon={<Send />} />
        <Stat label="Waiting for approval" value={pending.data?.meta.total ?? '–'} href="/marketing/social" icon={<Send />} />
        <Stat label="Connected accounts" value={accounts.data?.length ?? 0} href="/marketing/accounts" icon={<Link2 />} />
      </div>
      {(attention.length > 0 || (failed.data?.meta.total ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning-text" aria-hidden="true" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {attention.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <PlatformMark platform={a.platform} className="size-5 rounded text-[8px]" />
                  <Link className="font-medium hover:underline" href="/marketing/accounts">
                    {a.name}
                  </Link>
                  <span className="text-muted-foreground">needs reconnecting</span>
                </li>
              ))}
              {failed.data?.data.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <PostStatusBadge status={p.status} />
                  <Link className="truncate hover:underline" href={`/marketing/social/${p.id}`}>
                    {p.caption.slice(0, 80) || 'Untitled post'}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Up next</CardTitle>
        </CardHeader>
        <CardContent>
          {!upcoming.data?.length ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled for the next 7 days.</p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.data.map((e) => (
                <li key={e.id}>
                  <Link href={`/marketing/social/${e.id}`} className="flex items-center gap-3 py-2 hover:bg-muted">
                    <span className="w-36 shrink-0 text-sm font-medium">{formatInZone(e.at, tz, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="flex -space-x-1">
                      {e.platforms.map((p) => (
                        <PlatformMark key={p} platform={p} className="size-5 rounded text-[8px] ring-2 ring-card" />
                      ))}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{e.caption || 'No caption'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
