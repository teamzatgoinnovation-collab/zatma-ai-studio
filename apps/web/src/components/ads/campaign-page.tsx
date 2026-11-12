'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Pencil, Play, Rocket, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, ErrorState, Input, Label, Skeleton, Tabs } from '@zatma/ui';
import { maxSpend, OBJECTIVE_INFO, toCents, type AdCampaignDto, type GoogleRsa, type GoogleTargeting, type MetaCreative, type MetaTargeting } from '@zatma/validation';
import { api } from '@/lib/api';
import { formatInZone } from '@/lib/publishing';
import { timeAgo } from '@/lib/activity';
import { useNow } from '@/lib/use-now';
import { SpendChart } from './insights-chart';
import { AdPlatformMark, CampaignStatusBadge, errorText, money } from './shared';

const RANGES = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
];

export function CampaignPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const now = useNow();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const q = useQuery({ queryKey: ['ads', 'campaign', id], queryFn: () => api.ads.campaigns.get(id), refetchInterval: (x) => (x.state.data?.status === 'PUBLISHING' ? 2_000 : false) });
  const [range, setRange] = useState('30');
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - (Number(range) - 1) * 86_400_000).toISOString().slice(0, 10);
  const insights = useQuery({ queryKey: ['ads', 'insights', id, from, to], queryFn: () => api.ads.campaigns.insights(id, from, to), enabled: !!q.data?.externalId });
  const [dialog, setDialog] = useState<'activate' | 'budget' | 'delete' | null>(null);
  const [table, setTable] = useState(false);

  const done = async (dto?: AdCampaignDto | void) => {
    if (dto) qc.setQueryData(['ads', 'campaign', id], dto);
    await qc.invalidateQueries({ queryKey: ['ads'] });
  };
  const act = useMutation({ mutationFn: (fn: () => Promise<AdCampaignDto | void>) => fn(), onSuccess: done, onError: (e) => toast.error(errorText(e)) });

  if (q.isPending || org.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description="Couldn't load this campaign." onRetry={() => void q.refetch()} />;
  const c = q.data;
  const perms = org.data?.permissions ?? [];
  const canManage = perms.includes('ads:manage');
  const canApprove = perms.includes('ads:approve');
  const tz = c.adAccount.timezone;
  const t = insights.data?.totals;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start gap-3 space-y-0">
          <AdPlatformMark platform={c.platform} className="size-10" />
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              {c.name} <CampaignStatusBadge status={c.status} />
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {OBJECTIVE_INFO[c.objective].label} · {c.adAccount.name} · {money(c.budgetAmount, c.currency)} {c.budgetType === 'DAILY' ? 'per day' : 'lifetime'}
              {c.endAt ? ` · ends ${formatInZone(c.endAt, tz, { dateStyle: 'medium' })}` : ''}
              {c.source === 'IMPORTED' ? ' · Imported from the platform' : ''}
              {c.lastSyncedAt ? ` · Synced ${timeAgo(c.lastSyncedAt)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && ['DRAFT', 'ERROR'].includes(c.status) && (
              <>
                <Link href={`/ads/campaigns/${c.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
                  <Pencil aria-hidden="true" /> Edit
                </Link>
                <Button disabled={act.isPending} onClick={() => act.mutate(() => api.ads.campaigns.publish(c.id), { onSuccess: () => toast.success('Creating on the platform (paused)…') })}>
                  <Rocket aria-hidden="true" /> Create (paused)
                </Button>
              </>
            )}
            {c.status === 'PAUSED' && c.externalId && canApprove && (
              <Button onClick={() => setDialog('activate')}>
                <Play aria-hidden="true" /> Activate
              </Button>
            )}
            {c.status === 'ACTIVE' && canManage && (
              <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate(() => api.ads.campaigns.pause(c.id), { onSuccess: () => toast.success('Campaign paused; spending stopped') })}>
                <Pause aria-hidden="true" /> Pause
              </Button>
            )}
            {['ACTIVE', 'PAUSED'].includes(c.status) && c.externalId && canManage && (
              <Button variant="outline" onClick={() => setDialog('budget')}>
                Change budget
              </Button>
            )}
            {canManage && c.status !== 'ACTIVE' && c.status !== 'PUBLISHING' && (
              <Button variant="ghost" onClick={() => setDialog('delete')} aria-label="Delete campaign">
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {c.status === 'PUBLISHING' && <Alert tone="info">Creating the campaign on the platform. It will be paused when ready.</Alert>}
          {c.error && <Alert>{c.error}</Alert>}
          {c.status === 'PAUSED' && c.externalId && !canApprove && <p className="text-sm text-muted-foreground">Ready. An Owner or Admin can activate it to start spending.</p>}
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Most it can spend</dt>
              <dd className="font-semibold">{money(c.maxSpend.amount, c.currency)}</dd>
              <dd className="text-xs text-muted-foreground">{c.budgetType === 'LIFETIME' ? 'lifetime budget' : c.maxSpend.untilMonthEnd ? `${c.maxSpend.days} days, to month end` : `${c.maxSpend.days} days`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Spent so far</dt>
              <dd className="font-semibold">{money(c.spend, c.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Account cap</dt>
              <dd className="font-semibold">{c.adAccount.monthlySpendCap ? `${money(c.adAccount.monthlySpendCap, c.currency)}/month` : 'None'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Activated</dt>
              <dd className="font-semibold">{c.activatedAt ? `${c.activatedBy?.name ?? '–'}, ${formatInZone(c.activatedAt, tz, { dateStyle: 'medium' })}` : 'Not yet'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {c.externalId && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Results</CardTitle>
            <div className="flex items-center gap-2">
              <Tabs label="Date range" items={RANGES} value={range} onChange={setRange} />
              <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable(!table)}>
                {table ? 'Show chart' : 'Show table'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {insights.isPending ? (
              <Skeleton className="h-48" />
            ) : !t ? null : (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  {[
                    ['Spend', money(t.spend, c.currency)],
                    ['Impressions', t.impressions.toLocaleString('en-IN')],
                    ['Reach', c.platform === 'META' ? t.reach.toLocaleString('en-IN') : '–'],
                    ['Clicks', t.clicks.toLocaleString('en-IN')],
                    ['CTR', `${t.ctr}%`],
                    ['CPC', t.cpc ? money(t.cpc, c.currency) : '–'],
                    ['CPM', t.cpm ? money(t.cpm, c.currency) : '–'],
                    [c.objective === 'LEADS' ? 'Leads' : 'Conversions', String(c.objective === 'LEADS' ? t.leads : t.conversions)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-border p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="text-lg font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
                {insights.data!.daily.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No results yet for this period. Results appear after the campaign runs and the next sync (hourly).</p>
                ) : table ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Daily results</caption>
                      <thead className="text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="py-2 font-medium">Date</th>
                          <th className="font-medium">Spend</th>
                          <th className="font-medium">Impressions</th>
                          <th className="font-medium">Clicks</th>
                          <th className="font-medium">Leads</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {insights.data!.daily.map((d) => (
                          <tr key={d.date}>
                            <td className="py-2">{d.date}</td>
                            <td>{money(d.spend, c.currency)}</td>
                            <td>{d.impressions.toLocaleString('en-IN')}</td>
                            <td>{d.clicks.toLocaleString('en-IN')}</td>
                            <td>{d.leads}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <figure>
                    <figcaption className="mb-2 text-sm font-medium">Daily spend ({c.currency})</figcaption>
                    <SpendChart days={insights.data!.daily} currency={c.currency} />
                  </figure>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{c.platform === 'META' ? 'Ad sets and ads' : 'Ad groups and ads'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {c.adGroups.length === 0 && <p className="text-sm text-muted-foreground">Imported campaign: manage its ad sets on the platform.</p>}
          {c.adGroups.map((g) => (
            <section key={g.id} className="space-y-3 rounded-xl border border-border p-4" aria-label={g.name}>
              <h3 className="font-medium">{g.name}</h3>
              <p className="text-sm text-muted-foreground">
                {c.platform === 'META'
                  ? (() => {
                      const tg = g.targeting as MetaTargeting;
                      return `${tg.locations.map((l) => l.name).join(', ')} · ages ${tg.ageMin}–${tg.ageMax}${tg.interests.length ? ` · ${tg.interests.map((i) => i.name).join(', ')}` : ''}`;
                    })()
                  : (() => {
                      const tg = g.targeting as GoogleTargeting;
                      return `${tg.locations.map((l) => l.name).join(', ')} · ${tg.keywords.length} keyword${tg.keywords.length === 1 ? '' : 's'}`;
                    })()}
              </p>
              <ul className="grid gap-3 md:grid-cols-2">
                {g.ads.map((a) => (
                  <li key={a.id} className="flex gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                    {a.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.imageUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{a.name}</p>
                      <p className="line-clamp-2 text-muted-foreground">{'primaryText' in a.creative ? (a.creative as MetaCreative).primaryText : (a.creative as GoogleRsa).headlines.join(' | ')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>

      {c.approvals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" aria-hidden="true" /> Spend approvals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {c.approvals.map((p) => (
                <li key={p.id}>
                  <span className="font-medium">{p.by}</span> {p.action === 'ACTIVATE' ? 'activated it' : 'raised the budget'} with a maximum of {money(p.maxSpend, p.currency)} · {formatInZone(p.at, tz)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ActivateDialog open={dialog === 'activate'} campaign={c} now={now} onClose={() => setDialog(null)} onDone={done} />
      <BudgetDialog open={dialog === 'budget'} campaign={c} canApprove={canApprove} now={now} onClose={() => setDialog(null)} onDone={done} />
      <Dialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Delete campaign?" description={c.externalId ? 'It is removed from ZatGo only; the paused campaign stays in your ad account.' : 'This deletes the draft.'}>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => act.mutate(() => api.ads.campaigns.remove(c.id), { onSuccess: () => router.push('/ads/campaigns') })}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The spend decision: shows the maximum, the cap, and requires typing the campaign name. */
function ActivateDialog({ open, campaign: c, now, onClose, onDone }: { open: boolean; campaign: AdCampaignDto; now: number; onClose: () => void; onDone: (d: AdCampaignDto) => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const max = maxSpend({ budgetType: c.budgetType, budgetAmount: c.budgetAmount, startAt: c.startAt, endAt: c.endAt }, new Date(now));
  const activate = useMutation({
    mutationFn: () => api.ads.campaigns.activate(c.id, max.amount),
    onSuccess: async (dto) => {
      await onDone(dto);
      toast.success(`${c.name} is active`);
      setTyped('');
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setTyped('');
          onClose();
        }
      }}
    >
      <DialogContent title="Start spending?" description={`Activating turns the campaign on in ${c.platform === 'META' ? 'Meta Ads Manager' : 'Google Ads'}. Charges go to the ad account's payment method.`}>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
            <p className="text-sm">This can spend up to</p>
            <p className="text-2xl font-semibold">{money(max.amount, c.currency)}</p>
            <p className="text-xs text-muted-foreground">
              {c.budgetType === 'LIFETIME' ? 'Lifetime budget' : `${money(c.budgetAmount, c.currency)} per day × ${max.days} days${max.untilMonthEnd ? ' (to the end of this month; it keeps running until paused)' : ''}`}
            </p>
            {c.adAccount.monthlySpendCap && <p className="mt-1 text-xs text-muted-foreground">Checked against the {money(c.adAccount.monthlySpendCap, c.currency)} monthly cap for {c.adAccount.name}.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-name">
              Type <span className="font-semibold">{c.name}</span> to confirm
            </Label>
            <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={typed.trim() !== c.name.trim() || activate.isPending} onClick={() => activate.mutate()}>
              Activate and allow up to {money(max.amount, c.currency)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BudgetDialog({ open, campaign: c, canApprove, now, onClose, onDone }: { open: boolean; campaign: AdCampaignDto; canApprove: boolean; now: number; onClose: () => void; onDone: (d: AdCampaignDto) => Promise<void> }) {
  const [value, setValue] = useState(c.budgetAmount);
  const valid = /^\d{1,12}(\.\d{1,2})?$/.test(value.trim());
  const increase = valid && toCents(value.trim()) > toCents(c.budgetAmount);
  const needsApproval = increase && c.status === 'ACTIVE';
  const max = valid ? maxSpend({ budgetType: c.budgetType, budgetAmount: value.trim(), startAt: c.startAt, endAt: c.endAt }, new Date(now)) : null;
  const save = useMutation({
    mutationFn: () => api.ads.campaigns.budget(c.id, { budgetAmount: value.trim(), ...(needsApproval ? { confirm: true as const, maxSpend: max!.amount } : {}) }),
    onSuccess: async (dto) => {
      await onDone(dto);
      toast.success('Budget updated');
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Change budget" description={`${c.budgetType === 'DAILY' ? 'Daily' : 'Lifetime'} budget in ${c.currency}.`}>
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-budget">New budget</Label>
            <Input id="new-budget" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {max && <p className="text-sm">New maximum: <strong>{money(max.amount, c.currency)}</strong></p>}
          {needsApproval && !canApprove && <p className="text-sm text-destructive-text">Raising the budget of a running campaign needs an Owner or Admin. You can lower it or pause the campaign.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!valid || (needsApproval && !canApprove) || save.isPending} onClick={() => save.mutate()}>
              {needsApproval ? `Approve up to ${money(max!.amount, c.currency)}` : 'Save budget'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
