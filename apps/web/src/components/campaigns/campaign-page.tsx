'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Copy, ExternalLink, Link2, Pause, Pencil, Play, Plus, QrCode, Rocket, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, EmptyState, ErrorState, Input, Label, Meter, Select, Skeleton, Tabs } from '@zatma/ui';
import {
  CAMPAIGN_CHANNEL_INFO,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_TYPE_INFO,
  formatMoney,
  MARKETING_OBJECTIVE_LABELS,
  POST_STATUS_LABELS,
  toCents,
  type CampaignChannel,
  type CampaignStatus,
  type MarketingCampaignDto,
  type PostStatus,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { LEAD_STATUS_LABELS, SOURCE_LABELS } from '@/lib/crm';
import { formatInZone, POST_TONE } from '@/lib/publishing';
import { useNow } from '@/lib/use-now';
import { AdPlatformMark, CampaignStatusBadge } from '@/components/ads/shared';
import { CampaignCalendar } from './campaign-calendar';
import { CampaignAnalytics } from './campaign-analytics';
import { ChannelChip, errorText, formatRange, MarketingStatusBadge, moneyList } from './shared';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'assets', label: 'Assets' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'leads', label: 'Leads' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'tasks', label: 'Tasks' },
];

type StopDialog = { kind: 'pause' | 'cancel' } | null;

