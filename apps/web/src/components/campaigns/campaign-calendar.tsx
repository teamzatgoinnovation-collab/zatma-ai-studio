'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, cn, ErrorState, Skeleton } from '@zatma/ui';
import { CAMPAIGN_CHANNEL_INFO, MARKETING_STATUS_LABELS, type CampaignCalendarEntry } from '@zatma/validation';
import { api } from '@/lib/api';
import { addDays, fromLocalInput, keyOf, monthGrid, shiftAnchor, todayKey } from '@/lib/publishing';
import { useNow } from '@/lib/use-now';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND_LABEL: Record<CampaignCalendarEntry['kind'], string> = { campaign: 'Campaign', post: 'Post', ad: 'Ad flight', task: 'Task', content: 'Planned' };
const KIND_CLASS: Record<CampaignCalendarEntry['kind'], string> = {
  campaign: 'border-l-primary bg-primary/10',
  post: 'border-l-success bg-muted',
  ad: 'border-l-warning bg-muted',
  task: 'border-l-border bg-muted',
  content: 'border-l-border bg-background border border-dashed',
};

function hrefOf(e: CampaignCalendarEntry): string | null {
  if (e.kind === 'campaign') return `/marketing/campaigns/${e.id}`;
  if (e.kind === 'post') return `/marketing/social/${e.id}`;
  if (e.kind === 'ad') return `/ads/campaigns/${e.id}`;
  return e.campaignId ? `/marketing/campaigns/${e.campaignId}` : null;
}

function detailOf(e: CampaignCalendarEntry): string {
  if (e.kind === 'campaign') return MARKETING_STATUS_LABELS[e.status];
  if (e.kind === 'content') return CAMPAIGN_CHANNEL_INFO[e.channel].label;
  if (e.kind === 'task') return e.done ? 'Done' : 'Open';
  return e.status.toLowerCase().replace('_', ' ');
}

/** Days an entry appears on: spans for campaigns and ad flights, a single day otherwise. */
function daysOf(e: CampaignCalendarEntry, tz: string, gridStart: string, gridEnd: string): string[] {
  const first = keyOf(e.start, tz);
  const endIso = e.kind === 'campaign' ? e.end : e.kind === 'ad' ? e.end : null;
  if (!endIso) return [first];
  const last = keyOf(new Date(new Date(endIso).getTime() - 1).toISOString(), tz);
  const out: string[] = [];
  for (let k = first < gridStart ? gridStart : first; k <= last && k <= gridEnd; k = addDays(k, 1)) out.push(k);
  return out;
}

export function CampaignCalendar({ campaignId, timezone, initial }: { campaignId?: string; timezone: string; initial?: string | null }) {
  const now = useNow(60_000);
  const today = todayKey(timezone, new Date(now));
  const [anchor, setAnchor] = useState<string | null>(initial ? keyOf(initial, timezone) : null);
  const current = anchor ?? today;
  const weeks = monthGrid(current);
  const gridStart = weeks[0]![0]!.key;
  const gridEnd = weeks.at(-1)!.at(-1)!.key;
  const from = fromLocalInput(`${gridStart}T00:00`, timezone);
  const to = fromLocalInput(`${addDays(gridEnd, 1)}T00:00`, timezone);
  const q = useQuery({ queryKey: ['campaigns', 'calendar', campaignId ?? 'all', from, to], queryFn: () => api.campaigns.calendar({ from, to, ...(campaignId ? { campaignId } : {}) }), placeholderData: keepPreviousData });
  const byDay: Record<string, CampaignCalendarEntry[]> = {};
  for (const e of q.data ?? []) for (const k of daysOf(e, timezone, gridStart, gridEnd)) (byDay[k] ??= []).push(e);
  const title = new Date(`${current.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setAnchor(shiftAnchor('month', current, -1))}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setAnchor(shiftAnchor('month', current, 1))}>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(today)}>
          Today
        </Button>
        <h3 className="ml-1 font-semibold" aria-live="polite">
          {title}
        </h3>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
          {(Object.keys(KIND_LABEL) as CampaignCalendarEntry['kind'][]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn('h-3 w-3 rounded-sm border-l-4', KIND_CLASS[k])} />
              {KIND_LABEL[k]}
            </li>
          ))}
        </ul>
      </div>
      {q.isError ? (
        <ErrorState description="Couldn't load the calendar." onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] table-fixed border-collapse text-xs">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d} scope="col" className="p-1 text-left font-medium text-muted-foreground">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w[0]!.key}>
                  {w.map((d) => {
                    const items = byDay[d.key] ?? [];
                    return (
                      <td key={d.key} className={cn('h-28 border border-border p-1 align-top', !d.inMonth && 'bg-muted/40 text-muted-foreground')}>
                        <div className={cn('mb-1 text-right font-medium', d.key === today && 'text-primary')}>
                          {d.key === today && <span className="sr-only">Today, </span>}
                          {Number(d.key.slice(8))}
                        </div>
                        <ul className="space-y-0.5">
                          {items.slice(0, 4).map((e) => {
                            const href = hrefOf(e);
                            const text = `${KIND_LABEL[e.kind]}: ${e.title} (${detailOf(e)})`;
                            return (
                              <li key={`${e.kind}-${e.id}`} className={cn('truncate rounded border-l-4 px-1 py-0.5', KIND_CLASS[e.kind], e.kind === 'task' && e.done && 'line-through')} title={text}>
                                {href ? (
                                  <Link href={href} className="hover:underline">
                                    <span className="sr-only">{KIND_LABEL[e.kind]}: </span>
                                    {e.title}
                                  </Link>
                                ) : (
                                  e.title
                                )}
                              </li>
                            );
                          })}
                          {items.length > 4 && <li className="px-1 text-muted-foreground">+{items.length - 4} more</li>}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
