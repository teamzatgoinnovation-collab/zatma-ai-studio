'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonVariants, Card, cn, Dialog, DialogContent, ErrorState, Input, Label, Select, Skeleton, Tabs } from '@zatma/ui';
import { PLATFORM_LABELS, POST_STATUS_LABELS, SOCIAL_PLATFORMS, type CalendarEntry, type SocialPlatform } from '@zatma/validation';
import { api } from '@/lib/api';
import { formatInZone, fromLocalInput, groupByDay, moveToDay, monthGrid, POST_TONE, shiftAnchor, toLocalInput, todayKey, viewRange, type CalendarView } from '@/lib/publishing';
import { PlatformMark } from '@/components/social/accounts';
import { useNow } from '@/lib/use-now';
import { describeError } from './shared';

const VIEWS: Array<{ id: CalendarView; label: string }> = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
  { id: 'list', label: 'List' },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TONE_CLASS = { success: 'border-l-success', warning: 'border-l-warning', danger: 'border-l-destructive', neutral: 'border-l-border', primary: 'border-l-primary' } as const;

export function ContentCalendar() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const settings = useQuery({ queryKey: ['social', 'settings'], queryFn: api.social.settings });
  const workspaces = useQuery({ queryKey: ['workspaces', 'all'], queryFn: () => api.workspaces.list({ pageSize: 100 }) });
  const tz = org.data?.timezone ?? 'Asia/Kolkata';
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [platform, setPlatform] = useState<SocialPlatform | ''>('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [moving, setMoving] = useState<{ entry: CalendarEntry; to: string } | null>(null);
  const now = useNow();
  const today = todayKey(tz, new Date(now));
  const current = anchor ?? today;
  const range = useMemo(() => viewRange(view, current, tz), [view, current, tz]);
  const canPublish = settings.data?.canPublish ?? false;

  const entries = useQuery({
    queryKey: ['social', 'calendar', range.from, range.to, platform, workspaceId],
    queryFn: () => api.social.calendar({ from: range.from, to: range.to, platform: platform || undefined, workspaceId: workspaceId || undefined }),
    enabled: !!org.data,
    placeholderData: keepPreviousData,
  });
  const byDay = useMemo(() => groupByDay(entries.data ?? [], tz), [entries.data, tz]);

  const reschedule = useMutation({
    mutationFn: ({ id, at }: { id: string; at: string }) => api.social.posts.schedule(id, { scheduledAt: at, timezone: tz }),
    onSuccess: async (dto) => {
      await qc.invalidateQueries({ queryKey: ['social'] });
      toast.success(`Moved to ${formatInZone(dto.scheduledAt!, tz)}`);
      setMoving(null);
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const title =
    view === 'month'
      ? formatInZone(fromLocalInput(`${current.slice(0, 8)}15T12:00`, tz), tz, { month: 'long', year: 'numeric' })
      : view === 'day'
        ? formatInZone(fromLocalInput(`${current}T12:00`, tz), tz, { dateStyle: 'full' })
        : `${formatInZone(fromLocalInput(`${range.days[0]}T12:00`, tz), tz, { day: 'numeric', month: 'short' })} – ${formatInZone(fromLocalInput(`${range.days.at(-1)}T12:00`, tz), tz, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const onDrop = (id: string, key: string) => {
    const e = entries.data?.find((x) => x.id === id);
    if (!e || e.status !== 'SCHEDULED') return;
    const to = moveToDay(e.at, tz, key);
    if (new Date(to).getTime() <= now) return toast.error('Pick a day in the future');
    setMoving({ entry: e, to });
  };

  if (org.isPending) return <Skeleton className="h-[36rem]" />;

  const ctx: Ctx = {
    tz,
    today,
    canPublish,
    canDraft: settings.data?.canDraft ?? false,
    byDay,
    onDrop,
    onMove: (e) => setMoving({ entry: e, to: e.at }),
    onMore: (key) => {
      setView('day');
      setAnchor(key);
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Previous" onClick={() => setAnchor(shiftAnchor(view, current, -1))}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(null)}>
            Today
          </Button>
          <Button size="icon" variant="outline" aria-label="Next" onClick={() => setAnchor(shiftAnchor(view, current, 1))}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <h2 className="min-w-48 text-lg font-semibold" aria-live="polite">
          {title}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {(workspaces.data?.data.length ?? 0) > 1 && (
            <Select aria-label="Workspace" className="w-40" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              <option value="">All workspaces</option>
              {workspaces.data!.data.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
          <Select aria-label="Platform" className="w-44" value={platform} onChange={(e) => setPlatform(e.target.value as SocialPlatform | '')}>
            <option value="">All platforms</option>
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </Select>
          <Tabs label="Calendar view" items={VIEWS} value={view} onChange={(v) => setView(v as CalendarView)} />
          {settings.data?.canDraft && (
            <Link href="/marketing/social/new" className={buttonVariants()}>
              <Plus aria-hidden="true" /> New post
            </Link>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Times in {tz}.{canPublish ? ' Drag a scheduled post to another day, or use its clock button, to reschedule.' : ''}
      </p>

      {entries.isError ? (
        <ErrorState description="Couldn't load the calendar." onRetry={() => void entries.refetch()} />
      ) : view === 'list' ? (
        <Card>
          {Object.keys(byDay).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing scheduled in the next 30 days.</p>
          ) : (
            <ol className="divide-y divide-border">
              {Object.entries(byDay).map(([key, list]) => (
                <li key={key} className="grid gap-2 p-3 sm:grid-cols-[10rem_1fr]">
                  <p className="text-sm font-medium">{formatInZone(fromLocalInput(`${key}T12:00`, tz), tz, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((e) => (
                      <Entry key={e.id} e={e} ctx={ctx} />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <div className={cn('min-w-[44rem]', entries.isFetching && 'opacity-70')}>
            {view !== 'day' && (
              <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium text-muted-foreground">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="py-2">
                    {d}
                  </div>
                ))}
              </div>
            )}
            {view === 'month' ? (
              monthGrid(current).map((week) => (
                <div key={week[0]!.key} className="grid grid-cols-7">
                  {week.map((c) => (
                    <DayCell key={c.key} dayKey={c.key} inMonth={c.inMonth} ctx={ctx} />
                  ))}
                </div>
              ))
            ) : view === 'week' ? (
              <div className="grid grid-cols-7">
                {range.days.map((k) => (
                  <DayCell key={k} dayKey={k} tall ctx={ctx} />
                ))}
              </div>
            ) : (
              <DayCell dayKey={current} tall ctx={ctx} />
            )}
          </div>
        </Card>
      )}

      <RescheduleDialog moving={moving} timezone={tz} pending={reschedule.isPending} onClose={() => setMoving(null)} onConfirm={(at) => moving && reschedule.mutate({ id: moving.entry.id, at })} />
    </div>
  );
}

interface Ctx {
  tz: string;
  today: string;
  canPublish: boolean;
  canDraft: boolean;
  byDay: Record<string, CalendarEntry[]>;
  onDrop: (postId: string, key: string) => void;
  onMove: (e: CalendarEntry) => void;
  onMore: (key: string) => void;
}

function Entry({ e, compact, ctx }: { e: CalendarEntry; compact?: boolean; ctx: Ctx }) {
  const { tz, canPublish } = ctx;
  return (
    <div
      className={cn('group flex items-start gap-1.5 rounded-lg border border-l-4 border-border bg-card p-1.5 text-xs shadow-sm', TONE_CLASS[POST_TONE[e.status]])}
      draggable={canPublish && e.status === 'SCHEDULED'}
      onDragStart={(ev) => ev.dataTransfer.setData('text/post-id', e.id)}
    >
      <Link href={`/marketing/social/${e.id}`} className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-1 font-medium">
          {formatInZone(e.at, tz, { hour: 'numeric', minute: '2-digit' })}
          <span className="flex -space-x-1">
            {e.platforms.map((p) => (
              <PlatformMark key={p} platform={p} className="size-4 rounded text-[7px] ring-1 ring-card" />
            ))}
          </span>
        </span>
        <span className={cn('block text-muted-foreground', compact ? 'truncate' : 'line-clamp-2')}>{e.caption || 'No caption'}</span>
        <span className="sr-only">
          {POST_STATUS_LABELS[e.status]}, {e.accounts.map((a) => a.name).join(', ')}
        </span>
      </Link>
      {canPublish && e.status === 'SCHEDULED' && (
        <button type="button" className="rounded p-0.5 text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100 focus-visible:opacity-100" onClick={() => ctx.onMove(e)} aria-label={`Reschedule post: ${e.caption.slice(0, 40) || 'no caption'}`}>
          <CalendarClock className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function DayCell({ dayKey: key, inMonth = true, tall, ctx }: { dayKey: string; inMonth?: boolean; tall?: boolean; ctx: Ctx }) {
  const { tz, today, canPublish, canDraft } = ctx;
  const list = ctx.byDay[key] ?? [];
  const past = key < today;
  const [, , d] = key.split('-');
  return (
    <div
      className={cn('flex min-h-28 flex-col gap-1 border-b border-r border-border p-1.5', !inMonth && 'bg-muted/40', tall && 'min-h-72')}
      onDragOver={(ev) => !past && canPublish && ev.preventDefault()}
      onDrop={(ev) => {
        ev.preventDefault();
        ctx.onDrop(ev.dataTransfer.getData('text/post-id'), key);
      }}
    >
      <div className="flex items-center justify-between">
        <span className={cn('grid size-6 place-items-center rounded-full text-xs', key === today ? 'bg-primary font-semibold text-primary-foreground' : inMonth ? 'text-foreground' : 'text-muted-foreground')} aria-label={key === today ? 'Today' : undefined}>
          {Number(d)}
        </span>
        {!past && canDraft && (
          <Link href={`/marketing/social/new?at=${encodeURIComponent(fromLocalInput(`${key}T10:00`, tz))}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`New post on ${key}`}>
            <Plus className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      {list.slice(0, tall ? 20 : 3).map((e) => (
        <Entry key={e.id} e={e} compact={!tall} ctx={ctx} />
      ))}
      {!tall && list.length > 3 && (
        <button type="button" className="text-left text-xs font-medium text-primary hover:underline" onClick={() => ctx.onMore(key)}>
          +{list.length - 3} more
        </button>
      )}
    </div>
  );
}

function RescheduleDialog({ moving, timezone, pending, onClose, onConfirm }: { moving: { entry: CalendarEntry; to: string } | null; timezone: string; pending: boolean; onClose: () => void; onConfirm: (at: string) => void }) {
  const [value, setValue] = useState('');
  const shown = moving ? value || toLocalInput(moving.to, timezone) : '';
  const iso = shown ? fromLocalInput(shown, timezone) : null;
  const now = useNow();
  const past = !iso || new Date(iso).getTime() <= now;
  return (
    <Dialog
      open={!!moving}
      onOpenChange={(o) => {
        if (!o) {
          setValue('');
          onClose();
        }
      }}
    >
      <DialogContent title="Reschedule post" description={moving ? `Currently ${formatInZone(moving.entry.at, timezone)}. Times are in ${timezone}.` : undefined}>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="reschedule-at">New date and time</Label>
          <Input id="reschedule-at" type="datetime-local" value={shown} onChange={(e) => setValue(e.target.value)} />
          {past && <p className="text-xs text-destructive-text">Choose a time in the future.</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={past || pending}
            onClick={() => {
              if (iso) onConfirm(iso);
              setValue('');
            }}
          >
            Move post
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
