'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from '@zatma/ui';
import {
  amountSchema,
  CAMPAIGN_CHANNEL_INFO,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_TYPE_INFO,
  CURRENCIES,
  formatMoney,
  fromCents,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MARKETING_CAMPAIGN_TYPES,
  MARKETING_OBJECTIVE_LABELS,
  MARKETING_OBJECTIVES,
  slugifyUtm,
  toCents,
  type AudienceSegment,
  type CampaignAudience,
  type CampaignChannel,
  type ChannelPlanInput,
  type ContentPlanItem,
  type CreateMarketingCampaignRequest,
  type MarketingCampaignDto,
  type MarketingCampaignType,
  type MarketingObjective,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { LEAD_STATUS_LABELS, SOURCE_LABELS } from '@/lib/crm';
import { dateOfEnd, dateOfStart, endFromDate, errorText, startFromDate } from './shared';

interface FormState {
  workspaceId: string;
  name: string;
  type: MarketingCampaignType;
  objective: MarketingObjective;
  description: string;
  ownerId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  budgetAmount: string;
  currency: string;
  channels: CampaignChannel[];
  plans: Record<CampaignChannel, ChannelPlanInput>;
  audience: CampaignAudience;
  useSegment: boolean;
  utmCampaign: string;
  utmTouched: boolean;
}

const emptyPlan = (channel: CampaignChannel): ChannelPlanInput => ({ channel, plannedBudget: null, notes: '', content: [] });
const allPlans = (existing: ChannelPlanInput[] = []) => Object.fromEntries(CAMPAIGN_CHANNELS.map((c) => [c, existing.find((p) => p.channel === c) ?? emptyPlan(c)])) as Record<CampaignChannel, ChannelPlanInput>;
const EMPTY_SEGMENT: AudienceSegment = { kind: 'leads', statuses: [], sources: [], tags: [], cities: [], countries: [], minScore: null };
const EMPTY_AUDIENCE: CampaignAudience = { description: '', locations: [], ageMin: null, ageMax: null, interests: [], segment: null };
const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function initial(c: MarketingCampaignDto | undefined, defaults: { workspaceId: string; timezone: string; currency: string }): FormState {
  if (!c) {
    return {
      workspaceId: defaults.workspaceId,
      name: '',
      type: 'SOCIAL',
      objective: 'AWARENESS',
      description: '',
      ownerId: '',
      startDate: '',
      endDate: '',
      timezone: defaults.timezone,
      budgetAmount: '',
      currency: defaults.currency,
      channels: CAMPAIGN_TYPE_INFO.SOCIAL.channels,
      plans: allPlans(),
      audience: EMPTY_AUDIENCE,
      useSegment: false,
      utmCampaign: '',
      utmTouched: false,
    };
  }
  return {
    workspaceId: c.workspaceId,
    name: c.name,
    type: c.type,
    objective: c.objective,
    description: c.description,
    ownerId: c.owner?.id ?? '',
    startDate: dateOfStart(c.startAt, c.timezone),
    endDate: dateOfEnd(c.endAt, c.timezone),
    timezone: c.timezone,
    budgetAmount: c.budgetAmount ?? '',
    currency: c.currency,
    channels: c.channels,
    plans: allPlans(c.channelPlans),
    audience: c.audience,
    useSegment: !!c.audience.segment,
    utmCampaign: c.utmCampaign,
    utmTouched: true,
  };
}

export function CampaignForm({ campaign }: { campaign?: MarketingCampaignDto }) {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const workspaces = useQuery({ queryKey: ['workspaces', 'all'], queryFn: () => api.workspaces.list({ pageSize: 100 }) });
  if (!org.data || !workspaces.data) return <Card className="h-96 animate-pulse" aria-busy="true" />;
  const ws = workspaces.data.data.find((w) => w.isDefault) ?? workspaces.data.data[0];
  return <CampaignFormInner campaign={campaign} defaults={{ workspaceId: ws?.id ?? '', timezone: org.data.timezone ?? 'Asia/Kolkata', currency: org.data.currency ?? 'INR' }} workspaces={workspaces.data.data} canAi={org.data.permissions.includes('ai:generate')} canReadCrm={org.data.permissions.includes('crm:read')} />;
}

function CampaignFormInner({
  campaign,
  defaults,
  workspaces,
  canAi,
  canReadCrm,
}: {
  campaign?: MarketingCampaignDto;
  defaults: { workspaceId: string; timezone: string; currency: string };
  workspaces: Array<{ id: string; name: string }>;
  canAi: boolean;
  canReadCrm: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() => initial(campaign, defaults));
  const [aiTasks, setAiTasks] = useState<{ title: string; dueAt: string | null }[]>([]);
  const [brief, setBrief] = useState('');
  const [rationale, setRationale] = useState('');
  const [preview, setPreview] = useState<{ total: number; withEmail: number; withPhone: number } | null>(null);
  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: api.organizations.members });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const setPlan = (ch: CampaignChannel, patch: Partial<ChannelPlanInput>) => setF((s) => ({ ...s, plans: { ...s.plans, [ch]: { ...s.plans[ch], ...patch } } }));
  const setSegment = (patch: Partial<AudienceSegment>) => setF((s) => ({ ...s, audience: { ...s.audience, segment: { ...(s.audience.segment ?? EMPTY_SEGMENT), ...patch } } }));
  const segment = f.audience.segment ?? EMPTY_SEGMENT;

  const budgetValid = !f.budgetAmount || amountSchema.safeParse(f.budgetAmount).success;
  const planned = f.channels.reduce((n, ch) => n + (f.plans[ch].plannedBudget && amountSchema.safeParse(f.plans[ch].plannedBudget).success ? toCents(f.plans[ch].plannedBudget!) : 0n), 0n);
  const overBudget = !!f.budgetAmount && budgetValid && planned > toCents(f.budgetAmount);
  const datesBad = !!f.startDate && !!f.endDate && f.endDate < f.startDate;
  const utm = f.utmTouched ? f.utmCampaign : slugifyUtm(f.name || 'campaign');

  const body = (): CreateMarketingCampaignRequest => ({
    workspaceId: f.workspaceId,
    name: f.name.trim(),
    type: f.type,
    objective: f.objective,
    description: f.description,
    ownerId: f.ownerId || null,
    startAt: f.startDate ? startFromDate(f.startDate, f.timezone) : null,
    endAt: f.endDate ? endFromDate(f.endDate, f.timezone) : null,
    timezone: f.timezone,
    budgetAmount: f.budgetAmount || null,
    currency: f.currency,
    channels: f.channels,
    channelPlans: f.channels.map((ch) => ({ ...f.plans[ch], plannedBudget: f.plans[ch].plannedBudget || null })),
    audience: { ...f.audience, segment: f.useSegment ? segment : null },
    utmCampaign: utm,
  });

  const save = useMutation({
    mutationFn: async () => {
      const b = body();
      if (campaign) {
        return api.campaigns.update(campaign.id, { ...b, workspaceId: undefined } as Omit<typeof b, 'workspaceId'>);
      }
      const created = await api.campaigns.create(b);
      for (const t of aiTasks) await api.campaigns.tasks.add(created.id, t).catch(() => undefined);
      return created;
    },
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(campaign ? 'Campaign saved' : `${c.code} created`);
      router.push(`/marketing/campaigns/${c.id}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const plan = useMutation({
    mutationFn: () =>
      api.campaigns.aiPlan({
        brief,
        type: campaign ? undefined : f.type,
        totalBudget: f.budgetAmount && budgetValid ? f.budgetAmount : undefined,
        startAt: f.startDate ? startFromDate(f.startDate, f.timezone) : undefined,
        endAt: f.endDate ? endFromDate(f.endDate, f.timezone) : undefined,
      }),
    onSuccess: (r) => {
      const d = r.draft;
      setF((s) => ({
        ...s,
        name: d.name ?? s.name,
        type: d.type ?? s.type,
        objective: d.objective ?? s.objective,
        description: d.description ?? s.description,
        channels: d.channels ?? s.channels,
        plans: allPlans((d.channelPlans ?? []).map((p) => ({ channel: p.channel, plannedBudget: p.plannedBudget ?? null, notes: p.notes ?? '', content: (p.content ?? []).map((x) => ({ title: x.title, date: x.date ?? null, notes: x.notes ?? '' })) }))),
        audience: { ...EMPTY_AUDIENCE, ...(d.audience as Partial<CampaignAudience>), segment: s.audience.segment },
        utmCampaign: d.utmCampaign ?? s.utmCampaign,
        utmTouched: !!d.utmCampaign,
      }));
      setAiTasks(r.tasks);
      setRationale(r.rationale);
      toast.success('Plan drafted. Review every field before saving.');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const count = useMutation({
    mutationFn: () => api.campaigns.audiencePreview(segment),
    onSuccess: (r) => setPreview(r),
    onError: (e) => toast.error(errorText(e)),
  });

  const changeType = (t: MarketingCampaignType) => setF((s) => ({ ...s, type: t, channels: campaign ? s.channels : CAMPAIGN_TYPE_INFO[t].channels }));
  const toggleChannel = (ch: CampaignChannel) => setF((s) => ({ ...s, channels: s.channels.includes(ch) ? s.channels.filter((c) => c !== ch) : CAMPAIGN_CHANNELS.filter((c) => c === ch || s.channels.includes(c)) }));
  const toggleIn = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const canSave = f.name.trim().length >= 2 && budgetValid && !overBudget && !datesBad && !!f.workspaceId && (f.utmTouched ? /^[a-z0-9_-]+$/.test(f.utmCampaign) : true);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate();
      }}
    >
      {canAi && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" aria-hidden="true" /> Plan with AI
            </CardTitle>
            <CardDescription>Describe the goal. AI suggests channels, a budget split, content ideas and tasks. Nothing is saved or published until you review and save.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="brief">Brief</Label>
            <textarea id="brief" className="min-h-24 w-full rounded-xl border border-input bg-background p-3 text-sm" placeholder="Onam sale on sarees and kurtas across Kochi and Thrissur, 20% off for 10 days." value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={brief.trim().length < 10 || plan.isPending} onClick={() => plan.mutate()}>
                <Sparkles aria-hidden="true" /> {plan.isPending ? 'Planning…' : 'Draft the plan'}
              </Button>
              <span className="text-xs text-muted-foreground">Uses AI credits. Set the dates and budget first for a dated plan and exact budget split.</span>
            </div>
            {rationale && <Alert tone="info">{rationale}</Alert>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="name">Campaign name</Label>
            <Input id="name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="type">Type</Label>
            <Select id="type" value={f.type} onChange={(e) => changeType(e.target.value as MarketingCampaignType)}>
              {MARKETING_CAMPAIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CAMPAIGN_TYPE_INFO[t].label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{CAMPAIGN_TYPE_INFO[f.type].description}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="objective">Objective</Label>
            <Select id="objective" value={f.objective} onChange={(e) => set('objective', e.target.value as MarketingObjective)}>
              {MARKETING_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {MARKETING_OBJECTIVE_LABELS[o]}
                </option>
              ))}
            </Select>
          </div>
          {!campaign && workspaces.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="workspace">Workspace</Label>
              <Select id="workspace" value={f.workspaceId} onChange={(e) => set('workspaceId', e.target.value)}>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="owner">Owner</Label>
            <Select id="owner" value={f.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
              <option value="">{campaign ? 'No owner' : 'Me'}</option>
              {members.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <textarea id="description" className="min-h-20 w-full rounded-xl border border-input bg-background p-3 text-sm" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedule and budget</CardTitle>
          <CardDescription>The campaign status follows these dates once you mark it ready. Starting a campaign never starts paid ads; each ad is approved separately.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="start">First day</Label>
            <Input id="start" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end">Last day</Label>
            <Input id="end" type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} aria-invalid={datesBad || undefined} aria-describedby={datesBad ? 'end-error' : undefined} />
            {datesBad && (
              <p id="end-error" className="text-xs text-destructive-text">
                The last day must be on or after the first day.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tz">Time zone</Label>
            <Input id="tz" value={f.timezone} onChange={(e) => set('timezone', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="budget">Total budget (optional)</Label>
            <Input id="budget" inputMode="decimal" placeholder="50000" value={f.budgetAmount} onChange={(e) => set('budgetAmount', e.target.value.trim())} aria-invalid={!budgetValid || undefined} />
            {!budgetValid && <p className="text-xs text-destructive-text">Enter an amount like 50000 or 4999.50</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Select id="currency" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="utm">UTM campaign</Label>
            <Input id="utm" value={utm} onChange={(e) => setF((s) => ({ ...s, utmCampaign: e.target.value.toLowerCase(), utmTouched: true }))} maxLength={60} />
            <p className="text-xs text-muted-foreground">Leads arriving with utm_campaign={utm} are attributed here.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channels</CardTitle>
          <CardDescription>Plan each channel&apos;s budget and content. Email and WhatsApp can be planned now; sending arrives in Phase 14.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Channels</legend>
            {CAMPAIGN_CHANNELS.map((ch) => (
              <label key={ch} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                <input type="checkbox" className="accent-primary" checked={f.channels.includes(ch)} onChange={() => toggleChannel(ch)} />
                {CAMPAIGN_CHANNEL_INFO[ch].label}
              </label>
            ))}
          </fieldset>
          {overBudget && <Alert tone="danger">The channel budgets add up to {formatMoney(fromCents(planned), f.currency)}, more than the total of {formatMoney(f.budgetAmount, f.currency)}.</Alert>}
          {f.channels.map((ch) => (
            <ChannelPlanEditor key={ch} plan={f.plans[ch]} currency={f.currency} onChange={(p) => setPlan(ch, p)} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audience</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="aud-desc">Who is this for?</Label>
            <textarea id="aud-desc" className="min-h-16 w-full rounded-xl border border-input bg-background p-3 text-sm" value={f.audience.description} onChange={(e) => set('audience', { ...f.audience, description: e.target.value })} maxLength={1000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aud-loc">Locations (comma separated)</Label>
            <Input id="aud-loc" defaultValue={f.audience.locations.join(', ')} key={`loc-${f.audience.locations.join('|')}`} onBlur={(e) => set('audience', { ...f.audience, locations: csv(e.target.value).slice(0, 20) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aud-int">Interests (comma separated)</Label>
            <Input id="aud-int" defaultValue={f.audience.interests.join(', ')} key={`int-${f.audience.interests.join('|')}`} onBlur={(e) => set('audience', { ...f.audience, interests: csv(e.target.value).slice(0, 30) })} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="age-min">Min age</Label>
              <Input id="age-min" type="number" min={13} max={65} value={f.audience.ageMin ?? ''} onChange={(e) => set('audience', { ...f.audience, ageMin: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="age-max">Max age</Label>
              <Input id="age-max" type="number" min={13} max={65} value={f.audience.ageMax ?? ''} onChange={(e) => set('audience', { ...f.audience, ageMax: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          {canReadCrm && (
            <div className="space-y-3 rounded-xl border border-border p-4 md:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="accent-primary" checked={f.useSegment} onChange={(e) => set('useSegment', e.target.checked)} />
                Target a CRM segment (for Email and WhatsApp in Phase 14)
              </label>
              {f.useSegment && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="seg-kind">Records</Label>
                    <Select id="seg-kind" value={segment.kind} onChange={(e) => setSegment({ kind: e.target.value as AudienceSegment['kind'] })}>
                      <option value="leads">Leads</option>
                      <option value="customers">Customers</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="seg-score">Minimum lead score</Label>
                    <Input id="seg-score" type="number" min={0} max={100} value={segment.minScore ?? ''} onChange={(e) => setSegment({ minScore: e.target.value ? Number(e.target.value) : null })} disabled={segment.kind === 'customers'} />
                  </div>
                  {segment.kind === 'leads' && (
                    <fieldset className="space-y-1.5 md:col-span-2">
                      <legend className="text-sm font-medium">Lead status (none = all open leads)</legend>
                      <div className="flex flex-wrap gap-2">
                        {LEAD_STATUSES.map((s) => (
                          <label key={s} className="inline-flex items-center gap-1.5 text-sm">
                            <input type="checkbox" className="accent-primary" checked={segment.statuses.includes(s)} onChange={() => setSegment({ statuses: toggleIn(segment.statuses, s) })} />
                            {LEAD_STATUS_LABELS[s]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <fieldset className="space-y-1.5 md:col-span-2">
                    <legend className="text-sm font-medium">Source</legend>
                    <div className="flex flex-wrap gap-2">
                      {LEAD_SOURCES.map((s) => (
                        <label key={s} className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" className="accent-primary" checked={segment.sources.includes(s)} onChange={() => setSegment({ sources: toggleIn(segment.sources, s) })} />
                          {SOURCE_LABELS[s]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="space-y-1.5">
                    <Label htmlFor="seg-tags">Tags (any of)</Label>
                    <Input id="seg-tags" defaultValue={segment.tags.join(', ')} onBlur={(e) => setSegment({ tags: csv(e.target.value).slice(0, 20) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="seg-cities">Cities</Label>
                    <Input id="seg-cities" defaultValue={segment.cities.join(', ')} onBlur={(e) => setSegment({ cities: csv(e.target.value).slice(0, 20) })} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                    <Button type="button" variant="outline" disabled={count.isPending} onClick={() => count.mutate()}>
                      <Users aria-hidden="true" /> Count matching records
                    </Button>
                    {preview && (
                      <p className="text-sm" role="status">
                        <span className="font-semibold">{preview.total.toLocaleString('en-IN')}</span> match · {preview.withEmail.toLocaleString('en-IN')} with email · {preview.withPhone.toLocaleString('en-IN')} with a phone
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {aiTasks.length > 0 && !campaign && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suggested tasks</CardTitle>
            <CardDescription>Added to the campaign when you save. Remove any you don&apos;t need.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {aiTasks.map((t, i) => (
                <li key={`${t.title}-${i}`} className="flex items-center justify-between gap-2">
                  <span>{t.title}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove task ${t.title}`} onClick={() => setAiTasks((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave || save.isPending}>
          {campaign ? 'Save changes' : 'Create campaign'}
        </Button>
      </div>
    </form>
  );
}

function ChannelPlanEditor({ plan, currency, onChange }: { plan: ChannelPlanInput; currency: string; onChange: (p: Partial<ChannelPlanInput>) => void }) {
  const info = CAMPAIGN_CHANNEL_INFO[plan.channel];
  const budgetOk = !plan.plannedBudget || amountSchema.safeParse(plan.plannedBudget).success;
  const setItem = (i: number, patch: Partial<ContentPlanItem>) => onChange({ content: plan.content.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const id = `plan-${plan.channel}`;
  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-title`} className="font-medium">
          {info.label}
        </h3>
        {info.note && <span className="text-xs text-muted-foreground">{info.note}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-budget`}>Planned budget ({currency})</Label>
          <Input id={`${id}-budget`} inputMode="decimal" value={plan.plannedBudget ?? ''} onChange={(e) => onChange({ plannedBudget: e.target.value.trim() || null })} aria-invalid={!budgetOk || undefined} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-notes`}>Notes</Label>
          <Input id={`${id}-notes`} value={plan.notes} onChange={(e) => onChange({ notes: e.target.value })} maxLength={2000} />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Content plan</p>
        {plan.content.length === 0 && <p className="text-xs text-muted-foreground">No content planned yet.</p>}
        {plan.content.map((item, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <div className="space-y-1">
              <Label htmlFor={`${id}-t${i}`} className="sr-only">
                Content title {i + 1}
              </Label>
              <Input id={`${id}-t${i}`} value={item.title} placeholder="What goes out" onChange={(e) => setItem(i, { title: e.target.value })} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-d${i}`} className="sr-only">
                Date for content {i + 1}
              </Label>
              <Input id={`${id}-d${i}`} type="date" value={item.date ?? ''} onChange={(e) => setItem(i, { date: e.target.value || null })} />
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove content ${i + 1}`} onClick={() => onChange({ content: plan.content.filter((_, j) => j !== i) })}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={plan.content.length >= 50} onClick={() => onChange({ content: [...plan.content, { title: '', date: null, notes: '' }] })}>
          <Plus aria-hidden="true" /> Add content
        </Button>
      </div>
    </section>
  );
}
