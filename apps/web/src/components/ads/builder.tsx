'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Check, ImagePlus, Loader2, Plus, Search, Sparkles, Upload, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, Input, Label, Select, Skeleton } from '@zatma/ui';
import {
  CTA_LABELS,
  GOOGLE_RSA_LIMITS,
  KEYWORD_MATCH_TYPES,
  LEAD_QUESTIONS,
  META_CTAS,
  OBJECTIVE_INFO,
  OBJECTIVES_BY_PLATFORM,
  countGraphemes,
  maxSpend,
  validateCampaign,
  type AdCampaignDto,
  type AdIssue,
  type AdObjective,
  type CampaignDraftRequest,
  type DesignDetail,
  type GoogleRsa,
  type GoogleTargeting,
  type MetaCreative,
  type MetaTargeting,
  type TargetingOption,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/publishing';
import { useNow } from '@/lib/use-now';
import { uploadFile } from '@/lib/upload';
import { DesignPicker } from '@/components/publishing/composer';
import { uploadPostMedia } from '@/components/publishing/media';
import { AdPlatformMark, errorText, money } from './shared';

const DesignRenderer = dynamic(() => import('@/components/publishing/design-renderer'), { ssr: false });

type MetaAd = Omit<MetaCreative, 'imageFileId' | 'imageWidth' | 'imageHeight'> & { imageFileId: string; imageWidth: number; imageHeight: number; imageUrl: string | null };
interface State {
  adAccountId: string;
  workspaceId: string;
  name: string;
  objective: AdObjective;
  budgetType: 'DAILY' | 'LIFETIME';
  budgetAmount: string;
  startAt: string;
  endAt: string;
  meta: MetaTargeting;
  google: GoogleTargeting;
  ads: MetaAd[];
  rsa: GoogleRsa;
}

const STEPS = ['Account & goal', 'Budget & schedule', 'Audience', 'Ad', 'Review'] as const;
const emptyMetaAd = (pageId = ''): MetaAd => ({ pageId, primaryText: '', headline: '', description: '', cta: 'LEARN_MORE', imageFileId: '', imageWidth: 1080, imageHeight: 1080, imageUrl: null });
const initial = (): State => ({
  adAccountId: '',
  workspaceId: '',
  name: '',
  objective: 'TRAFFIC',
  budgetType: 'DAILY',
  budgetAmount: '500',
  startAt: '',
  endAt: '',
  meta: { locations: [], ageMin: 18, ageMax: 65, genders: [], interests: [], locales: [] },
  google: { locations: [], languages: [], keywords: [] },
  ads: [emptyMetaAd()],
  rsa: { headlines: ['', '', ''], descriptions: ['', ''], finalUrl: 'https://' },
});

function fromCampaign(c: AdCampaignDto): State {
  const s = initial();
  const g = c.adGroups[0];
  return {
    ...s,
    adAccountId: c.adAccount.id,
    workspaceId: c.workspaceId,
    name: c.name,
    objective: c.objective,
    budgetType: c.budgetType,
    budgetAmount: c.budgetAmount,
    startAt: c.startAt ?? '',
    endAt: c.endAt ?? '',
    ...(c.platform === 'META'
      ? { meta: g?.targeting as MetaTargeting, ads: (g?.ads ?? []).map((a) => ({ ...(a.creative as MetaCreative), imageUrl: a.imageUrl })) }
      : { google: g?.targeting as GoogleTargeting, rsa: g?.ads[0]?.creative as GoogleRsa }),
  };
}

/** The stored creative (everything except the local preview URL). */
function metaCreativeOf(a: MetaAd): MetaCreative {
  const c: MetaCreative = { pageId: a.pageId, primaryText: a.primaryText, headline: a.headline ?? '', description: a.description ?? '', cta: a.cta, imageFileId: a.imageFileId, imageWidth: a.imageWidth, imageHeight: a.imageHeight };
  if (a.link) c.link = a.link;
  if (a.sourceDesignId) c.sourceDesignId = a.sourceDesignId;
  if (a.copyAssetId) c.copyAssetId = a.copyAssetId;
  if (a.messaging) c.messaging = a.messaging;
  if (a.leadForm) c.leadForm = a.leadForm;
  return c;
}

/** Request body from the builder state (shape the API validates). */
function toRequest(s: State, platform: 'META' | 'GOOGLE'): CampaignDraftRequest {
  return {
    workspaceId: s.workspaceId,
    adAccountId: s.adAccountId,
    name: s.name.trim(),
    objective: s.objective,
    budgetType: s.budgetType,
    budgetAmount: s.budgetAmount.trim(),
    startAt: s.startAt || null,
    endAt: s.endAt || null,
    adGroups:
      platform === 'META'
        ? [{ name: 'Audience 1', targeting: s.meta, ads: s.ads.map((a, i) => ({ name: `Ad ${i + 1}`, creative: metaCreativeOf(a) })) }]
        : [{ name: 'Keywords', targeting: s.google, ads: [{ name: 'Responsive search ad', creative: { ...s.rsa, headlines: s.rsa.headlines.map((h) => h.trim()).filter(Boolean), descriptions: s.rsa.descriptions.map((d) => d.trim()).filter(Boolean), path1: s.rsa.path1 || undefined, path2: s.rsa.path2 || undefined } }] }],
  };
}

const campaignParam = (value: string | null, editing: boolean) => (!editing && value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined);

export function CampaignBuilder({ campaign }: { campaign?: AdCampaignDto }) {
  const router = useRouter();
  // Opened from a marketing campaign (Phase 12): the new ad campaign is linked to it.
  const marketingCampaignId = campaignParam(useSearchParams().get('campaign'), !!campaign);
  const qc = useQueryClient();
  const now = useNow();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const accounts = useQuery({ queryKey: ['ads', 'accounts', 'all'], queryFn: () => api.ads.accounts() });
  const workspaces = useQuery({ queryKey: ['workspaces', 'all'], queryFn: () => api.workspaces.list({ pageSize: 100 }) });
  const pages = useQuery({ queryKey: ['social', 'accounts'], queryFn: api.social.accounts });
  const [s, setS] = useState<State>(() => (campaign ? fromCampaign(campaign) : initial()));
  const [step, setStep] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [rendering, setRendering] = useState<{ design: DesignDetail; adIndex: number } | null>(null);
  const [designFor, setDesignFor] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));
  const tz = org.data?.timezone ?? 'Asia/Kolkata';

  const account = accounts.data?.find((a) => a.id === s.adAccountId);
  const platform = account?.platform ?? 'META';
  const fbPages = (pages.data ?? []).filter((p) => p.platform === 'FACEBOOK_PAGE');

  // Defaults once data arrives.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- initialise from loaded data */
    if (!s.adAccountId && accounts.data?.length) setS((x) => ({ ...x, adAccountId: accounts.data!.find((a) => a.status === 'ACTIVE')?.id ?? accounts.data![0]!.id }));
    if (!s.workspaceId && workspaces.data?.data.length) setS((x) => ({ ...x, workspaceId: (workspaces.data!.data.find((w) => w.isDefault) ?? workspaces.data!.data[0])!.id }));
    if (fbPages.length && s.ads.some((a) => !a.pageId)) setS((x) => ({ ...x, ads: x.ads.map((a) => (a.pageId ? a : { ...a, pageId: fbPages[0]!.externalId })) }));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [accounts.data, workspaces.data, fbPages, s.adAccountId, s.workspaceId, s.ads]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the objective valid for the platform
    if (account && !OBJECTIVES_BY_PLATFORM[platform].includes(s.objective)) setS((x) => ({ ...x, objective: OBJECTIVES_BY_PLATFORM[platform][0]!, budgetType: 'DAILY', startAt: '', endAt: '' }));
  }, [account, platform, s.objective]);

  const req = toRequest(s, platform);
  const issues: AdIssue[] = (() => {
    const out: AdIssue[] = [];
    if (!s.name.trim()) out.push({ level: 'error', code: 'NAME_REQUIRED', message: 'Name the campaign.' });
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(s.budgetAmount.trim())) return [...out, { level: 'error', code: 'BUDGET_INVALID', message: 'Enter a budget like 500 or 499.50.' }];
    if (platform === 'META') {
      if (!s.meta.locations.length) out.push({ level: 'error', code: 'LOCATION_REQUIRED', message: 'Add at least one location.', path: 'audience' });
      s.ads.forEach((a, i) => {
        if (!a.pageId) out.push({ level: 'error', code: 'PAGE_REQUIRED', message: 'Choose the Facebook Page the ad runs as.', path: `ad.${i}` });
        if (!a.imageFileId) out.push({ level: 'error', code: 'IMAGE_REQUIRED', message: `Add an image to ad ${i + 1}.`, path: `ad.${i}` });
        if (!a.primaryText.trim()) out.push({ level: 'error', code: 'TEXT_REQUIRED', message: `Write the text for ad ${i + 1}.`, path: `ad.${i}` });
      });
    } else {
      if (!s.google.locations.length) out.push({ level: 'error', code: 'LOCATION_REQUIRED', message: 'Add at least one location.', path: 'audience' });
      if (!s.google.keywords.length) out.push({ level: 'error', code: 'KEYWORDS_REQUIRED', message: 'Add at least one keyword.', path: 'audience' });
      if (!/^https:\/\/[^/]+\.[^/]+/.test(s.rsa.finalUrl)) out.push({ level: 'error', code: 'URL_REQUIRED', message: 'Enter the https:// page people land on.', path: 'ad' });
    }
    if (out.some((i) => i.level === 'error')) return out;
    try {
      return [...out, ...validateCampaign(req as Parameters<typeof validateCampaign>[0], platform, new Date(now))];
    } catch {
      return out;
    }
  })();
  const errors = issues.filter((i) => i.level === 'error');
  const max = /^\d{1,12}(\.\d{1,2})?$/.test(s.budgetAmount.trim()) ? maxSpend({ budgetType: s.budgetType, budgetAmount: s.budgetAmount.trim(), startAt: s.startAt || null, endAt: s.endAt || null }, new Date(now)) : null;

  const save = useMutation({
    mutationFn: async (andCreate: boolean) => {
      const { workspaceId, adAccountId, ...changes } = req;
      const saved = campaign ? await api.ads.campaigns.update(campaign.id, changes) : await api.ads.campaigns.create({ ...changes, workspaceId, adAccountId, ...(marketingCampaignId ? { marketingCampaignId } : {}) });
      return andCreate ? api.ads.campaigns.publish(saved.id) : saved;
    },
    onSuccess: async (dto, andCreate) => {
      await qc.invalidateQueries({ queryKey: ['ads'] });
      toast.success(andCreate ? `Creating on ${platform === 'META' ? 'Meta' : 'Google'} (paused)…` : 'Draft saved');
      router.push(`/ads/campaigns/${dto.id}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const onRendered = async (blob: Blob) => {
    const r = rendering;
    setRendering(null);
    if (!r) return;
    setUploading(true);
    try {
      const file = new File([blob], `${r.design.title || 'design'}.jpg`, { type: 'image/jpeg' });
      const fileId = await uploadFile(file, 'POST_MEDIA');
      setS((x) => ({ ...x, ads: x.ads.map((a, i) => (i === r.adIndex ? { ...a, imageFileId: fileId, imageWidth: r.design.width, imageHeight: r.design.height, imageUrl: URL.createObjectURL(file), sourceDesignId: r.design.id } : a)) }));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUploading(false);
    }
  };
  const onRenderError = (e: Error) => {
    setRendering(null);
    toast.error(`Could not render the design: ${e.message}`);
  };

  if (accounts.isPending || org.isPending || workspaces.isPending) return <Skeleton className="h-96" />;
  if (!accounts.data?.length)
    return (
      <Alert tone="info">
        Connect an ad account first on the{' '}
        <Link className="font-medium underline" href="/ads/meta">
          Meta Ads
        </Link>{' '}
        or{' '}
        <Link className="font-medium underline" href="/ads/google">
          Google Ads
        </Link>{' '}
        page.
      </Alert>
    );

  const stepErrors = (n: number) =>
    errors.filter((e) => {
      const p = e.path ?? '';
      if (n === 0) return e.code === 'NAME_REQUIRED' || e.code === 'OBJECTIVE_UNSUPPORTED';
      if (n === 1) return p.startsWith('budget') || ['endAt', 'startAt'].some((x) => p.startsWith(x)) || e.code.startsWith('BUDGET') || e.code.startsWith('END') || e.code === 'SCHEDULE_UNSUPPORTED';
      if (n === 2) return p === 'audience';
      if (n === 3) return p.startsWith('ad');
      return true;
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-2" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button type="button" onClick={() => setStep(i)} aria-current={step === i ? 'step' : undefined} className={cn('flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm', step === i ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                <span className={cn('grid size-5 place-items-center rounded-full text-xs', stepErrors(i).length && i < step ? 'bg-destructive text-destructive-foreground' : i < step ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>{i < step && !stepErrors(i).length ? <Check className="size-3" aria-hidden="true" /> : i + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <Card>
          <CardContent className="space-y-5 p-6">
            {step === 0 && (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 className="text-lg font-semibold">Account and goal</h2>
                  {!campaign && (
                    <Button variant="outline" onClick={() => setAiOpen(true)} disabled={!account}>
                      <Sparkles aria-hidden="true" /> Draft with AI
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ad-account">Ad account</Label>
                    <Select id="ad-account" value={s.adAccountId} disabled={!!campaign} onChange={(e) => set({ adAccountId: e.target.value })}>
                      {accounts.data.map((a) => (
                        <option key={a.id} value={a.id} disabled={a.status !== 'ACTIVE'}>
                          {a.platform === 'META' ? 'Meta' : 'Google'} · {a.name} ({a.currency})
                        </option>
                      ))}
                    </Select>
                  </div>
                  {(workspaces.data?.data.length ?? 0) > 1 && (
                    <div className="space-y-1.5">
                      <Label htmlFor="ad-workspace">Workspace</Label>
                      <Select id="ad-workspace" value={s.workspaceId} disabled={!!campaign} onChange={(e) => set({ workspaceId: e.target.value })}>
                        {workspaces.data!.data.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ad-name">Campaign name</Label>
                    <Input id="ad-name" maxLength={200} value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Onam sale – Kochi" />
                  </div>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Goal</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {OBJECTIVES_BY_PLATFORM[platform].map((o) => (
                      <label key={o} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', s.objective === o ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>
                        <input type="radio" name="objective" className="mt-0.5 accent-[var(--color-primary)]" checked={s.objective === o} onChange={() => set({ objective: o })} />
                        <span>
                          <span className="block font-medium">{OBJECTIVE_INFO[o].label}</span>
                          <span className="block text-muted-foreground">{OBJECTIVE_INFO[o].description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="text-lg font-semibold">Budget and schedule</h2>
                {platform === 'META' && (
                  <fieldset className="flex gap-4 text-sm">
                    <legend className="sr-only">Budget type</legend>
                    {(['DAILY', 'LIFETIME'] as const).map((t) => (
                      <label key={t} className="flex items-center gap-2">
                        <input type="radio" name="budgetType" className="accent-[var(--color-primary)]" checked={s.budgetType === t} onChange={() => set({ budgetType: t })} />
                        {t === 'DAILY' ? 'Daily budget' : 'Lifetime budget'}
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ad-budget">{s.budgetType === 'DAILY' ? 'Per day' : 'Total'} ({account?.currency})</Label>
                    <Input id="ad-budget" inputMode="decimal" value={s.budgetAmount} onChange={(e) => set({ budgetAmount: e.target.value })} />
                  </div>
                  {platform === 'META' && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="ad-start">Start (optional)</Label>
                        <Input id="ad-start" type="datetime-local" value={s.startAt ? toLocalInput(s.startAt, tz) : ''} onChange={(e) => set({ startAt: e.target.value ? fromLocalInput(e.target.value, tz) : '' })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ad-end">End {s.budgetType === 'LIFETIME' ? '' : '(optional)'}</Label>
                        <Input id="ad-end" type="datetime-local" value={s.endAt ? toLocalInput(s.endAt, tz) : ''} onChange={(e) => set({ endAt: e.target.value ? fromLocalInput(e.target.value, tz) : '' })} />
                      </div>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Times in {tz}. {platform === 'GOOGLE' ? 'Google campaigns start when an Owner or Admin activates them and run until paused.' : 'Meta may spend up to 75% more than the daily budget on some days, but not more than 7× the daily budget in a week.'}
                </p>
              </>
            )}

            {step === 2 && account && (platform === 'META' ? <MetaAudience accountId={account.id} value={s.meta} onChange={(meta) => set({ meta })} /> : <GoogleAudience accountId={account.id} value={s.google} onChange={(google) => set({ google })} />)}

            {step === 3 && (
              <>
                <h2 className="text-lg font-semibold">Ad</h2>
                {platform === 'META' ? (
                  <>
                    {fbPages.length === 0 && (
                      <Alert tone="info">
                        Meta ads run as a Facebook Page.{' '}
                        <Link className="font-medium underline" href="/marketing/accounts">
                          Connect your Page
                        </Link>{' '}
                        first.
                      </Alert>
                    )}
                    {s.ads.map((ad, i) => (
                      <MetaAdEditor
                        key={i}
                        index={i}
                        ad={ad}
                        objective={s.objective}
                        pages={fbPages.map((p) => ({ id: p.externalId, name: p.name }))}
                        busy={uploading || rendering?.adIndex === i}
                        canRemove={s.ads.length > 1}
                        onChange={(a) => set({ ads: s.ads.map((x, j) => (j === i ? a : x)) })}
                        onRemove={() => set({ ads: s.ads.filter((_, j) => j !== i) })}
                        onDesign={() => setDesignFor(i)}
                        onUpload={async (file) => {
                          setUploading(true);
                          try {
                            const m = await uploadPostMedia(file);
                            if (m.kind !== 'image') throw new Error('Use an image for this ad');
                            set({ ads: s.ads.map((x, j) => (j === i ? { ...x, imageFileId: m.fileId, imageWidth: m.width, imageHeight: m.height, imageUrl: m.url } : x)) });
                          } catch (e) {
                            toast.error(errorText(e));
                          } finally {
                            setUploading(false);
                          }
                        }}
                      />
                    ))}
                    {s.ads.length < 3 && (
                      <Button variant="outline" onClick={() => set({ ads: [...s.ads, { ...emptyMetaAd(s.ads[0]?.pageId), imageFileId: s.ads[0]?.imageFileId ?? '', imageUrl: s.ads[0]?.imageUrl ?? null, imageWidth: s.ads[0]?.imageWidth ?? 1080, imageHeight: s.ads[0]?.imageHeight ?? 1080, link: s.ads[0]?.link }] })}>
                        <Plus aria-hidden="true" /> Add a text variant
                      </Button>
                    )}
                  </>
                ) : (
                  <RsaEditor value={s.rsa} onChange={(rsa) => set({ rsa })} />
                )}
              </>
            )}

            {step === 4 && (
              <>
                <h2 className="text-lg font-semibold">Review</h2>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Account</dt>
                    <dd className="font-medium">{account?.name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Goal</dt>
                    <dd className="font-medium">{OBJECTIVE_INFO[s.objective].label}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Budget</dt>
                    <dd className="font-medium">
                      {money(s.budgetAmount.trim() || '0', account?.currency ?? 'INR')} {s.budgetType === 'DAILY' ? 'per day' : 'in total'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Audience</dt>
                    <dd className="font-medium">{(platform === 'META' ? s.meta.locations : s.google.locations).map((l) => l.name).join(', ') || '–'}</dd>
                  </div>
                </dl>
                {errors.length > 0 ? (
                  <ul className="space-y-1 text-sm" aria-label="Problems to fix">
                    {errors.map((e) => (
                      <li key={e.code + (e.path ?? '')} className="flex gap-1.5 text-destructive-text">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {e.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-success-text">
                    <Check className="size-4" aria-hidden="true" /> Ready to create. It will be created <strong>paused</strong> and spends nothing until an Owner or Admin activates it.
                  </p>
                )}
                {issues
                  .filter((i) => i.level === 'warning')
                  .map((w) => (
                    <p key={w.code + (w.path ?? '')} className="flex gap-1.5 text-sm text-warning-text">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {w.message}
                    </p>
                  ))}
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={save.isPending || !s.name.trim()} onClick={() => save.mutate(false)}>
              Save draft
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)}>Next</Button>
            ) : (
              <Button disabled={!!errors.length || save.isPending} onClick={() => save.mutate(true)}>
                {save.isPending ? 'Creating…' : `Create on ${platform === 'META' ? 'Meta' : 'Google'} (paused)`}
              </Button>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Most this can spend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold">{max ? money(max.amount, account?.currency ?? 'INR') : '–'}</p>
            <p className="text-xs text-muted-foreground">{max ? (s.budgetType === 'LIFETIME' ? 'Lifetime budget' : max.untilMonthEnd ? `${max.days} days, until the end of this month (no end date)` : `${max.days} days at the daily budget`) : 'Enter a budget'}</p>
            {account?.monthlySpendCap && (
              <p className="text-xs text-muted-foreground">
                Account cap {money(account.monthlySpendCap, account.currency)} per month · {money(account.spentThisMonth, account.currency)} spent so far
              </p>
            )}
          </CardContent>
        </Card>
        {account && (platform === 'META' ? <MetaPreview ad={s.ads[0]!} pageName={fbPages.find((p) => p.externalId === s.ads[0]?.pageId)?.name ?? 'Your Page'} /> : <GooglePreview rsa={s.rsa} />)}
        {step < 4 && stepErrors(step).length > 0 && (
          <ul className="space-y-1 text-xs" aria-label="This step">
            {stepErrors(step).map((e) => (
              <li key={e.code + (e.path ?? '')} className="flex gap-1.5 text-destructive-text">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {e.message}
              </li>
            ))}
          </ul>
        )}
      </aside>

      {account && (
        <AiDraftDialog
          open={aiOpen}
          accountId={account.id}
          currency={account.currency}
          onClose={() => setAiOpen(false)}
          onDraft={(d) => {
            const g = d.adGroups[0]!;
            setS((x) => ({
              ...x,
              name: d.name,
              objective: d.objective,
              budgetAmount: d.budgetAmount,
              ...(platform === 'META'
                ? {
                    meta: { ...x.meta, ...(g.targeting as MetaTargeting) },
                    ads: g.ads.map((a, i) => ({ ...(x.ads[i] ?? x.ads[0] ?? emptyMetaAd()), ...(a.creative as MetaCreative), pageId: x.ads[0]?.pageId || fbPages[0]?.externalId || '', imageFileId: x.ads[0]?.imageFileId ?? '', imageUrl: x.ads[0]?.imageUrl ?? null, imageWidth: x.ads[0]?.imageWidth ?? 1080, imageHeight: x.ads[0]?.imageHeight ?? 1080 })),
                  }
                : { google: { ...x.google, ...(g.targeting as GoogleTargeting) }, rsa: { ...x.rsa, ...(g.ads[0]!.creative as GoogleRsa) } }),
            }));
            setAiOpen(false);
            setStep(platform === 'META' ? 3 : 2);
          }}
        />
      )}
      <DesignPicker
        open={designFor !== null}
        workspaceId={s.workspaceId}
        onClose={() => setDesignFor(null)}
        onPick={async (id) => {
          const i = designFor ?? 0;
          setDesignFor(null);
          try {
            setRendering({ design: await api.designs.get(id), adIndex: i });
          } catch (e) {
            toast.error(errorText(e));
          }
        }}
      />
      {rendering && <DesignRenderer design={rendering.design} onDone={onRendered} onError={onRenderError} />}
    </div>
  );
}

function Counter({ text, max, recommended }: { text: string; max: number; recommended?: number }) {
  const n = countGraphemes(text);
  return (
    <span className={cn('text-xs', n > max ? 'text-destructive-text' : recommended && n > recommended ? 'text-warning-text' : 'text-muted-foreground')} aria-live="polite">
      {n}/{max}
    </span>
  );
}

function TargetSearch({ accountId, kind, placeholder, onPick }: { accountId: string; kind: 'location' | 'interest' | 'language'; placeholder: string; onPick: (o: TargetingOption) => void }) {
  const [q, setQ] = useState('');
  const search = useMutation({ mutationFn: () => api.ads.targeting(accountId, kind, q.trim()), onError: (e) => toast.error(errorText(e)) });
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) search.mutate();
        }}
      >
        <Input aria-label={placeholder} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="outline" disabled={!q.trim() || search.isPending} aria-label={`Search ${kind}s`}>
          {search.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
        </Button>
      </form>
      {search.data && (
        <ul className="flex flex-wrap gap-2" aria-label={`${kind} results`}>
          {search.data.length === 0 && <li className="text-xs text-muted-foreground">No matches.</li>}
          {search.data.map((o) => (
            <li key={o.id}>
              <button type="button" className="rounded-lg border border-border px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => onPick(o)}>
                <span className="font-medium">{o.name}</span>
                <span className="text-muted-foreground"> · {[o.type, o.description].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chips<T>({ items, label, render, onRemove }: { items: T[]; label: string; render: (t: T) => string; onRemove: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {items.map((t, i) => (
        <li key={`${render(t)}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {render(t)}
          <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${render(t)}`}>
            <X className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function MetaAudience({ accountId, value: t, onChange }: { accountId: string; value: MetaTargeting; onChange: (t: MetaTargeting) => void }) {
  return (
    <>
      <h2 className="text-lg font-semibold">Audience</h2>
      <section className="space-y-2" aria-labelledby="loc-h">
        <h3 id="loc-h" className="text-sm font-medium">
          Locations
        </h3>
        <Chips items={t.locations} label="Selected locations" render={(l) => `${l.name}${l.type === 'city' ? ` (+${l.radiusKm ?? 25} km)` : ''}`} onRemove={(i) => onChange({ ...t, locations: t.locations.filter((_, j) => j !== i) })} />
        <TargetSearch accountId={accountId} kind="location" placeholder="Search a country, state or city" onPick={(o) => !t.locations.some((l) => l.key === o.id) && onChange({ ...t, locations: [...t.locations, { key: o.id, name: o.name, type: (['country', 'region', 'city', 'zip'].includes(o.type) ? o.type : 'city') as 'city', ...(o.countryCode ? { countryCode: o.countryCode } : {}) }] })} />
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="age-min">Age from</Label>
          <Input id="age-min" type="number" min={18} max={65} value={t.ageMin} onChange={(e) => onChange({ ...t, ageMin: Number(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="age-max">Age to</Label>
          <Input id="age-max" type="number" min={18} max={65} value={t.ageMax} onChange={(e) => onChange({ ...t, ageMax: Number(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gender">Gender</Label>
          <Select id="gender" value={t.genders.join(',') || 'all'} onChange={(e) => onChange({ ...t, genders: e.target.value === 'all' ? [] : [Number(e.target.value) as 1 | 2] })}>
            <option value="all">All</option>
            <option value="1">Men</option>
            <option value="2">Women</option>
          </Select>
        </div>
      </div>
      <section className="space-y-2" aria-labelledby="int-h">
        <h3 id="int-h" className="text-sm font-medium">
          Interests (optional)
        </h3>
        <Chips items={t.interests} label="Selected interests" render={(i) => i.name} onRemove={(i) => onChange({ ...t, interests: t.interests.filter((_, j) => j !== i) })} />
        <TargetSearch accountId={accountId} kind="interest" placeholder="Search interests, e.g. Small business" onPick={(o) => !t.interests.some((x) => x.id === o.id) && onChange({ ...t, interests: [...t.interests, { id: o.id, name: o.name }] })} />
      </section>
    </>
  );
}

function GoogleAudience({ accountId, value: t, onChange }: { accountId: string; value: GoogleTargeting; onChange: (t: GoogleTargeting) => void }) {
  const [kw, setKw] = useState('');
  const [match, setMatch] = useState<(typeof KEYWORD_MATCH_TYPES)[number]>('PHRASE');
  return (
    <>
      <h2 className="text-lg font-semibold">Audience and keywords</h2>
      <section className="space-y-2" aria-labelledby="gloc-h">
        <h3 id="gloc-h" className="text-sm font-medium">
          Locations
        </h3>
        <Chips items={t.locations} label="Selected locations" render={(l) => l.name} onRemove={(i) => onChange({ ...t, locations: t.locations.filter((_, j) => j !== i) })} />
        <TargetSearch accountId={accountId} kind="location" placeholder="Search a country, state or city" onPick={(o) => !t.locations.some((l) => l.id === o.id) && onChange({ ...t, locations: [...t.locations, { id: o.id, name: o.description ?? o.name }] })} />
      </section>
      <section className="space-y-2" aria-labelledby="glang-h">
        <h3 id="glang-h" className="text-sm font-medium">
          Languages (optional)
        </h3>
        <Chips items={t.languages} label="Selected languages" render={(l) => l.name} onRemove={(i) => onChange({ ...t, languages: t.languages.filter((_, j) => j !== i) })} />
        <TargetSearch accountId={accountId} kind="language" placeholder="Search a language" onPick={(o) => !t.languages.some((l) => l.id === o.id) && onChange({ ...t, languages: [...t.languages, { id: o.id, name: o.name }] })} />
      </section>
      <section className="space-y-2" aria-labelledby="kw-h">
        <h3 id="kw-h" className="text-sm font-medium">
          Keywords
        </h3>
        <Chips items={t.keywords} label="Keywords" render={(k) => (k.matchType === 'EXACT' ? `[${k.text}]` : k.matchType === 'PHRASE' ? `"${k.text}"` : k.text)} onRemove={(i) => onChange({ ...t, keywords: t.keywords.filter((_, j) => j !== i) })} />
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = kw.trim();
            if (text && !t.keywords.some((k) => k.text === text && k.matchType === match)) onChange({ ...t, keywords: [...t.keywords, { text, matchType: match }] });
            setKw('');
          }}
        >
          <Input aria-label="Keyword" className="min-w-48 flex-1" placeholder="e.g. van sales software" value={kw} maxLength={80} onChange={(e) => setKw(e.target.value)} />
          <Select aria-label="Match type" className="w-32" value={match} onChange={(e) => setMatch(e.target.value as typeof match)}>
            <option value="BROAD">Broad</option>
            <option value="PHRASE">Phrase</option>
            <option value="EXACT">Exact</option>
          </Select>
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
      </section>
    </>
  );
}

function MetaAdEditor({
  index,
  ad,
  objective,
  pages,
  busy,
  canRemove,
  onChange,
  onRemove,
  onDesign,
  onUpload,
}: {
  index: number;
  ad: MetaAd;
  objective: AdObjective;
  pages: Array<{ id: string; name: string }>;
  busy: boolean;
  canRemove: boolean;
  onChange: (a: MetaAd) => void;
  onRemove: () => void;
  onDesign: () => void;
  onUpload: (f: File) => void;
}) {
  const p = `ad${index}`;
  return (
    <section className="space-y-4 rounded-xl border border-border p-4" aria-label={`Ad ${index + 1}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Ad {index + 1}</h3>
        {canRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-2">
          <div className="grid aspect-square place-items-center overflow-hidden rounded-xl border border-border bg-muted">
            {busy ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Preparing image" />
            ) : ad.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.imageUrl} alt="Ad image" className="size-full object-cover" />
            ) : (
              <ImagePlus className="size-6 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={onDesign}>
              Design
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <Upload className="size-4" aria-hidden="true" /> Upload
              <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
            </label>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${p}-page`}>Facebook Page</Label>
            <Select id={`${p}-page`} value={ad.pageId} onChange={(e) => onChange({ ...ad, pageId: e.target.value })}>
              <option value="">Choose a Page</option>
              {pages.map((pg) => (
                <option key={pg.id} value={pg.id}>
                  {pg.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label htmlFor={`${p}-text`}>Primary text</Label>
              <Counter text={ad.primaryText} max={2200} recommended={125} />
            </div>
            <textarea id={`${p}-text`} className="min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={ad.primaryText} onChange={(e) => onChange({ ...ad, primaryText: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label htmlFor={`${p}-headline`}>Headline</Label>
                <Counter text={ad.headline} max={40} recommended={27} />
              </div>
              <Input id={`${p}-headline`} value={ad.headline} onChange={(e) => onChange({ ...ad, headline: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label htmlFor={`${p}-desc`}>Description</Label>
                <Counter text={ad.description} max={30} recommended={27} />
              </div>
              <Input id={`${p}-desc`} value={ad.description} onChange={(e) => onChange({ ...ad, description: e.target.value })} />
            </div>
          </div>
          {objective !== 'MESSAGES' && objective !== 'LEADS' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${p}-link`}>Website link {objective === 'TRAFFIC' ? '' : '(optional)'}</Label>
                <Input id={`${p}-link`} type="url" placeholder="https://" value={ad.link ?? ''} onChange={(e) => onChange({ ...ad, link: e.target.value || undefined })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${p}-cta`}>Button</Label>
                <Select id={`${p}-cta`} value={ad.cta} onChange={(e) => onChange({ ...ad, cta: e.target.value as MetaAd['cta'] })}>
                  {META_CTAS.filter((c) => c !== 'WHATSAPP_MESSAGE' && c !== 'MESSAGE_PAGE').map((c) => (
                    <option key={c} value={c}>
                      {CTA_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
          {objective === 'MESSAGES' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${p}-chan`}>Conversations on</Label>
                <Select id={`${p}-chan`} value={ad.messaging?.channel ?? ''} onChange={(e) => onChange({ ...ad, messaging: e.target.value ? { ...ad.messaging, channel: e.target.value as 'WHATSAPP' | 'MESSENGER' } : undefined })}>
                  <option value="">Choose…</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="MESSENGER">Messenger</option>
                </Select>
              </div>
              {ad.messaging?.channel === 'WHATSAPP' && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${p}-wa`}>WhatsApp Business number</Label>
                  <Input id={`${p}-wa`} placeholder="+919847012345" value={ad.messaging.whatsappNumber ?? ''} onChange={(e) => onChange({ ...ad, messaging: { ...ad.messaging!, whatsappNumber: e.target.value || undefined } })} />
                </div>
              )}
            </div>
          )}
          {objective === 'LEADS' && <LeadFormEditor id={p} value={ad.leadForm} onChange={(leadForm) => onChange({ ...ad, leadForm })} />}
        </div>
      </div>
    </section>
  );
}

function LeadFormEditor({ id, value, onChange }: { id: string; value: MetaCreative['leadForm']; onChange: (v: MetaCreative['leadForm']) => void }) {
  const v = value ?? { name: 'Enquiry form', questions: ['FULL_NAME', 'PHONE'] as (typeof LEAD_QUESTIONS)[number][], privacyPolicyUrl: '' };
  const labels: Record<string, string> = { FULL_NAME: 'Full name', PHONE: 'Phone', EMAIL: 'Email', CITY: 'City', COMPANY_NAME: 'Company', JOB_TITLE: 'Job title' };
  return (
    <fieldset className="space-y-3 rounded-xl bg-muted/50 p-3">
      <legend className="px-1 text-sm font-medium">Instant form</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-fname`}>Form name</Label>
          <Input id={`${id}-fname`} value={v.name} onChange={(e) => onChange({ ...v, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-privacy`}>Privacy policy link</Label>
          <Input id={`${id}-privacy`} type="url" placeholder="https://" value={v.privacyPolicyUrl} onChange={(e) => onChange({ ...v, privacyPolicyUrl: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-sm" role="group" aria-label="Questions">
        {LEAD_QUESTIONS.map((q) => (
          <label key={q} className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-[var(--color-primary)]" checked={v.questions.includes(q)} onChange={(e) => onChange({ ...v, questions: e.target.checked ? [...v.questions, q] : v.questions.filter((x) => x !== q) })} />
            {labels[q]}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Leads are collected by Meta. Importing them into the CRM automatically arrives with automations (Phase 13).</p>
    </fieldset>
  );
}

function RsaEditor({ value: r, onChange }: { value: GoogleRsa; onChange: (r: GoogleRsa) => void }) {
  const L = GOOGLE_RSA_LIMITS;
  const list = (key: 'headlines' | 'descriptions', max: number, length: number) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {key === 'headlines' ? `Headlines (${L.headlines.min}–${L.headlines.max}, up to ${length} characters)` : `Descriptions (${L.descriptions.min}–${L.descriptions.max}, up to ${length} characters)`}
      </legend>
      {r[key].map((text, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input aria-label={`${key === 'headlines' ? 'Headline' : 'Description'} ${i + 1}`} value={text} onChange={(e) => onChange({ ...r, [key]: r[key].map((x, j) => (j === i ? e.target.value : x)) })} />
          <Counter text={text} max={length} />
          {r[key].length > (key === 'headlines' ? L.headlines.min : L.descriptions.min) && (
            <Button size="icon" variant="ghost" aria-label={`Remove ${key === 'headlines' ? 'headline' : 'description'} ${i + 1}`} onClick={() => onChange({ ...r, [key]: r[key].filter((_, j) => j !== i) })}>
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      ))}
      {r[key].length < max && (
        <Button size="sm" variant="outline" onClick={() => onChange({ ...r, [key]: [...r[key], ''] })}>
          <Plus aria-hidden="true" /> Add {key === 'headlines' ? 'headline' : 'description'}
        </Button>
      )}
    </fieldset>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
        <div className="space-y-1.5">
          <Label htmlFor="rsa-url">Final URL</Label>
          <Input id="rsa-url" type="url" value={r.finalUrl} onChange={(e) => onChange({ ...r, finalUrl: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rsa-p1">Path 1</Label>
          <Input id="rsa-p1" maxLength={15} value={r.path1 ?? ''} onChange={(e) => onChange({ ...r, path1: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rsa-p2">Path 2</Label>
          <Input id="rsa-p2" maxLength={15} value={r.path2 ?? ''} onChange={(e) => onChange({ ...r, path2: e.target.value })} />
        </div>
      </div>
      {list('headlines', L.headlines.max, L.headlines.length)}
      {list('descriptions', L.descriptions.max, L.descriptions.length)}
    </div>
  );
}

function MetaPreview({ ad, pageName }: { ad: MetaAd; pageName: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Ad preview">
      <div className="flex items-center gap-2 p-3">
        <AdPlatformMark platform="META" />
        <div>
          <p className="text-sm font-medium">{pageName}</p>
          <p className="text-xs text-muted-foreground">Sponsored · Preview</p>
        </div>
      </div>
      <p className="whitespace-pre-wrap break-words px-3 pb-3 text-sm">{Array.from(ad.primaryText).length > 125 ? `${Array.from(ad.primaryText).slice(0, 125).join('')}… See more` : ad.primaryText || <span className="text-muted-foreground">Ad text</span>}</p>
      <div className="aspect-square bg-muted">
        {
          // eslint-disable-next-line @next/next/no-img-element
          ad.imageUrl ? <img src={ad.imageUrl} alt="" className="size-full object-cover" /> : null
        }
      </div>
      <div className="flex items-center justify-between gap-2 bg-muted/60 p-3">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase text-muted-foreground">{ad.link ? new URL(ad.link.startsWith('http') ? ad.link : `https://${ad.link}`).hostname : 'facebook.com'}</p>
          <p className="truncate text-sm font-semibold">{ad.headline || 'Headline'}</p>
          {ad.description && <p className="truncate text-xs text-muted-foreground">{ad.description}</p>}
        </div>
        <Badge tone="neutral">{CTA_LABELS[ad.cta]}</Badge>
      </div>
    </figure>
  );
}

function GooglePreview({ rsa }: { rsa: GoogleRsa }) {
  const host = (() => {
    try {
      return new URL(rsa.finalUrl).hostname;
    } catch {
      return 'example.com';
    }
  })();
  const hs = rsa.headlines.filter(Boolean).slice(0, 3);
  return (
    <figure className="space-y-1 rounded-2xl border border-border bg-card p-4" aria-label="Ad preview">
      <p className="text-xs">
        <span className="font-semibold">Sponsored</span> · {host}
        {rsa.path1 ? `/${rsa.path1}` : ''}
        {rsa.path2 ? `/${rsa.path2}` : ''}
      </p>
      <p className="text-lg leading-snug text-primary">{hs.length ? hs.join(' | ') : 'Headline 1 | Headline 2 | Headline 3'}</p>
      <p className="text-sm text-muted-foreground">{rsa.descriptions.filter(Boolean).slice(0, 2).join(' ') || 'Your descriptions appear here.'}</p>
      <figcaption className="pt-2 text-xs text-muted-foreground">Google combines your headlines and descriptions; this is one possible version.</figcaption>
    </figure>
  );
}

function AiDraftDialog({ open, accountId, currency, onClose, onDraft }: { open: boolean; accountId: string; currency: string; onClose: () => void; onDraft: (d: Omit<CampaignDraftRequest, 'workspaceId'>) => void }) {
  const [brief, setBrief] = useState('');
  const [budget, setBudget] = useState('');
  const [link, setLink] = useState('');
  const [location, setLocation] = useState('');
  const draft = useMutation({
    mutationFn: () => api.ads.campaigns.aiDraft({ adAccountId: accountId, brief: brief.trim(), ...(budget.trim() ? { budgetMax: budget.trim() } : {}), ...(link.trim() ? { link: link.trim() } : {}), ...(location.trim() ? { location: location.trim() } : {}) }),
    onSuccess: (res) => {
      onDraft(res.draft);
      toast.success(res.unresolved.length ? `Draft ready. Not found on the platform: ${res.unresolved.join(', ')}` : 'Draft ready. Review every step before creating it.');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Draft with AI" description="AI suggests a name, budget, audience and ad text. Locations and interests are looked up on the platform. Nothing is saved or created until you do it.">
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ai-brief">What are you promoting?</Label>
            <textarea id="ai-brief" className="min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Onam sale at our Kochi store, 20% off all week, call or WhatsApp to order" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-loc">Where</Label>
              <Input id="ai-loc" placeholder="Kochi" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-budget">Max per day ({currency})</Label>
              <Input id="ai-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-link">Landing page</Label>
              <Input id="ai-link" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={brief.trim().length < 10 || draft.isPending} onClick={() => draft.mutate()}>
              <Sparkles aria-hidden="true" /> {draft.isPending ? 'Drafting…' : 'Draft campaign'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
