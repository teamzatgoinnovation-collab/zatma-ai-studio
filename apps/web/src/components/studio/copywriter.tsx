'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Copy, Languages, Loader2, Pencil, RefreshCw, Search, Sparkles, Star, Trash2, Undo2, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useId, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Select,
  Skeleton,
  Tabs,
} from '@zatma/ui';
import {
  COPY_GOALS,
  COPY_KIND_INFO,
  COPY_KINDS,
  COPY_LANGUAGES,
  COPY_PLATFORM_LABELS,
  COPY_PLATFORMS,
  COPY_TONES,
  type CopyAssetDto,
  type CopyKind,
  type CopyPlatform,
  type CopyTranslation,
  type CopyVariant,
  type GenerateCopyInput,
  type RewriteAction,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { LANGUAGE_LABELS } from '@/lib/options';
import { clipboardText, limitStatus, REWRITE_MENU, textDirection, titleCase } from './copy-helpers';

type Language = GenerateCopyInput['language'];

const describeError = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'PLAN_LIMIT_REACHED') return 'You have used all AI credits for this period. Upgrade your plan for more.';
    if (e.code === 'AI_PROVIDER_UNAVAILABLE') return 'No AI text provider is configured on the server yet.';
    return e.message;
  }
  return (e as Error).message;
};

async function copyToClipboard(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error('Copy failed. Select the text and copy it manually.');
  }
}

export const COPY_EXAMPLES: Array<{ label: string; brief: string; kind: CopyKind; language: Language }> = [
  {
    label: 'ZatGo Van Sales ERP (Malayalam)',
    brief: 'ZatGo Van Sales ERP for distributors: 1 month free, then a monthly subscription. Contact us on WhatsApp. Modern, trustworthy enterprise brand.',
    kind: 'caption',
    language: 'ml',
  },
  { label: 'Onam saree sale', brief: 'Onam sale at our textile showroom: up to 30% off on silk sarees and kasavu mundu until 15 September.', kind: 'ad_primary_text', language: 'en' },
  { label: 'Clinic WhatsApp reminder', brief: 'Friendly reminder that our full body health check-up package is AED 199 this month; reply to book a slot.', kind: 'whatsapp_message', language: 'ar' },
];

function useCopyPermissions() {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const perms = new Set(org.data?.permissions ?? []);
  return { canWrite: perms.has('copy:write'), canGenerate: perms.has('copy:write') && perms.has('ai:generate'), loaded: org.isSuccess };
}

// ───────────── Root ─────────────

export function Copywriter() {
  const [tab, setTab] = useState<'write' | 'library'>('write');
  return (
    <div className="space-y-6">
      <Tabs
        label="Copywriter"
        withPanels
        items={[
          { id: 'write', label: 'Write' },
          { id: 'library', label: 'Library' },
        ]}
        value={tab}
        onChange={(t) => setTab(t as 'write' | 'library')}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'write' ? <WriteTab /> : <LibraryTab />}
      </div>
    </div>
  );
}

// ───────────── Write ─────────────

interface Request {
  kind: CopyKind;
  platform: CopyPlatform;
  language: Language;
  tone: GenerateCopyInput['tone'];
  goal: GenerateCopyInput['goal'];
  brief: string;
  audience?: string;
}

