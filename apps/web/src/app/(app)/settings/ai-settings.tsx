'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Label, Meter, Select, Skeleton } from '@zatma/ui';
import type { TextGenerationResponse } from '@zatma/types';
import { LANGUAGES, type AISettingsInput, type GenerateTextInput } from '@zatma/validation';
import { api } from '@/lib/api';
import { LANGUAGE_LABELS } from '@/lib/options';

const describeError = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'PLAN_LIMIT_REACHED') return 'You have used all AI credits for this period. Upgrade your plan for more.';
    return e.message;
  }
  return (e as Error).message;
};

function Playground() {
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState<GenerateTextInput['language']>('en');
  const [result, setResult] = useState<TextGenerationResponse | null>(null);
  const qc = useQueryClient();

  const generate = useMutation({
    mutationFn: () => api.ai.generateText({ prompt, language, purpose: 'playground', maxOutputTokens: 1000 }),
    onSuccess: async (r) => {
      setResult(r);
      await qc.invalidateQueries({ queryKey: ['ai', 'usage'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden="true" /> Try it
        </CardTitle>
        <CardDescription>Send a short prompt through your organization&apos;s provider chain. Uses AI credits.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim().length >= 3) generate.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ai-prompt">Prompt</Label>
            <textarea
              id="ai-prompt"
              rows={3}
              maxLength={2000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Write a short Instagram caption for a Kerala supermarket Onam sale with 30% off."
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="ai-language">Language</Label>
              <Select id="ai-language" value={language} onChange={(e) => setLanguage(e.target.value as GenerateTextInput['language'])}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={generate.isPending || prompt.trim().length < 3}>
              {generate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              Generate
            </Button>
          </div>
        </form>
        {result && (
          <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/40 p-4" aria-live="polite">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.text}</p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge tone="primary">{result.provider}</Badge>
              <Badge>{result.model}</Badge>
              <Badge>
                {result.credits} credit{result.credits === 1 ? '' : 's'}
              </Badge>
              {result.fallbackFrom.length > 0 && <Badge tone="warning">fell back from {result.fallbackFrom.join(', ')}</Badge>}
              {result.finishReason === 'length' && <Badge tone="warning">truncated</Badge>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AISettings() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: api.ai.providers });
  const settings = useQuery({ queryKey: ['ai', 'settings'], queryFn: api.ai.settings });
  const usage = useQuery({ queryKey: ['ai', 'usage'], queryFn: api.ai.usage });
  const perms = new Set(org.data?.permissions ?? []);

  const save = useMutation({
    mutationFn: (input: AISettingsInput) => api.ai.updateSettings(input),
    onSuccess: (data) => {
      qc.setQueryData(['ai', 'settings'], data);
      toast.success('AI preferences saved');
    },
    onError: (e) => toast.error(describeError(e)),
  });

  if (providers.isPending || settings.isPending) return <Skeleton className="h-96" />;
  if (providers.isError || settings.isError) {
    return <ErrorState description="Couldn't load AI settings." onRetry={() => void Promise.all([providers.refetch(), settings.refetch()])} />;
  }

  const active = providers.data.filter((p) => p.implemented);
  const textProviders = active.filter((p) => p.models.TEXT);
  const imageProviders = active.filter((p) => p.models.IMAGE);
  const nameOf = (id: string) => providers.data.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        {active.length === 0 ? (
          <EmptyState
            icon={<Bot />}
            title="AI generation isn't enabled yet"
            description="No AI provider keys are configured on this deployment. Once the platform administrator adds an Anthropic, OpenAI or Gemini key, generation turns on automatically."
          />
        ) : perms.has('ai:generate') ? (
          <Playground />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>Requests go to the first provider; if it is unavailable, the next one is tried automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {providers.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {Object.entries(p.models)
                        .map(([cap, model]) => `${cap.toLowerCase()}: ${model}`)
                        .join(' · ') || p.capabilities.map((c) => c.toLowerCase()).join(' · ')}
                    </p>
                  </div>
                  <Badge tone={p.implemented ? 'success' : 'neutral'}>{p.implemented ? 'Active' : 'Not configured'}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {active.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>Choose which provider your organization tries first.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['textProvider', 'Text (copy, captions, briefs)', textProviders, settings.data.textOrder],
                  ['imageProvider', 'Images (design backgrounds)', imageProviders, settings.data.imageOrder],
                ] as const
              ).map(([key, label, options, order]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`ai-${key}`}>{label}</Label>
                  <Select
                    id={`ai-${key}`}
                    disabled={!perms.has('organization:update') || save.isPending || options.length === 0}
                    value={settings.data[key] ?? ''}
                    onChange={(e) => save.mutate({ [key]: e.target.value || null })}
                  >
                    <option value="">Platform default</option>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">{order.length ? `Order: ${order.map(nameOf).join(' → ')}` : 'No provider available'}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Usage this period</CardTitle>
          <CardDescription>{usage.data ? `Since ${new Date(usage.data.periodStart).toLocaleDateString()}` : 'AI credits'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usage.isPending && <Skeleton className="h-24" />}
          {usage.isError && <Alert>Couldn&apos;t load usage.</Alert>}
          {usage.data && (
            <>
              <Meter label="AI credits" used={usage.data.credits.used} limit={usage.data.credits.limit} />
              {usage.data.byProvider.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI requests yet this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Provider</th>
                      <th className="py-1 text-right font-medium">Requests</th>
                      <th className="py-1 text-right font-medium">Credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {usage.data.byProvider.map((r) => (
                      <tr key={`${r.provider}-${r.capability}`}>
                        <td className="py-1.5">
                          {nameOf(r.provider)} <span className="text-xs text-muted-foreground">{r.capability.toLowerCase()}</span>
                        </td>
                        <td className="py-1.5 text-right">
                          {r.requests}
                          {r.failures > 0 && <span className="text-xs text-muted-foreground"> ({r.failures} failed)</span>}
                        </td>
                        <td className="py-1.5 text-right">{r.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-xs text-muted-foreground">
                Text uses 1 credit per 4,000 tokens; each image uses 4 credits.{' '}
                <Link href="/billing" className="font-medium text-primary hover:underline">
                  Plans &amp; limits
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
