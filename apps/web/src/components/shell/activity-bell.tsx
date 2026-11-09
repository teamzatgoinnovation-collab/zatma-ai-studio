'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, Bell } from 'lucide-react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Skeleton } from '@zatma/ui';
import { api } from '@/lib/api';
import { describeActivity, safeStorage, subscribeStorage, timeAgo, unreadCount, writeStorage } from '@/lib/activity';

/**
 * Recent organization activity from the audit log. Full notifications (assignments,
 * follow-ups due, campaign results) arrive in Phase 18.
 */
export function ActivityBell() {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const canRead = org.data?.permissions.includes('audit:read') ?? false;
  const activity = useQuery({
    queryKey: ['audit-logs', 'bell'],
    queryFn: () => api.auditLogs.list({ pageSize: 10 }),
    enabled: canRead,
    refetchInterval: 60_000,
  });
  const storageKey = org.data ? `zatma.activity.seen.${org.data.id}` : null;
  const lastSeen = useSyncExternalStore(
    subscribeStorage,
    () => (storageKey ? safeStorage.get(storageKey) : null),
    () => null,
  );

  const entries = activity.data?.data ?? [];
  const unread = unreadCount(entries, lastSeen);

  const markSeen = (open: boolean) => {
    if (!open || !storageKey || entries.length === 0) return;
    const newest = entries[0]!.createdAt;
    writeStorage(storageKey, newest);
  };

  return (
    <DropdownMenu onOpenChange={markSeen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Activity, ${unread} new` : 'Activity'}>
          <Bell aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 p-0">
        <DropdownMenuLabel className="flex items-center justify-between px-4 py-3 text-sm text-foreground">
          Recent activity
          {canRead && (
            <Link href="/dashboard#activity" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-96 overflow-y-auto p-2">
          {!canRead && !org.isPending && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Your role can’t view organization activity.</p>}
          {canRead && activity.isPending && <Skeleton className="h-24" />}
          {canRead && activity.isError && <p className="px-2 py-6 text-center text-sm text-destructive">Couldn’t load activity.</p>}
          {canRead && activity.data && entries.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No activity yet.</p>}
          <ul>
            {entries.map((e) => {
              const isNew = !lastSeen || new Date(e.createdAt) > new Date(lastSeen);
              return (
                <li key={e.id} className="flex gap-3 rounded-lg px-2 py-2">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Activity className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{describeActivity(e)}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(e.createdAt)}</p>
                  </div>
                  {isNew && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
                </li>
              );
            })}
          </ul>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