export function MarketingCampaignPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const q = useQuery({ queryKey: ['campaigns', 'one', id], queryFn: () => api.campaigns.get(id) });
  const [tab, setTab] = useState('overview');
  const [stop, setStop] = useState<StopDialog>(null);
  const [resumed, setResumed] = useState<{ id: string; name: string; platform: string }[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const perms = org.data?.permissions ?? [];
  const canWrite = perms.includes('campaign:write');

  const refresh = async (dto?: MarketingCampaignDto) => {
    if (dto) qc.setQueryData(['campaigns', 'one', id], dto);
    await qc.invalidateQueries({ queryKey: ['campaigns'] });
  };
  const ready = useMutation({
    mutationFn: (value: boolean) => api.campaigns.ready(id, value),
    onSuccess: async (dto) => {
      await refresh(dto);
      toast.success(dto.readyAt ? `Marked ready: ${dto.status === 'ACTIVE' ? 'running now' : 'scheduled'}` : 'Back to draft');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const resume = useMutation({
    mutationFn: () => api.campaigns.resume(id),
    onSuccess: async (r) => {
      await refresh(r.campaign);
      setResumed(r.pausedAds);
      toast.success('Campaign resumed');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.campaigns.remove(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign deleted');
      router.push('/marketing/campaigns');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description="Couldn't load this campaign." onRetry={() => void q.refetch()} />;
  const c = q.data;
  const tz = c.timezone;
  const cancelled = c.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{c.name}</h2>
              <MarketingStatusBadge status={c.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {c.code} · {CAMPAIGN_TYPE_INFO[c.type].label} · {MARKETING_OBJECTIVE_LABELS[c.objective]} · {formatRange(c.startAt, c.endAt, tz)}
              {c.owner ? ` · Owner ${c.owner.name}` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {c.channels.map((ch) => (
                <ChannelChip key={ch} channel={ch} />
              ))}
            </div>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {c.status === 'DRAFT' && (
                <Button disabled={ready.isPending || c.readinessIssues.length > 0} onClick={() => ready.mutate(true)} title={c.readinessIssues.join('. ') || undefined}>
                  <Rocket aria-hidden="true" /> Mark ready
                </Button>
              )}
              {(c.status === 'SCHEDULED' || c.status === 'ACTIVE') && (
                <>
                  <Button variant="outline" onClick={() => setStop({ kind: 'pause' })}>
                    <Pause aria-hidden="true" /> Pause
                  </Button>
                  {c.status === 'SCHEDULED' && (
                    <Button variant="ghost" disabled={ready.isPending} onClick={() => ready.mutate(false)}>
                      <Undo2 aria-hidden="true" /> Back to draft
                    </Button>
                  )}
                </>
              )}
              {c.status === 'PAUSED' && (
                <Button disabled={resume.isPending} onClick={() => resume.mutate()}>
                  <Play aria-hidden="true" /> Resume
                </Button>
              )}
              {!cancelled && (
                <>
                  <Link href={`/marketing/campaigns/${c.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
                    <Pencil aria-hidden="true" /> Edit
                  </Link>
                  {c.status !== 'COMPLETED' && (
                    <Button variant="ghost" onClick={() => setStop({ kind: 'cancel' })}>
                      <Ban aria-hidden="true" /> Cancel campaign
                    </Button>
                  )}
                </>
              )}
              <Button variant="ghost" size="icon" aria-label="Delete campaign" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          )}
        </CardContent>
        {c.status === 'DRAFT' && c.readinessIssues.length > 0 && (
          <div className="border-t border-border px-5 py-3 text-sm text-muted-foreground">To mark it ready: {c.readinessIssues.join(' · ')}.</div>
        )}
      </Card>

      {resumed && resumed.length > 0 && (
        <Alert tone="info">
          <p className="font-medium">Paid ads stay paused.</p>
          <p className="text-sm">Resuming the campaign doesn&apos;t start spending. Review each ad campaign and activate it with the spend confirmation if you want it to run:</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {resumed.map((a) => (
              <li key={a.id}>
                <Link href={`/ads/campaigns/${a.id}`} className="underline">
                  Review &amp; activate {a.name}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="overflow-x-auto">
        <Tabs label="Campaign sections" items={TABS} value={tab} onChange={setTab} withPanels />
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Overview campaign={c} />}
        {tab === 'content' && <ContentTab campaign={c} canWrite={canWrite && !cancelled} />}
        {tab === 'assets' && <AssetsTab campaign={c} canWrite={canWrite && !cancelled} />}
        {tab === 'tracking' && <TrackingTab campaign={c} canWrite={canWrite && !cancelled} />}
        {tab === 'leads' && <LeadsTab campaign={c} canAttach={canWrite && perms.includes('crm:write')} canRead={perms.includes('crm:read')} />}
        {tab === 'analytics' && <CampaignAnalytics campaign={c} />}
        {tab === 'calendar' && <CampaignCalendar campaignId={c.id} timezone={tz} initial={c.startAt} />}
        {tab === 'tasks' && <TasksTab campaign={c} canWrite={canWrite} />}
      </div>

      <StopCampaignDialog key={stop?.kind ?? 'none'} campaign={c} kind={stop?.kind ?? null} onClose={() => setStop(null)} onDone={refresh} />
      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent title="Delete campaign?" description="Posts, ads, designs and leads stay; they are only unlinked from the campaign. Tracked links stop working.">
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────── Pause / cancel ─────────────

function StopCampaignDialog({ campaign: c, kind, onClose, onDone }: { campaign: MarketingCampaignDto; kind: 'pause' | 'cancel' | null; onClose: () => void; onDone: (dto: MarketingCampaignDto) => Promise<void> }) {
  const content = useQuery({ queryKey: ['campaigns', 'content', c.id], queryFn: () => api.campaigns.content(c.id), enabled: kind !== null });
  const [pauseAds, setPauseAds] = useState(true);
  const [unschedule, setUnschedule] = useState(true);
  const activeAds = content.data?.adCampaigns.filter((a) => a.status === 'ACTIVE') ?? [];
  const scheduled = content.data?.posts.filter((p) => p.status === 'SCHEDULED') ?? [];
  const run = useMutation({
    mutationFn: () => (kind === 'cancel' ? api.campaigns.cancel : api.campaigns.pause)(c.id, { pauseAds: pauseAds && activeAds.length > 0, unschedulePosts: unschedule && scheduled.length > 0 }),
    onSuccess: async (r) => {
      await onDone(r.campaign);
      const failed = [...r.ads, ...r.posts].filter((x) => !x.ok);
      if (failed.length) toast.warning(`${kind === 'cancel' ? 'Cancelled' : 'Paused'}, but ${failed.length} item${failed.length === 1 ? '' : 's'} couldn't be changed: ${failed.map((x) => x.error).join('; ')}`);
      else toast.success(`Campaign ${kind === 'cancel' ? 'cancelled' : 'paused'}${r.ads.length ? ` · ${r.ads.length} ad campaign${r.ads.length === 1 ? '' : 's'} paused` : ''}${r.posts.length ? ` · ${r.posts.length} post${r.posts.length === 1 ? '' : 's'} unscheduled` : ''}`);
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={kind === 'cancel' ? 'Cancel this campaign?' : 'Pause this campaign?'}
        description={kind === 'cancel' ? 'A cancelled campaign is kept for reporting but cannot be resumed or edited.' : 'You can resume it later. Resuming never restarts paid ads by itself.'}
      >
        <div className="mt-4 space-y-3">
          {content.isPending ? (
            <Skeleton className="h-16" />
          ) : (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={pauseAds && activeAds.length > 0} disabled={activeAds.length === 0} onChange={(e) => setPauseAds(e.target.checked)} />
                <span>
                  Pause {activeAds.length} running ad campaign{activeAds.length === 1 ? '' : 's'} (stops spending)
                  {activeAds.length > 0 && <span className="block text-xs text-muted-foreground">{activeAds.map((a) => a.name).join(', ')}</span>}
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={unschedule && scheduled.length > 0} disabled={scheduled.length === 0} onChange={(e) => setUnschedule(e.target.checked)} />
                <span>Return {scheduled.length} scheduled post{scheduled.length === 1 ? '' : 's'} to drafts</span>
              </label>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Keep running
            </Button>
            <Button variant={kind === 'cancel' ? 'destructive' : 'primary'} disabled={run.isPending || content.isPending} onClick={() => run.mutate()}>
              {kind === 'cancel' ? 'Cancel campaign' : 'Pause campaign'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Overview ─────────────

function Overview({ campaign: c }: { campaign: MarketingCampaignDto }) {
  const sameCurrencySpend = c.spend.find((s) => s.currency === c.currency);
  const budgetCents = c.budgetAmount ? toCents(c.budgetAmount) : 0n;
  const spentCents = sameCurrencySpend ? toCents(sameCurrencySpend.amount) : 0n;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Channels</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {c.channelPlans.length === 0 && <p className="text-sm text-muted-foreground">No channels chosen yet.</p>}
          {c.channelPlans.map((p) => {
            const info = CAMPAIGN_CHANNEL_INFO[p.channel];
            return (
              <section key={p.channel} className="space-y-1 rounded-xl border border-border p-4" aria-label={info.label}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{info.label}</h3>
                  {!info.available && <Badge tone="neutral">{info.note}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{p.plannedBudget ? `Planned ${formatMoney(p.plannedBudget, c.currency)}` : 'No budget planned'}</p>
                {p.content.length > 0 && <p className="text-sm">{p.content.length} planned item{p.content.length === 1 ? '' : 's'}</p>}
                {p.notes && <p className="text-sm text-muted-foreground">{p.notes}</p>}
              </section>
            );
          })}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Budget</CardTitle>
            <CardDescription>Spend comes from linked ad campaigns, per currency.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Planned <span className="font-semibold">{c.budgetAmount ? formatMoney(c.budgetAmount, c.currency) : 'not set'}</span>
            </p>
            <p>
              Spent so far <span className="font-semibold">{moneyList(c.spend, formatMoney('0', c.currency))}</span>
            </p>
            {budgetCents > 0n && <Meter label="Budget used" used={Number(spentCents / 100n)} limit={Number(budgetCents / 100n)} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">At a glance</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ['Posts', c.counts.posts],
                  ['Ad campaigns', c.counts.adCampaigns],
                  ['Tracked links', c.counts.links],
                  ['Leads', c.counts.leads],
                  ['Assets', c.counts.assets],
                  ['Tasks', c.counts.tasks],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-lg font-semibold">{v.toLocaleString('en-IN')}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Audience</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{c.audience.description || <span className="text-muted-foreground">No audience description.</span>}</p>
          {(c.audience.locations.length > 0 || c.audience.interests.length > 0 || c.audience.ageMin !== null) && (
            <p className="text-muted-foreground">
              {[c.audience.locations.join(', '), c.audience.ageMin !== null || c.audience.ageMax !== null ? `Ages ${c.audience.ageMin ?? 13}–${c.audience.ageMax ?? 65}` : '', c.audience.interests.join(', ')].filter(Boolean).join(' · ')}
            </p>
          )}
          {c.audience.segment && <AudienceSegmentSummary campaign={c} />}
          <p className="text-xs text-muted-foreground">UTM campaign: {c.utmCampaign}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function AudienceSegmentSummary({ campaign: c }: { campaign: MarketingCampaignDto }) {
  const seg = c.audience.segment!;
  const count = useQuery({ queryKey: ['campaigns', 'audience', c.id, seg], queryFn: () => api.campaigns.audiencePreview(seg), retry: false });
  const parts = [
    seg.kind === 'customers' ? 'Customers' : 'Leads',
    seg.statuses.length ? seg.statuses.map((s) => LEAD_STATUS_LABELS[s]).join('/') : '',
    seg.sources.length ? `from ${seg.sources.map((s) => SOURCE_LABELS[s]).join(', ')}` : '',
    seg.cities.length ? `in ${seg.cities.join(', ')}` : '',
    seg.tags.length ? `tagged ${seg.tags.join(', ')}` : '',
    seg.minScore !== null ? `score ≥ ${seg.minScore}` : '',
  ].filter(Boolean);
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="font-medium">CRM segment: {parts.join(' · ')}</p>
      {count.data ? (
        <p className="text-muted-foreground">
          {count.data.total.toLocaleString('en-IN')} records · {count.data.withEmail.toLocaleString('en-IN')} with email · {count.data.withPhone.toLocaleString('en-IN')} with a phone. Email and WhatsApp sending arrives in Phase 14.
        </p>
      ) : count.isError ? (
        <p className="text-muted-foreground">You need CRM access to count this segment.</p>
      ) : (
        <Skeleton className="h-4 w-48" />
      )}
    </div>
  );
}

// ───────────── Content ─────────────

function ContentTab({ campaign: c, canWrite }: { campaign: MarketingCampaignDto; canWrite: boolean }) {
  const qc = useQueryClient();
  const content = useQuery({ queryKey: ['campaigns', 'content', c.id], queryFn: () => api.campaigns.content(c.id) });
  const [picking, setPicking] = useState<'post' | 'ad_campaign' | null>(null);
  const detach = useMutation({
    mutationFn: (x: { kind: 'post' | 'ad_campaign'; id: string }) => api.campaigns.attach(c.id, { kind: x.kind, ids: [x.id], detach: true }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Removed from the campaign');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const tz = c.timezone;
  if (content.isPending) return <Skeleton className="h-48" />;
  if (content.isError) return <ErrorState description="Couldn't load the campaign content." onRetry={() => void content.refetch()} />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Social posts</CardTitle>
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPicking('post')}>
                <Link2 aria-hidden="true" /> Add existing
              </Button>
              <Link href={`/marketing/social/new?campaign=${c.id}`} className={buttonVariants({ size: 'sm' })}>
                <Plus aria-hidden="true" /> New post
              </Link>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {content.data.posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts in this campaign yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {content.data.posts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/marketing/social/${p.id}`} className="line-clamp-1 font-medium hover:underline">
                      {p.caption || 'Untitled post'}
                    </Link>
                    <span className="text-xs text-muted-foreground">{p.scheduledAt ? `Scheduled ${formatInZone(p.scheduledAt, tz)}` : p.publishedAt ? `Published ${formatInZone(p.publishedAt, tz)}` : 'Not scheduled'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={POST_TONE[p.status as PostStatus] ?? 'neutral'}>{POST_STATUS_LABELS[p.status as PostStatus] ?? p.status}</Badge>
                    {canWrite && (
                      <Button variant="ghost" size="icon" aria-label={`Remove post from campaign`} onClick={() => detach.mutate({ kind: 'post', id: p.id })}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Ad campaigns</CardTitle>
            <CardDescription>Ads are created paused. An Owner or Admin activates each one with a spend confirmation on its own page.</CardDescription>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPicking('ad_campaign')}>
                <Link2 aria-hidden="true" /> Add existing
              </Button>
              <Link href={`/ads/campaigns/new?campaign=${c.id}`} className={buttonVariants({ size: 'sm' })}>
                <Plus aria-hidden="true" /> New ad campaign
              </Link>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {content.data.adCampaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ad campaigns linked.</p>
          ) : (
            <ul className="divide-y divide-border">
              {content.data.adCampaigns.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/ads/campaigns/${a.id}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                    <AdPlatformMark platform={a.platform as 'META' | 'GOOGLE'} className="size-6 text-[10px]" />
                    {a.name}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      {formatMoney(a.budgetAmount, a.currency)}
                      {a.budgetType === 'DAILY' ? '/day' : ' total'} · spent {formatMoney(a.spend, a.currency)}
                    </span>
                    <CampaignStatusBadge status={a.status as CampaignStatus} />
                    {canWrite && (
                      <Button variant="ghost" size="icon" aria-label={`Remove ${a.name} from campaign`} onClick={() => detach.mutate({ kind: 'ad_campaign', id: a.id })}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <AttachDialog campaign={c} kind={picking} onClose={() => setPicking(null)} />
    </div>
  );
}

function AttachDialog({ campaign: c, kind, onClose }: { campaign: MarketingCampaignDto; kind: 'post' | 'ad_campaign' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const posts = useQuery({ queryKey: ['social', 'posts', 'for-campaign', c.workspaceId], queryFn: () => api.social.posts.list({ workspaceId: c.workspaceId, pageSize: 50 }), enabled: kind === 'post' });
  const ads = useQuery({ queryKey: ['ads', 'campaigns', 'for-campaign'], queryFn: () => api.ads.campaigns.list({ pageSize: 50 }), enabled: kind === 'ad_campaign' });
  const options =
    kind === 'post'
      ? (posts.data?.data ?? []).filter((p) => p.campaignId !== c.id).map((p) => ({ id: p.id, label: p.caption.slice(0, 80) || 'Untitled post', hint: POST_STATUS_LABELS[p.status], taken: !!p.campaignId }))
      : (ads.data?.data ?? []).filter((a) => a.workspaceId === c.workspaceId && a.marketingCampaignId !== c.id).map((a) => ({ id: a.id, label: a.name, hint: CAMPAIGN_STATUS_LABELS[a.status], taken: !!a.marketingCampaignId }));
  const attach = useMutation({
    mutationFn: () => api.campaigns.attach(c.id, { kind: kind!, ids: selected }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`Added ${r.updated}`);
      setSelected([]);
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const loading = kind === 'post' ? posts.isPending : ads.isPending;
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={kind === 'post' ? 'Add posts' : 'Add ad campaigns'} description="Items from this campaign's workspace. Adding one that belongs to another campaign moves it here.">
        <div className="mt-4 max-h-80 space-y-1 overflow-y-auto">
          {loading ? (
            <Skeleton className="h-24" />
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to add.</p>
          ) : (
            options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-muted">
                <input type="checkbox" className="accent-primary" checked={selected.includes(o.id)} onChange={() => setSelected((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]))} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className="text-xs text-muted-foreground">
                  {o.hint}
                  {o.taken ? ' · in another campaign' : ''}
                </span>
              </label>
            ))
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!selected.length || attach.isPending} onClick={() => attach.mutate()}>
            Add {selected.length || ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Assets ─────────────

function AssetsTab({ campaign: c, canWrite }: { campaign: MarketingCampaignDto; canWrite: boolean }) {
  const qc = useQueryClient();
  const assets = useQuery({ queryKey: ['campaigns', 'assets', c.id], queryFn: () => api.campaigns.assets.list(c.id) });
  const [adding, setAdding] = useState<'design' | 'copy' | null>(null);
  const remove = useMutation({
    mutationFn: (assetId: string) => api.campaigns.assets.remove(c.id, assetId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Assets</CardTitle>
          <CardDescription>Designs and copy collected for this campaign.</CardDescription>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAdding('design')}>
              <Plus aria-hidden="true" /> Design
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAdding('copy')}>
              <Plus aria-hidden="true" /> Copy
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {assets.isPending ? (
          <Skeleton className="h-32" />
        ) : assets.isError ? (
          <ErrorState description="Couldn't load assets." onRetry={() => void assets.refetch()} />
        ) : assets.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assets yet. Add designs from the Design Studio or saved copy.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assets.data.map((a) => (
              <li key={a.id} className="flex gap-3 rounded-xl border border-border p-3 text-sm">
                {a.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.previewUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-lg bg-muted text-xs text-muted-foreground">
                    {a.kind === 'copy' ? 'Copy' : a.kind === 'design' ? 'Design' : 'File'}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {a.kind === 'design' ? (
                    <Link href={`/studio/design/${a.refId}`} className="line-clamp-2 font-medium hover:underline">
                      {a.name}
                    </Link>
                  ) : (
                    <p className="line-clamp-3">{a.name}</p>
                  )}
                  {a.label && <p className="text-xs text-muted-foreground">{a.label}</p>}
                </div>
                {canWrite && (
                  <Button variant="ghost" size="icon" aria-label={`Remove ${a.name} from campaign`} onClick={() => remove.mutate(a.id)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AddAssetDialog campaign={c} kind={adding} onClose={() => setAdding(null)} />
    </Card>
  );
}

function AddAssetDialog({ campaign: c, kind, onClose }: { campaign: MarketingCampaignDto; kind: 'design' | 'copy' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const designs = useQuery({ queryKey: ['designs', 'for-campaign'], queryFn: () => api.designs.list({ pageSize: 48 }), enabled: kind === 'design' });
  const copies = useQuery({ queryKey: ['copy-assets', 'for-campaign'], queryFn: () => api.copyAssets.list({ pageSize: 50 }), enabled: kind === 'copy' });
  const add = useMutation({
    mutationFn: (refId: string) => api.campaigns.assets.add(c.id, kind === 'design' ? { designId: refId } : { copyAssetId: refId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Added to the campaign');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const items =
    kind === 'design'
      ? (designs.data?.data ?? []).filter((d) => d.workspaceId === c.workspaceId).map((d) => ({ id: d.id, label: d.title, image: d.thumbnailUrl }))
      : (copies.data?.data ?? []).filter((x) => x.workspaceId === c.workspaceId).map((x) => ({ id: x.id, label: x.content.slice(0, 120), image: null as string | null }));
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={kind === 'design' ? 'Add a design' : 'Add copy'} description="From this campaign's workspace.">
        <ul className="mt-4 max-h-80 space-y-1 overflow-y-auto">
          {(kind === 'design' ? designs.isPending : copies.isPending) ? (
            <Skeleton className="h-24" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing saved yet.</p>
          ) : (
            items.map((i) => (
              <li key={i.id}>
                <button type="button" className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm hover:bg-muted" onClick={() => add.mutate(i.id)}>
                  {i.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.image} alt="" className="size-10 rounded object-cover" />
                  )}
                  <span className="line-clamp-2">{i.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Tracking ─────────────

function TrackingTab({ campaign: c, canWrite }: { campaign: MarketingCampaignDto; canWrite: boolean }) {
  const qc = useQueryClient();
  const links = useQuery({ queryKey: ['campaigns', 'links', c.id], queryFn: () => api.campaigns.links.list(c.id) });
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [channel, setChannel] = useState<CampaignChannel>(c.channels[0] ?? 'other');
  const [qr, setQr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.campaigns.links.create(c.id, { destinationUrl: url.trim(), label, channel }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      setUrl('');
      setLabel('');
      toast.success('Tracked link created');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (linkId: string) => api.campaigns.links.remove(c.id, linkId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Link removed; it no longer redirects');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };
  const urlOk = (() => {
    try {
      return ['http:', 'https:'].includes(new URL(url.trim()).protocol);
    } catch {
      return false;
    }
  })();
  return (
    <div className="space-y-4">
      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New tracked link</CardTitle>
            <CardDescription>
              A short link adds utm_campaign={c.utmCampaign} and counts clicks. No personal data about visitors is stored.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-[1fr_12rem_12rem_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (urlOk) create.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="link-url">Destination URL</Label>
                <Input id="link-url" type="url" placeholder="https://yourshop.in/onam" value={url} onChange={(e) => setUrl(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-channel">Used on</Label>
                <Select id="link-channel" value={channel} onChange={(e) => setChannel(e.target.value as CampaignChannel)}>
                  {CAMPAIGN_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {CAMPAIGN_CHANNEL_INFO[ch].label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link-label">Label (optional)</Label>
                <Input id="link-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
              </div>
              <Button type="submit" disabled={!urlOk || create.isPending}>
                <Link2 aria-hidden="true" /> Create
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Links</CardTitle>
        </CardHeader>
        <CardContent>
          {links.isPending ? (
            <Skeleton className="h-24" />
          ) : links.isError ? (
            <ErrorState description="Couldn't load links." onRetry={() => void links.refetch()} />
          ) : links.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tracked links yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">Tracked links</caption>
                <thead className="border-b border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Link</th>
                    <th className="p-2 font-medium">Channel</th>
                    <th className="p-2 text-right font-medium">Clicks</th>
                    <th className="p-2 text-right font-medium">Unique</th>
                    <th className="p-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {links.data.map((l) => (
                    <tr key={l.id}>
                      <td className="max-w-xs p-2">
                        <p className="font-medium">{l.label || l.shortUrl.replace(/^https?:\/\//, '')}</p>
                        <p className="truncate text-xs text-muted-foreground" title={l.trackedUrl}>
                          → {l.destinationUrl}
                        </p>
                      </td>
                      <td className="p-2">{CAMPAIGN_CHANNEL_INFO[l.channel].label}</td>
                      <td className="p-2 text-right tabular-nums">{l.clicks.toLocaleString('en-IN')}</td>
                      <td className="p-2 text-right tabular-nums">{l.uniqueClicks.toLocaleString('en-IN')}</td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" aria-label={`Copy short link ${l.slug}`} onClick={() => void copy(l.shortUrl)}>
                            <Copy aria-hidden="true" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`QR code for ${l.slug}`} onClick={() => setQr(l.shortUrl)}>
                            <QrCode aria-hidden="true" />
                          </Button>
                          <a href={l.trackedUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label={`Open destination for ${l.slug} (does not count a click)`}>
                            <ExternalLink aria-hidden="true" />
                          </a>
                          {canWrite && (
                            <Button variant="ghost" size="icon" aria-label={`Delete link ${l.slug}`} onClick={() => remove.mutate(l.id)}>
                              <Trash2 aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <QrDialog url={qr} onClose={() => setQr(null)} />
    </div>
  );
}

function QrDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const svg = useQuery({ queryKey: ['qr', url], queryFn: async () => (await import('qrcode')).toString(url!, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }), enabled: !!url, staleTime: Infinity });
  return (
    <Dialog open={!!url} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="QR code" description={url ?? ''}>
        <div className="mt-4 grid place-items-center">
          {svg.data ? (
            <div className="w-56 rounded-xl bg-white p-3" role="img" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg.data }} />
          ) : (
            <Skeleton className="size-56" />
          )}
          {svg.data && (
            <a className={`${buttonVariants({ variant: 'outline' })} mt-4`} download="campaign-qr.svg" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.data)}`}>
              Download SVG
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Leads ─────────────

function LeadsTab({ campaign: c, canAttach, canRead }: { campaign: MarketingCampaignDto; canAttach: boolean; canRead: boolean }) {
  const [page, setPage] = useState(1);
  const leads = useQuery({ queryKey: ['campaigns', 'leads', c.id, page], queryFn: () => api.campaigns.leads(c.id, { page, pageSize: 25 }), enabled: canRead });
  if (!canRead) return <EmptyState title="CRM access needed" description="Ask an admin for CRM access to see the leads from this campaign." />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leads from this campaign</CardTitle>
        <CardDescription>
          Leads are attributed when they arrive with utm_campaign={c.utmCampaign}, come from a linked Meta lead form, or are added here{canAttach ? '' : ' by someone with CRM access'}. The first campaign a lead came from is kept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {leads.isPending ? (
          <Skeleton className="h-32" />
        ) : leads.isError ? (
          <ErrorState description="Couldn't load leads." onRetry={() => void leads.refetch()} />
        ) : leads.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leads attributed yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Leads</caption>
                <thead className="border-b border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Name</th>
                    <th className="p-2 font-medium">Source</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium">Score</th>
                    <th className="p-2 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leads.data.data.map((l) => (
                    <tr key={l.id}>
                      <td className="p-2">
                        <Link href={`/crm/leads/${l.id}`} className="font-medium hover:underline">
                          {l.name}
                        </Link>
                        {l.utm?.source && <span className="block text-xs text-muted-foreground">utm_source={l.utm.source}</span>}
                      </td>
                      <td className="p-2">{SOURCE_LABELS[l.source]}</td>
                      <td className="p-2">{LEAD_STATUS_LABELS[l.status]}</td>
                      <td className="p-2">{l.score ?? '–'}</td>
                      <td className="p-2">{formatInZone(l.createdAt, c.timezone, { dateStyle: 'medium' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leads.data.meta.totalPages > 1 && (
              <div className="mt-3 flex items-center justify-end gap-2 text-sm">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page} of {leads.data.meta.totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= leads.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────── Tasks ─────────────

function TasksTab({ campaign: c, canWrite }: { campaign: MarketingCampaignDto; canWrite: boolean }) {
  const qc = useQueryClient();
  const now = useNow(60_000);
  const tasks = useQuery({ queryKey: ['campaigns', 'tasks', c.id], queryFn: () => api.campaigns.tasks.list(c.id) });
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['campaigns'] });
  const add = useMutation({
    mutationFn: () => api.campaigns.tasks.add(c.id, { title: title.trim(), dueAt: due ? new Date(`${due}T09:00:00`).toISOString() : null }),
    onSuccess: async () => {
      await invalidate();
      setTitle('');
      setDue('');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const toggle = useMutation({ mutationFn: (t: { id: string; done: boolean }) => api.campaigns.tasks.update(c.id, t.id, { done: t.done }), onSuccess: invalidate, onError: (e) => toast.error(errorText(e)) });
  const remove = useMutation({ mutationFn: (taskId: string) => api.campaigns.tasks.remove(c.id, taskId), onSuccess: invalidate, onError: (e) => toast.error(errorText(e)) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tasks and milestones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="task-title">Task</Label>
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due</Label>
              <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <Button type="submit" disabled={!title.trim() || add.isPending}>
              <Plus aria-hidden="true" /> Add
            </Button>
          </form>
        )}
        {tasks.isPending ? (
          <Skeleton className="h-24" />
        ) : tasks.isError ? (
          <ErrorState description="Couldn't load tasks." onRetry={() => void tasks.refetch()} />
        ) : tasks.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.data.map((t) => {
              const overdue = !t.done && t.dueAt && new Date(t.dueAt).getTime() < now;
              return (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" className="accent-primary" aria-label={`${t.done ? 'Reopen' : 'Complete'} ${t.title}`} checked={t.done} disabled={!canWrite} onChange={(e) => toggle.mutate({ id: t.id, done: e.target.checked })} />
                  <span className={`flex-1 ${t.done ? 'text-muted-foreground line-through' : ''}`}>{t.title}</span>
                  {t.dueAt && (
                    <span className={overdue ? 'font-medium text-destructive-text' : 'text-muted-foreground'}>
                      {overdue ? 'Overdue · ' : ''}
                      {formatInZone(t.dueAt, c.timezone, { dateStyle: 'medium' })}
                    </span>
                  )}
                  {t.done && <Check className="size-4 text-success" aria-hidden="true" />}
                  {canWrite && (
                    <Button variant="ghost" size="icon" aria-label={`Delete task ${t.title}`} onClick={() => remove.mutate(t.id)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
