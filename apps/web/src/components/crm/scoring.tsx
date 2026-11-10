'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Copy, Gauge, Loader2, MessageCircle, RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Alert, Badge, Button, Card, CardContent, cn, Dialog, DialogContent, ErrorState, Input, Label, Select, Skeleton } from '@zatma/ui';
import {
  COPY_LANGUAGES,
  dueFor,
  MESSAGE_GOALS,
  SCORING_SIGNALS,
  SIGNAL_INFO,
  whatsappLink,
  type ContactDto,
  type DraftMessageInput,
  type LeadDto,
  type ScoringSettings,
  type ScoringSignal,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { formatDate, GRADE_LABELS, GRADE_TONES, listToText, textToList, weightLabel, type Grade } from '@/lib/crm';
import { LANGUAGE_LABELS } from '@/lib/options';
import { textDirection } from '@/components/studio/copy-helpers';
import { describeError, useCrmAccess } from './shared';

type Lang = (typeof COPY_LANGUAGES)[number];

const aiError = (e: unknown) => {
  if (e instanceof ApiError && e.code === 'AI_PROVIDER_UNAVAILABLE') return 'No AI text provider is configured on the server yet.';
  if (e instanceof ApiError && e.code === 'PLAN_LIMIT_REACHED') return 'You have used all AI credits for this period.';
  return describeError(e);
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Copy failed. Select the text and copy it manually.');
  }
}

export function ScoreBadge({ score, grade, reason, className }: { score: number | null; grade: Grade | null; reason?: string | null; className?: string }) {
  if (score === null || !grade) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={reason ?? undefined}>
      <Badge tone={GRADE_TONES[grade]} className="tabular-nums">
        {GRADE_LABELS[grade]} · {score}
      </Badge>
      {reason && <span className="sr-only">Because: {reason}</span>}
    </span>
  );
}

