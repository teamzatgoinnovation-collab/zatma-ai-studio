'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays, Plus, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { buttonVariants, Card, EmptyState, ErrorState, Meter, Skeleton, Tabs } from '@zatma/ui';
import type { PostStatus } from '@zatma/validation';
import { api } from '@/lib/api';
import { formatInZone } from '@/lib/publishing';
import { PlatformMark } from '@/components/social/accounts';
import { PostStatusBadge } from './shared';

const TABS: Array<{ id: string; label: string; status?: PostStatus }> = [
  { id: 'all', label: 'All' },
  { id: 'drafts', label: 'Drafts', status: 'DRAFT' },
  { id: 'approval', label: 'Pending approval', status: 'PENDING_APPROVAL' },
  { id: 'scheduled', label: 'Scheduled', status: 'SCHEDULED' },
  { id: 'published', label: 'Published', status: 'PUBLISHED' },
  { id: 'failed', label: 'Failed', status: 'FAILED' },
];

export function PostsList() {
  const [tab, setTab] = useState('all');
  const status = TABS.find((t) => t.id === tab)?.status;
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const settings = useQuery({ queryKey: ['social', 'settings'], queryFn: api.social.settings });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: api.billing.usage });
  const posts = useQuery({ queryKey: ['social', 'posts', status ?? 'all'], queryFn: () => api.social.posts.list({ status, pageSize: 50 }), placeholderData: keepPreviousData });
  const tz = org.data?.timezone ?? 'Asia/Kolkata';
  const quota = usage.data?.metrics.find((m) => m.metric === 'postsPerMonth');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Filter posts" items={TABS} value={tab} onChange={setTab} className="max-w-full overflow-x-auto" />
        <div className="flex gap-2">
          <Link href="/marketing/calendar" className={buttonVariants({ variant: 'outline' })}>
            <CalendarDays aria-hidden="true" /> Calendar
          </Link>
          {settings.data?.canDraft && (
            <Link href="/marketing/social/new" className={buttonVariants()}>
              <Plus aria-hidden="true" /> New post
            </Link>
          )}
        </div>
      </div>
      {quota && (
        <div className="max-w-sm">
          <Meter label="Posts this month" used={quota.used} limit={quota.limit} />
        </div>
      )}
      {posts.isPending ? (
        <Skeleton className="h-64" />
      ) : posts.isError ? (
        <ErrorState description="Couldn't load posts." onRetry={() => void posts.refetch()} />
      ) : posts.data.data.length === 0 ? (
        <EmptyState
          icon={<Send />}
          title={status ? 'Nothing here' : 'No posts yet'}
          description={status ? 'No posts with this status.' : 'Compose a post, preview it for each platform, then publish it now or schedule it on the calendar.'}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Posts">
            {posts.data.data.map((p) => {
              const first = p.media[0];
              const when = p.publishedAt ?? p.scheduledAt;
              return (
                <li key={p.id}>
                  <Link href={`/marketing/social/${p.id}`} className="flex items-center gap-3 p-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-4">
                    <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted text-xs text-muted-foreground">
                      {first?.kind === 'image' && first.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={first.url} alt="" className="size-full object-cover" />
                      ) : first?.kind === 'video' ? (
                        'Video'
                      ) : (
                        'Text'
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm">{p.caption || <span className="text-muted-foreground">No caption</span>}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex -space-x-1" aria-label={p.targets.map((t) => t.account.name).join(', ')}>
                          {p.targets.slice(0, 5).map((t) => (
                            <PlatformMark key={t.id} platform={t.platform} className="size-5 rounded text-[8px] ring-2 ring-card" />
                          ))}
                        </span>
                        {when ? formatInZone(when, p.timezone ?? tz) : `Edited ${formatInZone(p.updatedAt, tz, { dateStyle: 'medium' })}`}
                        {p.createdBy ? ` · ${p.createdBy.name}` : ''}
                      </span>
                    </span>
                    <PostStatusBadge status={p.status} className="shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
