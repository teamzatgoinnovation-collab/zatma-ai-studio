'use client';

import { useMutation } from '@tanstack/react-query';
import { Languages, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Button, Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Label, Select } from '@zatma/ui';
import { COPY_LANGUAGES, type DesignDetail, type RewriteAction } from '@zatma/validation';
import { api } from '@/lib/api';
import { LANGUAGE_LABELS } from '@/lib/options';
import { CustomRewriteDialog } from '@/components/studio/copywriter';
import { REWRITE_MENU } from '@/components/studio/copy-helpers';

const describeError = (e: unknown) => {
  if (e instanceof ApiError) return e.code === 'PLAN_LIMIT_REACHED' ? 'You have used all AI credits for this period.' : e.message;
  return (e as Error).message;
};

/** "Rewrite with AI" for a text layer; the result is applied as a normal (undoable) edit. */
export function AiRewriteMenu({ text, language, disabled, onApply }: { text: string; language: string; disabled: boolean; onApply: (text: string) => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const rewrite = useMutation({
    mutationFn: (args: { action: RewriteAction; instruction?: string }) => api.copy.rewrite({ text, language: language as (typeof COPY_LANGUAGES)[number], ...args }),
    onSuccess: (r) => {
      onApply(r.text);
      setCustomOpen(false);
      toast.success('Text rewritten. Press Ctrl+Z to undo.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="w-full" disabled={disabled || rewrite.isPending || !text.trim()}>
            {rewrite.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />} Rewrite with AI
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
      <CustomRewriteDialog open={customOpen} onOpenChange={setCustomOpen} busy={rewrite.isPending} onSubmit={(instruction) => rewrite.mutate({ action: 'custom', instruction })} />
    </>
  );
}

/** Creates a translated copy of the design and hands it back (the editor then opens it). */
export function TranslateDesignDialog({
  open,
  onOpenChange,
  designId,
  currentLanguage,
  flush,
  onTranslated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  designId: string;
  currentLanguage: string;
  flush: () => Promise<boolean>;
  onTranslated: (d: DesignDetail) => void;
}) {
  const options = COPY_LANGUAGES.filter((l) => l !== currentLanguage);
  const [language, setLanguage] = useState<string>(options[0] ?? 'en');
  const translate = useMutation({
    mutationFn: async () => {
      if (!(await flush())) throw new Error('Save your changes first, then try again.');
      return api.designs.translate(designId, language);
    },
    onSuccess: (d) => {
      toast.success(`Created “${d.title}”`);
      onTranslated(d);
    },
    onError: (e) => toast.error(describeError(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Translate design"
        description="Creates a new copy with every text layer, the caption and hashtags localised. Fonts and text direction switch for the language; this design is not changed."
      >
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            translate.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="translate-language">Language</Label>
            <Select id="translate-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {options.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={translate.isPending}>
              {translate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Languages aria-hidden="true" />} Translate
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