/** Explainable score: every signal with its points and plain-language reason. */
export function LeadScoreCard({ leadId }: { leadId: string }) {
  const score = useQuery({ queryKey: ['crm', 'lead', leadId, 'score'], queryFn: () => api.crm.leads.score(leadId) });
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Gauge className="size-5 text-primary" aria-hidden="true" /> Lead score
          </h2>
          {score.data && <ScoreBadge score={score.data.score} grade={score.data.grade} />}
        </div>
        {score.isPending ? (
          <Skeleton className="h-24" />
        ) : score.isError ? (
          <ErrorState description="Couldn't load the score." onRetry={() => void score.refetch()} />
        ) : (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Lead score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score.data.score}>
              <div className={cn('h-full rounded-full', score.data.grade === 'HOT' ? 'bg-destructive' : score.data.grade === 'WARM' ? 'bg-warning' : 'bg-muted-foreground')} style={{ width: `${score.data.score}%` }} />
            </div>
            <ul className="space-y-1.5 text-sm" aria-label="Why this score">
              {score.data.signals.map((s) => (
                <li key={`${s.key}-${s.detail}`} className="flex items-start gap-2">
                  {s.points >= 0 ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden="true" /> : <TrendingDown className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.label}</span> <span className="text-muted-foreground">· {s.detail}</span>
                  </span>
                  <span className={cn('tabular-nums font-medium', s.points < 0 ? 'text-destructive' : s.points > 0 ? 'text-success-text' : 'text-muted-foreground')}>
                    {s.points > 0 ? `+${s.points}` : s.points}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Rule-based and explainable: no AI decides this number. Managers can tune the weights in Settings → CRM scoring.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const ACTION_LABELS: Record<string, string> = { CALL: 'Call', WHATSAPP: 'WhatsApp', EMAIL: 'Email', MEETING: 'Meeting', NURTURE: 'Nurture', DISQUALIFY: 'Disqualify' };
const WHEN_LABELS: Record<string, string> = { today: 'today', tomorrow: 'tomorrow', this_week: 'this week', next_week: 'next week' };

/** AI summary, next best action (one click to schedule it) and a drafted follow-up message. */
export function LeadInsightsCard({ lead }: { lead: LeadDto }) {
  const qc = useQueryClient();
  const access = useCrmAccess();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const cached = useQuery({ queryKey: ['crm', 'lead', lead.id, 'insights'], queryFn: () => api.crm.leads.insights(lead.id) });
  const [language, setLanguage] = useState<Lang | ''>('');
  const lang = (language || org.data?.defaultLanguage || 'en') as Lang;
  const generate = useMutation({
    mutationFn: () => api.crm.leads.generateInsights(lead.id, lang),
    onSuccess: (i) => qc.setQueryData(['crm', 'lead', lead.id, 'insights'], { insights: i }),
    onError: (e) => toast.error(aiError(e)),
  });
  const schedule = useMutation({
    mutationFn: async () => {
      const nba = cached.data!.insights!.nextBestAction;
      return api.crm.activities.create({ leadId: lead.id, type: 'FOLLOW_UP', subject: `${ACTION_LABELS[nba.action]}: ${nba.reason}`.slice(0, 200), dueAt: dueFor(nba.when).toISOString(), priority: 'HIGH' });
    },
    onSuccess: async () => {
      toast.success('Follow-up scheduled from the suggestion');
      await qc.invalidateQueries({ queryKey: ['crm'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const insights = cached.data?.insights ?? null;
  const canAi = access.canWrite && (org.data?.permissions.includes('ai:generate') ?? false);
  const wa = insights ? whatsappLink(lead.whatsapp ?? lead.phone, insights.followUpMessage.text) : null;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="size-5 text-primary" aria-hidden="true" /> AI insights
          </h2>
          {canAi && (
            <div className="flex items-center gap-2">
              <Label htmlFor="insights-language" className="sr-only">
                Message language
              </Label>
              <Select id="insights-language" className="h-9 w-52" value={lang} onChange={(e) => setLanguage(e.target.value as Lang)}>
                {COPY_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant={insights ? 'outline' : 'primary'} disabled={generate.isPending} onClick={() => generate.mutate()}>
                {generate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : insights ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {insights ? 'Refresh' : 'Generate'}
              </Button>
            </div>
          )}
        </div>
        {cached.isPending ? (
          <Skeleton className="h-24" />
        ) : !insights ? (
          <p className="text-sm text-muted-foreground">
            {canAi ? 'Get a short summary, the best next step and a drafted follow-up message for this lead. Uses AI credits.' : 'No insights generated yet.'}
          </p>
        ) : (
          <div className="space-y-4" aria-live="polite">
            <p className="text-sm">{insights.summary}</p>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next best action</p>
              <p className="mt-1 text-sm">
                <strong>
                  {ACTION_LABELS[insights.nextBestAction.action]} {WHEN_LABELS[insights.nextBestAction.when]}
                </strong>{' '}
                · {insights.nextBestAction.reason}
              </p>
              {access.canWrite && insights.nextBestAction.action !== 'DISQUALIFY' && insights.nextBestAction.action !== 'NURTURE' && (
                <Button size="sm" variant="outline" className="mt-2" disabled={schedule.isPending} onClick={() => schedule.mutate()}>
                  <CalendarPlus aria-hidden="true" /> Schedule it
                </Button>
              )}
            </div>
            {insights.talkingPoints.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Talking points</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                  {insights.talkingPoints.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Drafted {insights.followUpMessage.channel === 'email' ? 'email' : 'WhatsApp message'}</p>
              {insights.followUpMessage.subject && <p className="mt-1 text-sm font-medium">{insights.followUpMessage.subject}</p>}
              <p dir={textDirection(insights.language)} lang={insights.language} className="mt-1 whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">
                {insights.followUpMessage.text}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copyText(insights.followUpMessage.text)}>
                  <Copy aria-hidden="true" /> Copy
                </Button>
                {wa && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={wa} target="_blank" rel="noopener noreferrer">
                      <MessageCircle aria-hidden="true" /> Open in WhatsApp
                    </a>
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Generated {formatDate(insights.generatedAt, true)} · {insights.model} · {insights.credits} credit{insights.credits === 1 ? '' : 's'}. Check facts before sending.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const GOAL_LABELS: Record<(typeof MESSAGE_GOALS)[number], string> = {
  follow_up: 'Follow up',
  reengage: 'Re-engage',
  thank_you: 'Say thank you',
  meeting_request: 'Ask for a meeting',
  offer: 'Mention an offer',
};

export function DraftMessageDialog({ contact, open, onOpenChange }: { contact: ContactDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const [channel, setChannel] = useState<DraftMessageInput['channel']>('whatsapp');
  const [goal, setGoal] = useState<DraftMessageInput['goal']>('follow_up');
  const [language, setLanguage] = useState<Lang | ''>('');
  const [context, setContext] = useState('');
  const lang = (language || org.data?.defaultLanguage || 'en') as Lang;
  const draft = useMutation({
    mutationFn: () => api.crm.contacts.draftMessage(contact.id, { channel, goal, language: lang, ...(context.trim() ? { context: context.trim() } : {}) }),
    onError: (e) => toast.error(aiError(e)),
  });
  const wa = draft.data && channel === 'whatsapp' ? whatsappLink(contact.whatsapp ?? contact.phone, draft.data.text) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Draft a message to ${contact.name}`} description="AI writes a short message from this contact's history. Nothing is sent: copy it or open it in WhatsApp.">
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            draft.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="draft-channel">Channel</Label>
              <Select id="draft-channel" value={channel} onChange={(e) => setChannel(e.target.value as DraftMessageInput['channel'])}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-goal">Goal</Label>
              <Select id="draft-goal" value={goal} onChange={(e) => setGoal(e.target.value as DraftMessageInput['goal'])}>
                {MESSAGE_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {GOAL_LABELS[g]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-language">Language</Label>
              <Select id="draft-language" value={lang} onChange={(e) => setLanguage(e.target.value as Lang)}>
                {COPY_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-context">Anything to include? (optional)</Label>
            <Input id="draft-context" maxLength={500} value={context} onChange={(e) => setContext(e.target.value)} placeholder="e.g. Our new branch in Kakkanad opens Monday" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={draft.isPending}>
              {draft.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />} Draft message
            </Button>
          </div>
        </form>
        {draft.data && (
          <div className="mt-4 space-y-2" aria-live="polite">
            {draft.data.subject && <p className="text-sm font-medium">Subject: {draft.data.subject}</p>}
            <p dir={textDirection(draft.data.language)} lang={draft.data.language} className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">
              {draft.data.text}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void copyText(draft.data.subject ? `${draft.data.subject}\n\n${draft.data.text}` : draft.data.text)}>
                <Copy aria-hidden="true" /> Copy
              </Button>
              {wa && (
                <Button size="sm" variant="outline" asChild>
                  <a href={wa} target="_blank" rel="noopener noreferrer">
                    <MessageCircle aria-hidden="true" /> Open in WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Settings ─────────────

const WEIGHT_STEPS = [0, 0.5, 1, 1.5, 2, 3];

export function ScoringSettingsPanel() {
  const qc = useQueryClient();
  const access = useCrmAccess();
  const settings = useQuery({ queryKey: ['crm', 'scoring', 'settings'], queryFn: api.crm.scoring.settings });
  if (settings.isPending) return <Skeleton className="h-96" />;
  if (settings.isError) return <ErrorState description="Couldn't load scoring settings." onRetry={() => void settings.refetch()} />;
  return (
    <ScoringForm
      key={JSON.stringify(settings.data)}
      initial={settings.data}
      readOnly={!access.canDelete}
      onSaved={async (s) => {
        qc.setQueryData(['crm', 'scoring', 'settings'], s);
        await qc.invalidateQueries({ queryKey: ['crm'] });
      }}
    />
  );
}

function ScoringForm({ initial, readOnly, onSaved }: { initial: ScoringSettings; readOnly: boolean; onSaved: (s: ScoringSettings) => Promise<void> }) {
  const [weights, setWeights] = useState<Partial<Record<ScoringSignal, number>>>(initial.weights);
  const [industries, setIndustries] = useState(listToText(initial.targetIndustries));
  const [cities, setCities] = useState(listToText(initial.targetCities));
  const [keywords, setKeywords] = useState(listToText(initial.decisionMakerKeywords));
  const [hot, setHot] = useState(String(initial.hotThreshold));
  const [warm, setWarm] = useState(String(initial.warmThreshold));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const saved = await api.crm.scoring.updateSettings({
        weights,
        targetIndustries: textToList(industries, 30),
        targetCities: textToList(cities, 50),
        decisionMakerKeywords: textToList(keywords, 40),
        hotThreshold: Number(hot),
        warmThreshold: Number(warm),
      });
      await api.crm.scoring.recalculate();
      return saved;
    },
    onSuccess: async (s) => {
      setError(null);
      toast.success('Scoring saved. Recalculating all leads…');
      await onSaved(s);
    },
    onError: (e) => setError(describeError(e)),
  });
  const groups = ['Fit', 'Engagement', 'Risk'] as const;
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {readOnly && <Alert tone="info">Only owners, admins and CRM managers can change scoring.</Alert>}
      <Card>
        <CardContent className="space-y-5 p-5">
          <div>
            <h2 className="text-lg font-semibold">Signal weights</h2>
            <p className="text-sm text-muted-foreground">Each lead’s score (0–100) adds up these signals. Turn a signal off, or make it count more.</p>
          </div>
          {groups.map((g) => (
            <fieldset key={g} className="space-y-3">
              <legend className="text-sm font-semibold">{g}</legend>
              {SCORING_SIGNALS.filter((s) => SIGNAL_INFO[s].group === g).map((s) => {
                const w = weights[s] ?? 1;
                const idx = Math.max(0, WEIGHT_STEPS.indexOf(w));
                return (
                  <div key={s} className="grid items-center gap-2 sm:grid-cols-[14rem_1fr_4rem]">
                    <Label htmlFor={`w-${s}`} className="font-normal">
                      <span className="block font-medium">{SIGNAL_INFO[s].label}</span>
                      <span className="block text-xs text-muted-foreground">{SIGNAL_INFO[s].description}</span>
                    </Label>
                    <input
                      id={`w-${s}`}
                      type="range"
                      min={0}
                      max={WEIGHT_STEPS.length - 1}
                      step={1}
                      value={idx}
                      disabled={readOnly}
                      aria-valuetext={weightLabel(w)}
                      onChange={(e) => setWeights((x) => ({ ...x, [s]: WEIGHT_STEPS[Number(e.target.value)]! }))}
                      className="w-full accent-[var(--color-primary)]"
                    />
                    <span className="text-right text-sm tabular-nums">{weightLabel(w)}</span>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">Your ideal customer</h2>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sc-industries">Target industries</Label>
            <Input id="sc-industries" disabled={readOnly} value={industries} onChange={(e) => setIndustries(e.target.value)} placeholder="e.g. Retail, Distribution, Healthcare" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sc-cities">Target cities</Label>
            <Input id="sc-cities" disabled={readOnly} value={cities} onChange={(e) => setCities(e.target.value)} placeholder="e.g. Kochi, Thrissur, Dubai, Sharjah" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sc-keywords">Decision-maker job titles</Label>
            <Input id="sc-keywords" disabled={readOnly} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
            <p className="text-xs text-muted-foreground">Comma separated. Whole words are matched (“MD” matches “MD, Sales” but not “Cmdr”).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-hot">Hot from score</Label>
            <Input id="sc-hot" type="number" min={2} max={100} disabled={readOnly} value={hot} onChange={(e) => setHot(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-warm">Warm from score</Label>
            <Input id="sc-warm" type="number" min={1} max={99} disabled={readOnly} value={warm} onChange={(e) => setWarm(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      {error && <Alert>{error}</Alert>}
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Save and recalculate all leads
          </Button>
        </div>
      )}
    </form>
  );
}
