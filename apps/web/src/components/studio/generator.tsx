'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Alert, Button, Card, CardContent, cn, Label, Select } from '@zatma/ui';
import { DESIGN_LANGUAGES, SIZE_PRESET_IDS, SIZE_PRESETS, type GenerateDesignInput, type SizePresetId } from '@zatma/validation';
import { api } from '@/lib/api';
import { LANGUAGE_LABELS } from '@/lib/options';

export interface ExamplePrompt {
  label: string;
  prompt: string;
  language?: GenerateDesignInput['language'];
  sizePreset?: SizePresetId;
  occasion?: string;
}

export const DESIGN_EXAMPLES: ExamplePrompt[] = [
  {
    label: 'ZatGo Van Sales ERP (Malayalam)',
    prompt: 'Create a Malayalam advertisement for ZatGo Van Sales ERP. Highlight 1 month free, monthly subscription, and WhatsApp contact. Use a modern blue enterprise design.',
    language: 'ml',
  },
  { label: 'Restaurant weekend offer', prompt: 'Weekend family dinner offer for a Kerala seafood restaurant: 20% off on all combos, Friday to Sunday. Warm, appetising look.' },
  { label: 'Real estate launch (Arabic)', prompt: 'Launch of luxury 2 and 3 bedroom apartments in Dubai Marina with sea views and a flexible payment plan. Elegant gold and navy style.', language: 'ar' },
  { label: 'Clinic health check', prompt: 'Full body health check-up package for AED 199 at a family clinic, book by phone or WhatsApp. Clean, trustworthy medical style.', sizePreset: 'facebook_post' },
];

/** Rough credit estimate shown before generating (the server meters actual usage). */
export const estimateCredits = (withImage: boolean) => ({ min: 1, max: 2 + (withImage ? 4 : 0), image: withImage ? 4 : 0 });

const describeError = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'PLAN_LIMIT_REACHED') return 'You have used all AI credits for this period. Upgrade your plan for more.';
    if (e.code === 'AI_PROVIDER_UNAVAILABLE') return 'No AI text provider is configured on the server yet. An administrator needs to add a provider API key.';
    return e.message;
  }
  return (e as Error).message;
};

export function DesignGenerator({
  examples = DESIGN_EXAMPLES,
  occasions,
  defaultSize = 'instagram_post',
  heading = 'Describe your design',
  placeholder = 'e.g. Onam sale poster for a textile shop: 30% off sarees, 1–15 September, call or WhatsApp to order.',
}: {
  examples?: ExamplePrompt[];
  occasions?: string[];
  defaultSize?: SizePresetId;
  heading?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const uid = useId();
  const [prompt, setPrompt] = useState('');
  const [sizePreset, setSizePreset] = useState<SizePresetId>(defaultSize);
  const [language, setLanguage] = useState<GenerateDesignInput['language']>('en');
  const [brandKitId, setBrandKitId] = useState<string>('');
  const [aiBackground, setAiBackground] = useState(true);
  const [occasion, setOccasion] = useState<string | undefined>(undefined);

  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: api.ai.providers });
  const kits = useQuery({ queryKey: ['brand-kits'], queryFn: api.brandKits.list });

  const perms = new Set(org.data?.permissions ?? []);
  const canGenerate = perms.has('design:write') && perms.has('ai:generate');
  const hasText = providers.data?.some((p) => p.implemented && p.capabilities.includes('TEXT')) ?? false;
  const hasImage = providers.data?.some((p) => p.implemented && p.capabilities.includes('IMAGE')) ?? false;
  const withImage = aiBackground && hasImage;
  const credits = estimateCredits(withImage);

  const generate = useMutation({
    mutationFn: () =>
      api.designs.generate({
        prompt: prompt.trim(),
        sizePreset,
        language,
        brandKitId: brandKitId || null,
        aiBackground: withImage,
        ...(occasion ? { occasion } : {}),
      }),
    onSuccess: async ({ design }) => {
      await qc.invalidateQueries({ queryKey: ['designs'] });
      await qc.invalidateQueries({ queryKey: ['ai', 'usage'] });
      router.push(`/studio/design/${design.id}`);
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const tooShort = prompt.trim().length < 8;

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        {providers.isSuccess && !hasText && (
          <Alert tone="info">
            AI generation is not available yet: no text provider is configured on the server. You can still{' '}
            <Link href="/studio/templates" className="underline">
              start from a template
            </Link>{' '}
            or a blank design.
          </Alert>
        )}
        {org.isSuccess && !canGenerate && <Alert tone="info">Your role can view designs but not generate them. Ask an admin for the Designer or Marketing Manager role.</Alert>}

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort && canGenerate && hasText) generate.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${uid}-prompt`} className="text-base">
              {heading}
            </Label>
            <textarea
              id={`${uid}-prompt`}
              rows={4}
              maxLength={2000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-2" aria-label="Example prompts">
              {examples.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => {
                    setPrompt(ex.prompt);
                    if (ex.language) setLanguage(ex.language);
                    if (ex.sizePreset) setSizePreset(ex.sizePreset);
                    if (ex.occasion) setOccasion(ex.occasion);
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Sparkles className="mr-1 inline size-3" aria-hidden="true" />
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          {occasions && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Occasion</legend>
              <div className="flex flex-wrap gap-2">
                {occasions.map((o) => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={occasion === o}
                    onClick={() => setOccasion(occasion === o ? undefined : o)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      occasion === o ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Size</legend>
            <div className="flex flex-wrap gap-2">
              {SIZE_PRESET_IDS.map((id) => {
                const p = SIZE_PRESETS[id];
                const active = sizePreset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSizePreset(id)}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                    )}
                  >
                    <span aria-hidden="true" className="inline-block shrink-0 rounded-sm border border-current opacity-60" style={{ width: 18 * Math.min(1, p.width / p.height), height: 18 * Math.min(1, p.height / p.width) }} />
                    <span>
                      <span className="block font-medium">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.width}×{p.height}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-lang`}>Language</Label>
              <Select id={`${uid}-lang`} value={language} onChange={(e) => setLanguage(e.target.value as GenerateDesignInput['language'])}>
                {DESIGN_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-kit`}>Brand kit</Label>
              <Select id={`${uid}-kit`} value={brandKitId} onChange={(e) => setBrandKitId(e.target.value)}>
                <option value="">{kits.data?.some((k) => k.isDefault) ? 'Default brand kit' : 'No brand kit'}</option>
                {kits.data?.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                    {k.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
              {kits.isSuccess && kits.data.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  <Link href="/studio/brand-kit" className="text-primary underline-offset-2 hover:underline">
                    Create a brand kit
                  </Link>{' '}
                  to apply your logo, colours and contact details.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium" id={`${uid}-bg-label`}>
                Background
              </span>
              <label className={cn('flex h-10 items-center gap-2 rounded-xl border border-input px-3 text-sm', !hasImage && 'opacity-60')}>
                <input type="checkbox" checked={withImage} disabled={!hasImage} onChange={(e) => setAiBackground(e.target.checked)} aria-describedby={`${uid}-bg-help`} className="size-4 accent-[var(--color-primary)]" />
                AI background image
              </label>
              <p id={`${uid}-bg-help`} className="text-xs text-muted-foreground">
                {hasImage ? 'Text is never baked into the image; it stays editable.' : 'No image provider configured; a brand gradient is used.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Estimated cost: about {credits.min}–{credits.max} AI credits{credits.image ? ` (includes ${credits.image} for the background)` : ''}.
            </p>
            <Button type="submit" size="lg" disabled={generate.isPending || tooShort || !canGenerate || !hasText}>
              {generate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
              Generate design
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
