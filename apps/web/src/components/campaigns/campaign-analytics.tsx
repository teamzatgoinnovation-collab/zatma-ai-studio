'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton, Tabs } from '@zatma/ui';
import { CAMPAIGN_CHANNEL_INFO, formatMoney, type CampaignAnalyticsDto, type MarketingCampaignDto } from '@zatma/validation';
import { api } from '@/lib/api';
import { SOURCE_LABELS } from '@/lib/crm';
import { todayKey } from '@/lib/publishing';
import { useNow } from '@/lib/use-now';
import { DailyColumns } from '@/components/ads/insights-chart';
import { dateOfEnd, dateOfStart, moneyList } from './shared';

const RANGES = [
  { id: 'campaign', label: 'Campaign dates' },
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
];
const DAY = 86_400_000;
const shift = (key: string, days: number) => new Date(new Date(`${key}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);

function rangeFor(id: string, c: MarketingCampaignDto, today: string): { from: string; to: string } {
  if (id === 'campaign' && c.startAt && c.endAt) {
    const from = dateOfStart(c.startAt, c.timezone);
    const end = dateOfEnd(c.endAt, c.timezone);
    const to = end < today ? end : today < from ? from : today;
    return { from, to: shift(from, 399) < to ? shift(from, 399) : to };
  }
  const n = id === 'campaign' ? 30 : Number(id);
  return { from: shift(today, -(n - 1)), to: today };
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const n = (v: number) => v.toLocaleString('en-IN');
const pct = (v: number | null) => (v === null ? '–' : `${v}%`);

export function CampaignAnalytics({ campaign: c }: { campaign: MarketingCampaignDto }) {
  const now = useNow(60_000);
  const today = todayKey(c.timezone, new Date(now));
  const [range, setRange] = useState(c.startAt && c.endAt ? 'campaign' : '30');
  const [metric, setMetric] = useState('leads');
  const [table, setTable] = useState(false);
  const r = rangeFor(range, c, today);
  const q = useQuery({ queryKey: ['campaigns', 'analytics', c.id, r.from, r.to], queryFn: () => api.campaigns.analytics(c.id, r.from, r.to), placeholderData: keepPreviousData });
  const ranges = c.startAt && c.endAt ? RANGES : RANGES.slice(1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs label="Date range" items={ranges} value={range} onChange={setRange} />
        <span className="text-xs text-muted-foreground">
          {r.from} to {r.to}
        </span>
      </div>
      {q.isPending ? (
        <Skeleton className="h-80" />
      ) : q.isError ? (
        <ErrorState description="Couldn't load analytics." onRetry={() => void q.refetch()} />
      ) : (
        <AnalyticsBody a={q.data} currency={c.currency} metric={metric} setMetric={setMetric} table={table} setTable={setTable} />
      )}
    </div>
  );
}

function AnalyticsBody({ a, currency, metric, setMetric, table, setTable }: { a: CampaignAnalyticsDto; currency: string; metric: string; setMetric: (m: string) => void; table: boolean; setTable: (t: boolean) => void }) {
  const t = a.totals;
  // Spend is charted in one currency only (the campaign's, or the first one with spend).
  const spendCurrency = t.spend.find((s) => s.currency === currency)?.currency ?? t.spend[0]?.currency ?? currency;
  const metrics = [
    { id: 'leads', label: 'Leads', value: (d: CampaignAnalyticsDto['daily'][number]) => d.leads, format: n },
    { id: 'clicks', label: 'Link clicks', value: (d: CampaignAnalyticsDto['daily'][number]) => d.linkClicks, format: n },
    { id: 'spend', label: `Ad spend (${spendCurrency})`, value: (d: CampaignAnalyticsDto['daily'][number]) => Number(d.spend.find((s) => s.currency === spendCurrency)?.amount ?? 0), format: (v: number) => formatMoney(v.toFixed(2), spendCurrency) },
  ];
  const m = metrics.find((x) => x.id === metric) ?? metrics[0]!;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Leads" value={n(t.leads)} hint={`${n(t.platformLeads)} reported by ad platforms`} />
        <Tile label="Won deals" value={n(t.wonDeals)} hint={moneyList(t.wonValue, 'No revenue yet')} />
        <Tile label="Link clicks" value={n(t.linkClicks)} hint={`${n(t.uniqueClicks)} unique visitors`} />
        <Tile label="Ad spend" value={moneyList(t.spend, formatMoney('0', currency))} hint={`${n(t.impressions)} impressions · ${n(t.adClicks)} ad clicks`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Lead → won" value={pct(t.leadToWon)} />
        <Tile label="Posts published" value={n(t.postsPublished)} />
        <Tile label="Platform conversions" value={n(t.platformConversions)} />
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Daily</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs label="Metric" items={metrics.map((x) => ({ id: x.id, label: x.label }))} value={m.id} onChange={setMetric} />
            <Button variant="ghost" size="sm" onClick={() => setTable(!table)} aria-pressed={table}>
              {table ? 'Show chart' : 'Show table'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {table ? (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Daily results</caption>
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Date</th>
                    <th className="p-2 text-right font-medium">Leads</th>
                    <th className="p-2 text-right font-medium">Won</th>
                    <th className="p-2 text-right font-medium">Link clicks</th>
                    <th className="p-2 text-right font-medium">Ad clicks</th>
                    <th className="p-2 text-right font-medium">Spend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {a.daily.map((d) => (
                    <tr key={d.date}>
                      <td className="p-2">{d.date}</td>
                      <td className="p-2 text-right tabular-nums">{d.leads}</td>
                      <td className="p-2 text-right tabular-nums">{d.won}</td>
                      <td className="p-2 text-right tabular-nums">{d.linkClicks}</td>
                      <td className="p-2 text-right tabular-nums">{d.adClicks}</td>
                      <td className="p-2 text-right tabular-nums">{moneyList(d.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <figure>
              <figcaption className="mb-2 text-sm font-medium">{m.label} per day</figcaption>
              <DailyColumns name={m.label} format={m.format} days={a.daily.map((d) => ({ date: d.date, value: m.value(d), detail: `${d.leads} leads · ${d.linkClicks} link clicks` }))} />
            </figure>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By channel</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">Results by channel</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Channel</th>
                  <th className="p-2 font-medium">Planned</th>
                  <th className="p-2 font-medium">Spent</th>
                  <th className="p-2 text-right font-medium">Leads</th>
                  <th className="p-2 text-right font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.channels.map((ch) => (
                  <tr key={ch.channel}>
                    <td className="p-2">
                      {CAMPAIGN_CHANNEL_INFO[ch.channel].label}
                      {!CAMPAIGN_CHANNEL_INFO[ch.channel].available && <span className="block text-xs text-muted-foreground">{CAMPAIGN_CHANNEL_INFO[ch.channel].note}</span>}
                    </td>
                    <td className="p-2">{ch.plannedBudget ? formatMoney(ch.plannedBudget, currency) : '–'}</td>
                    <td className="p-2">{moneyList(ch.spend)}</td>
                    <td className="p-2 text-right tabular-nums">{ch.leads}</td>
                    <td className="p-2 text-right tabular-nums">{ch.linkClicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads by source</CardTitle>
          </CardHeader>
          <CardContent>
            {a.leadsBySource.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leads in this period.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {a.leadsBySource.map((s) => (
                  <li key={s.source} className="flex items-center gap-3">
                    <span className="w-28 shrink-0">{SOURCE_LABELS[s.source as keyof typeof SOURCE_LABELS] ?? s.source}</span>
                    <span aria-hidden="true" className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(4, (s.count / Math.max(...a.leadsBySource.map((x) => x.count))) * 100)}%`, maxWidth: '60%' }} />
                    <span className="tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