function WriteTab() {
  const uid = useId();
  const qc = useQueryClient();
  const { canGenerate, loaded } = useCopyPermissions();
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: api.ai.providers });
  const kits = useQuery({ queryKey: ['brand-kits'], queryFn: api.brandKits.list });
  const hasText = providers.data?.some((p) => p.implemented && p.capabilities.includes('TEXT')) ?? false;

  const [kind, setKind] = useState<CopyKind>('caption');
  const [platform, setPlatform] = useState<CopyPlatform>(COPY_KIND_INFO.caption.defaultPlatform);
  const [brief, setBrief] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [tone, setTone] = useState<GenerateCopyInput['tone']>('friendly');
  const [goal, setGoal] = useState<GenerateCopyInput['goal']>('sales');
  const [audience, setAudience] = useState('');
  const [keywords, setKeywords] = useState('');
  const [brandKitId, setBrandKitId] = useState('');
  const [variants, setVariants] = useState(3);
  const [includeEmojis, setIncludeEmojis] = useState(true);
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [result, setResult] = useState<{ request: Request; variants: CopyVariant[]; meta: string } | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      api.copy.generate({
        kind,
        brief: brief.trim(),
        language,
        tone,
        platform,
        goal,
        audience: audience.trim() || undefined,
        keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 10),
        brandKitId: brandKitId || null,
        variants,
        includeEmojis,
        includeHashtags,
      }),
    onSuccess: async (r) => {
      setResult({ request: { kind, platform, language, tone, goal, brief: brief.trim(), audience: audience.trim() || undefined }, variants: r.variants, meta: `${r.provider} · ${r.model} · ${r.credits} credit${r.credits === 1 ? '' : 's'}` });
      await qc.invalidateQueries({ queryKey: ['ai', 'usage'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const tooShort = brief.trim().length < 10;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <Card>
        <CardContent className="space-y-5 p-5">
          {providers.isSuccess && !hasText && <Alert tone="info">AI writing is not available yet: no text provider is configured on the server.</Alert>}
          {loaded && !canGenerate && <Alert tone="info">Your role can read saved copy but not generate it.</Alert>}
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!tooShort && canGenerate && hasText) generate.mutate();
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What do you need?</legend>
              <div className="flex flex-wrap gap-1.5">
                {COPY_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    title={COPY_KIND_INFO[k].description}
                    onClick={() => {
                      setKind(k);
                      setPlatform(COPY_KIND_INFO[k].defaultPlatform);
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      kind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                    )}
                  >
                    {COPY_KIND_INFO[k].label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor={`${uid}-brief`}>Describe the product, offer or message</Label>
              <textarea
                id={`${uid}-brief`}
                rows={4}
                maxLength={2000}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. Vishu offer at our jewellery store: no making charges on gold ornaments, 10–20 April. Call or WhatsApp to reserve."
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex flex-wrap gap-2" aria-label="Example briefs">
                {COPY_EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => {
                      setBrief(ex.brief);
                      setKind(ex.kind);
                      setPlatform(COPY_KIND_INFO[ex.kind].defaultPlatform);
                      setLanguage(ex.language);
                    }}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Sparkles className="mr-1 inline size-3" aria-hidden="true" />
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`${uid}-lang`} label="Language">
                <Select id={`${uid}-lang`} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                  {COPY_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`${uid}-platform`} label="Platform">
                <Select id={`${uid}-platform`} value={platform} onChange={(e) => setPlatform(e.target.value as CopyPlatform)}>
                  {COPY_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {COPY_PLATFORM_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`${uid}-tone`} label="Tone">
                <Select id={`${uid}-tone`} value={tone} onChange={(e) => setTone(e.target.value as GenerateCopyInput['tone'])}>
                  {COPY_TONES.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`${uid}-goal`} label="Goal">
                <Select id={`${uid}-goal`} value={goal} onChange={(e) => setGoal(e.target.value as GenerateCopyInput['goal'])}>
                  {COPY_GOALS.map((g) => (
                    <option key={g} value={g}>
                      {titleCase(g)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`${uid}-audience`} label="Audience (optional)">
                <Input id={`${uid}-audience`} maxLength={200} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. FMCG distributors in Kerala" />
              </Field>
              <Field id={`${uid}-keywords`} label="Keywords (comma separated)">
                <Input id={`${uid}-keywords`} maxLength={300} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. free trial, GST billing" />
              </Field>
              <Field id={`${uid}-kit`} label="Brand kit">
                <Select id={`${uid}-kit`} value={brandKitId} onChange={(e) => setBrandKitId(e.target.value)}>
                  <option value="">{kits.data?.some((k) => k.isDefault) ? 'Default brand kit' : 'No brand kit'}</option>
                  {kits.data?.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`${uid}-variants`} label="Variants">
                <Select id={`${uid}-variants`} value={variants} onChange={(e) => setVariants(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={includeEmojis} onChange={(e) => setIncludeEmojis(e.target.checked)} /> Emojis
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={includeHashtags} onChange={(e) => setIncludeHashtags(e.target.checked)} /> Hashtags
              </label>
            </div>
            {kits.isSuccess && kits.data.length === 0 && (
              <p className="text-xs text-muted-foreground">
                <Link href="/studio/brand-kit" className="text-primary underline-offset-2 hover:underline">
                  Add a brand kit
                </Link>{' '}
                so the AI can use your website, phone and guidelines.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">About 1–{variants > 3 ? 3 : 2} AI credits.</p>
              <Button type="submit" disabled={generate.isPending || tooShort || !canGenerate || !hasText}>
                {generate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
                Write copy
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="results-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="results-heading" className="text-lg font-semibold">
            Variants
          </h2>
          {result && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{result.meta}</span>
              <Button size="sm" variant="outline" disabled={generate.isPending || !canGenerate} onClick={() => generate.mutate()}>
                <RefreshCw aria-hidden="true" /> Regenerate
              </Button>
            </div>
          )}
        </div>
        {generate.isPending && !result ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: variants }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : result ? (
          <ul className="space-y-3" aria-live="polite">
            {result.variants.map((v, i) => (
              <li key={`${i}-${v.text.slice(0, 20)}`}>
                <VariantCard index={i} variant={v} request={result.request} siblings={result.variants.map((x) => x.text)} canWrite={canGenerate} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Sparkles />} title="Your copy appears here" description="Pick what you need, describe the offer and the language, then select Write copy. Each variant takes a different angle." />
        )}
      </section>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function LimitBadge({ variant }: { variant: CopyVariant }) {
  const s = limitStatus(variant.limits);
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <Badge tone={s.tone === 'danger' ? 'danger' : s.tone === 'warning' ? 'warning' : 'neutral'}>{s.label}</Badge>
      {s.detail && <span className={cn(s.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground')}>{s.detail}</span>}
    </span>
  );
}

function VariantCard({ index, variant, request, siblings, canWrite }: { index: number; variant: CopyVariant; request: Request; siblings: string[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState(variant.text);
  const [previous, setPrevious] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const rewrite = useMutation({
    mutationFn: (args: { action: RewriteAction; instruction?: string }) => api.copy.rewrite({ text, language: request.language, ...args }),
    onSuccess: (r) => {
      setPrevious(text);
      setText(r.text);
      setSaved(false);
      setCustomOpen(false);
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const save = useMutation({
    mutationFn: () =>
      api.copyAssets.save({ kind: request.kind, content: text, hashtags: variant.hashtags, language: request.language, tone: request.tone, platform: request.platform, goal: request.goal, brief: request.brief, audience: request.audience, variants: siblings }),
    onSuccess: async () => {
      setSaved(true);
      toast.success('Saved to your copy library');
      await qc.invalidateQueries({ queryKey: ['copy-assets'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const dir = textDirection(request.language);
  const limits = text === variant.text ? variant.limits : null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variant {index + 1}</span>
          {limits ? <LimitBadge variant={variant} /> : <Badge>Rewritten</Badge>}
        </div>
        <p dir={dir} lang={request.language} className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {text}
        </p>
        {variant.hashtags.length > 0 && (
          <p className="text-sm text-primary" dir="auto">
            {variant.hashtags.join(' ')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void copyToClipboard(clipboardText(text, variant.hashtags), 'Copied to clipboard')}>
            <Copy aria-hidden="true" /> Copy
          </Button>
          {canWrite && (
            <>
              <Button size="sm" variant="outline" disabled={save.isPending || saved} onClick={() => save.mutate()}>
                <Bookmark aria-hidden="true" /> {saved ? 'Saved' : 'Save'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={rewrite.isPending}>
                    {rewrite.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Pencil aria-hidden="true" />} Rewrite
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {REWRITE_MENU.map((m) => (
                    <DropdownMenuItem key={m.action} onSelect={() => rewrite.mutate({ action: m.action })}>
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setCustomOpen(true)}>Custom instruction…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() => setTranslateOpen(true)}>
                <Languages aria-hidden="true" /> Translate
              </Button>
              {previous !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setText(previous);
                    setPrevious(null);
                  }}
                >
                  <Undo2 aria-hidden="true" /> Undo rewrite
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
      <CustomRewriteDialog open={customOpen} onOpenChange={setCustomOpen} busy={rewrite.isPending} onSubmit={(instruction) => rewrite.mutate({ action: 'custom', instruction })} />
      <TranslateDialog open={translateOpen} onOpenChange={setTranslateOpen} text={text} hashtags={variant.hashtags} sourceLanguage={request.language} kind={request.kind} platform={request.platform} />
    </Card>
  );
}

export function CustomRewriteDialog({ open, onOpenChange, busy, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onSubmit: (instruction: string) => void }) {
  const [instruction, setInstruction] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Rewrite with your instruction" description="Say what to change. Facts, numbers and links are kept.">
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim().length >= 3) onSubmit(instruction.trim());
          }}
        >
          <Label htmlFor="rewrite-instruction">Instruction</Label>
          <Input id="rewrite-instruction" maxLength={300} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Mention free home delivery and end with a question" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || instruction.trim().length < 3}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />} Rewrite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TranslateDialog({
  open,
  onOpenChange,
  text,
  hashtags,
  sourceLanguage,
  kind,
  platform,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  text: string;
  hashtags: string[];
  sourceLanguage: Language;
  kind: CopyKind;
  platform: CopyPlatform;
}) {
  const qc = useQueryClient();
  const [targets, setTargets] = useState<Language[]>([]);
  const [results, setResults] = useState<CopyTranslation[] | null>(null);
  const translate = useMutation({
    mutationFn: () => api.copy.translate({ text, hashtags, sourceLanguage, targetLanguages: targets }),
    onSuccess: (r) => setResults(r.translations),
    onError: (e) => toast.error(describeError(e)),
  });
  const save = useMutation({
    mutationFn: (t: CopyTranslation) => api.copyAssets.save({ kind, content: t.text, hashtags: t.hashtags, language: t.language as Language, platform }),
    onSuccess: async () => {
      toast.success('Translation saved');
      await qc.invalidateQueries({ queryKey: ['copy-assets'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const options = COPY_LANGUAGES.filter((l) => l !== sourceLanguage);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setResults(null);
      }}
    >
      <DialogContent title="Translate" description="Localised for each language. Brand names, prices, phone numbers and links are kept.">
        {!results ? (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (targets.length) translate.mutate();
            }}
          >
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-2 text-sm font-medium">Languages</legend>
              {options.map((l) => (
                <label key={l} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={targets.includes(l)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, l] : t.filter((x) => x !== l)))} />
                  {LANGUAGE_LABELS[l]}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={translate.isPending || targets.length === 0}>
                {translate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Languages aria-hidden="true" />} Translate
              </Button>
            </div>
          </form>
        ) : (
          <ul className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
            {results.map((t) => (
              <li key={t.language} className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{LANGUAGE_LABELS[t.language as Language] ?? t.language}</p>
                <p dir={textDirection(t.language)} lang={t.language} className="whitespace-pre-wrap text-sm">
                  {t.text}
                </p>
                {t.hashtags.length > 0 && <p className="text-xs text-primary">{t.hashtags.join(' ')}</p>}
                {t.warnings.map((w) => (
                  <p key={w} className="text-xs text-warning-text">
                    ⚠ {w}
                  </p>
                ))}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copyToClipboard(clipboardText(t.text, t.hashtags), 'Copied to clipboard')}>
                    <Copy aria-hidden="true" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate(t)}>
                    <Bookmark aria-hidden="true" /> Save
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Library ─────────────

function LibraryTab() {
  const qc = useQueryClient();
  const uid = useId();
  const { canWrite } = useCopyPermissions();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const [kind, setKind] = useState('');
  const [language, setLanguage] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CopyAssetDto | null>(null);
  const [deleting, setDeleting] = useState<CopyAssetDto | null>(null);

  const list = useQuery({
    queryKey: ['copy-assets', { query, kind, language, favorites, page }],
    queryFn: () => api.copyAssets.list({ q: query || undefined, kind: kind || undefined, language: language || undefined, favorite: favorites ? 'true' : undefined, page, pageSize: 20 }),
  });
  const update = useMutation({
    mutationFn: (args: { id: string; content?: string; favorite?: boolean }) => api.copyAssets.update(args.id, { content: args.content, favorite: args.favorite }),
    onSuccess: async () => {
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ['copy-assets'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.copyAssets.remove(id),
    onSuccess: async () => {
      setDeleting(null);
      toast.success('Copy deleted');
      await qc.invalidateQueries({ queryKey: ['copy-assets'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <section className="space-y-4" aria-label="Saved copy">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Label htmlFor={`${uid}-q`} className="sr-only">
            Search copy
          </Label>
          <Input
            id={`${uid}-q`}
            type="search"
            placeholder="Search saved copy"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-48">
          <Label htmlFor={`${uid}-kind`} className="sr-only">
            Type
          </Label>
          <Select
            id={`${uid}-kind`}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {COPY_KINDS.map((k) => (
              <option key={k} value={k}>
                {COPY_KIND_INFO[k].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Label htmlFor={`${uid}-lang`} className="sr-only">
            Language
          </Label>
          <Select
            id={`${uid}-lang`}
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All languages</option>
            {COPY_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant={favorites ? 'secondary' : 'outline'}
          aria-pressed={favorites}
          onClick={() => {
            setFavorites((f) => !f);
            setPage(1);
          }}
        >
          <Star aria-hidden="true" /> Favourites
        </Button>
      </div>

      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : list.isError ? (
        <ErrorState description="Couldn't load saved copy." onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState icon={<Bookmark />} title={query || kind || language || favorites ? 'Nothing matches these filters' : 'No saved copy yet'} description="Save variants from the Write tab, or captions from a design, to reuse them in campaigns and posts." />
      ) : (
        <>
          <ul className="grid gap-3 lg:grid-cols-2">
            {list.data.data.map((a) => (
              <li key={a.id}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="primary">{COPY_KIND_INFO[a.kind]?.label ?? a.kind}</Badge>
                      <Badge>{LANGUAGE_LABELS[a.language as Language] ?? a.language}</Badge>
                      {a.platform !== 'generic' && <Badge>{COPY_PLATFORM_LABELS[a.platform as CopyPlatform] ?? a.platform}</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">{new Date(a.updatedAt).toLocaleDateString()}</span>
                    </div>
                    <p dir={textDirection(a.language)} lang={a.language} className="line-clamp-6 whitespace-pre-wrap text-sm">
                      {a.content}
                    </p>
                    {a.hashtags.length > 0 && <p className="text-xs text-primary">{a.hashtags.join(' ')}</p>}
                    <div className="mt-auto flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => void copyToClipboard(clipboardText(a.content, a.hashtags), 'Copied to clipboard')}>
                        <Copy aria-hidden="true" /> Copy
                      </Button>
                      {canWrite && (
                        <>
                          <Button size="sm" variant="ghost" aria-pressed={a.favorite} aria-label={a.favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => update.mutate({ id: a.id, favorite: !a.favorite })}>
                            <Star className={cn(a.favorite && 'fill-current text-warning')} aria-hidden="true" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                            <Pencil aria-hidden="true" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" aria-label="Delete copy" onClick={() => setDeleting(a)}>
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          {list.data.meta.totalPages > 1 && (
            <nav className="flex items-center justify-center gap-2" aria-label="Copy pages">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {list.data.meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= list.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </nav>
          )}
        </>
      )}

      <EditCopyDialog asset={editing} busy={update.isPending} onClose={() => setEditing(null)} onSave={(content) => editing && update.mutate({ id: editing.id, content })} />
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent title="Delete this copy?" description="It will be removed from your library.">
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EditCopyDialog({ asset, busy, onClose, onSave }: { asset: CopyAssetDto | null; busy: boolean; onClose: () => void; onSave: (content: string) => void }) {
  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit copy">{asset && <EditCopyForm key={asset.id} asset={asset} busy={busy} onCancel={onClose} onSave={onSave} />}</DialogContent>
    </Dialog>
  );
}

function EditCopyForm({ asset, busy, onCancel, onSave }: { asset: CopyAssetDto; busy: boolean; onCancel: () => void; onSave: (content: string) => void }) {
  const [content, setContent] = useState(asset.content);
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (content.trim()) onSave(content.trim());
      }}
    >
      <Label htmlFor="edit-copy">Text</Label>
      <textarea
        id="edit-copy"
        rows={8}
        maxLength={5000}
        dir={textDirection(asset.language)}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !content.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
