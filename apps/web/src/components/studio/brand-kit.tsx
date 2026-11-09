'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Star, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Badge, Button, Card, CardContent, cn, Dialog, DialogContent, EmptyState, ErrorState, FieldError, Input, Label, Select, Skeleton } from '@zatma/ui';
import { brandKitSchema, FONT_FAMILIES, type BrandKitDto, type BrandKitInput } from '@zatma/validation';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { ColorField } from '@/components/editor/panels';

const describeError = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

type FormState = Omit<BrandKitInput, 'workspaceId'> & { logoUrl: string | null };

export const EMPTY_KIT: FormState = {
  name: '',
  logoFileId: null,
  logoUrl: null,
  colors: { primary: '#1D4ED8', secondary: '#0F172A', accent: '#F59E0B', background: '#FFFFFF', text: '#0F172A' },
  fonts: { heading: 'Poppins', body: 'Inter' },
  tagline: '',
  website: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  guidelines: '',
};

const fromDto = (k: BrandKitDto): FormState => ({
  name: k.name,
  logoFileId: k.logoFileId,
  logoUrl: k.logoUrl,
  colors: k.colors,
  fonts: k.fonts,
  tagline: k.tagline ?? '',
  website: k.website ?? '',
  phone: k.phone ?? '',
  whatsapp: k.whatsapp ?? '',
  email: k.email ?? '',
  address: k.address ?? '',
  guidelines: k.guidelines ?? '',
});

/** Empty optional text fields are stored as null. */
export function toInput(f: FormState): BrandKitInput {
  const opt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    name: f.name.trim(),
    logoFileId: f.logoFileId ?? null,
    colors: f.colors,
    fonts: f.fonts,
    tagline: opt(f.tagline),
    website: opt(f.website),
    phone: opt(f.phone),
    whatsapp: opt(f.whatsapp),
    email: opt(f.email),
    address: opt(f.address),
    guidelines: opt(f.guidelines),
  };
}

const COLOR_LABELS: Array<[keyof BrandKitInput['colors'], string]> = [
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['accent', 'Accent (buttons)'],
  ['background', 'Background'],
  ['text', 'Text'],
];

export function BrandKitManager() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const kits = useQuery({ queryKey: ['brand-kits'], queryFn: api.brandKits.list });
  const canWrite = org.data?.permissions.includes('design:write') ?? false;
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [deleting, setDeleting] = useState<BrandKitDto | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['brand-kits'] });
  const setDefault = useMutation({ mutationFn: (id: string) => api.brandKits.setDefault(id), onSuccess: invalidate, onError: (e) => toast.error(describeError(e)) });
  const remove = useMutation({
    mutationFn: (id: string) => api.brandKits.remove(id),
    onSuccess: async () => {
      setDeleting(null);
      if (editing?.id === deleting?.id) setEditing(null);
      await invalidate();
      toast.success('Brand kit deleted');
    },
    onError: (e) => toast.error(describeError(e)),
  });

  if (kits.isPending) return <Skeleton className="h-96" />;
  if (kits.isError) return <ErrorState description="Couldn't load brand kits." onRetry={() => void kits.refetch()} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="space-y-3">
        {canWrite && (
          <Button className="w-full" onClick={() => setEditing({ id: null, form: { ...EMPTY_KIT, colors: { ...EMPTY_KIT.colors }, fonts: { ...EMPTY_KIT.fonts } } })}>
            <Plus aria-hidden="true" /> New brand kit
          </Button>
        )}
        {kits.data.length === 0 ? (
          <EmptyState title="No brand kits yet" description="A brand kit gives every AI design your logo, colours, fonts and contact details." />
        ) : (
          <ul className="space-y-2" aria-label="Brand kits">
            {kits.data.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  onClick={() => setEditing({ id: k.id, form: fromDto(k) })}
                  aria-current={editing?.id === k.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    editing?.id === k.id ? 'border-primary' : 'border-border hover:bg-muted',
                  )}
                >
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-background">
                    {k.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={k.logoUrl} alt="" className="size-full object-contain" />
                    ) : (
                      <span className="size-6 rounded-full" style={{ background: k.colors.primary }} aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="truncate">{k.name}</span>
                      {k.isDefault && <Badge tone="primary">Default</Badge>}
                    </span>
                    <span className="mt-1 flex gap-1" aria-hidden="true">
                      {Object.values(k.colors).map((c, i) => (
                        <span key={i} className="size-3.5 rounded-full border border-border" style={{ background: c }} />
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing ? (
        <KitForm
          key={editing.id ?? 'new'}
          id={editing.id}
          initial={editing.form}
          readOnly={!canWrite}
          isDefault={kits.data.find((k) => k.id === editing.id)?.isDefault ?? false}
          onSaved={async (dto) => {
            await invalidate();
            setEditing({ id: dto.id, form: fromDto(dto) });
          }}
          onMakeDefault={() => editing.id && setDefault.mutate(editing.id)}
          onDelete={() => setDeleting(kits.data.find((k) => k.id === editing.id) ?? null)}
        />
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">{kits.data.length ? 'Select a brand kit to view or edit it.' : canWrite ? 'Create your first brand kit to get started.' : 'No brand kits have been set up yet.'}</CardContent>
        </Card>
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent title="Delete brand kit?" description={deleting ? `“${deleting.name}” will be removed. Existing designs keep their current look.` : undefined}>
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
    </div>
  );
}

function KitForm({
  id,
  initial,
  readOnly,
  isDefault,
  onSaved,
  onMakeDefault,
  onDelete,
}: {
  id: string | null;
  initial: FormState;
  readOnly: boolean;
  isDefault: boolean;
  onSaved: (dto: BrandKitDto) => Promise<void>;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (input: BrandKitInput) => (id ? api.brandKits.update(id, input) : api.brandKits.create(input)),
    onSuccess: async (dto) => {
      toast.success(id ? 'Brand kit saved' : 'Brand kit created');
      await onSaved(dto);
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const text = (key: 'name' | 'tagline' | 'website' | 'phone' | 'whatsapp' | 'email' | 'address', label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`kit-${key}`}>{label}</Label>
      <Input
        id={`kit-${key}`}
        value={form[key] ?? ''}
        readOnly={readOnly}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `kit-${key}-error` : undefined}
        onChange={(e) => set(key, e.target.value)}
        {...props}
      />
      <FieldError id={`kit-${key}-error`} message={errors[key]} />
    </div>
  );

  return (
    <Card>
      <CardContent className="p-5">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = brandKitSchema.safeParse(toInput(form));
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
              return;
            }
            setErrors({});
            save.mutate(parsed.data);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{id ? form.name || 'Brand kit' : 'New brand kit'}</h2>
            {id && !readOnly && (
              <div className="flex gap-2">
                {!isDefault && (
                  <Button type="button" variant="outline" size="sm" onClick={onMakeDefault}>
                    <Star aria-hidden="true" /> Make default
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
                  <Trash2 aria-hidden="true" /> Delete
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {text('name', 'Brand name', { required: true, maxLength: 80, placeholder: 'e.g. ZatGo Innovation' })}
            {text('tagline', 'Tagline', { maxLength: 140 })}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Logo</legend>
            <div className="flex items-center gap-4">
              <span className="grid size-20 place-items-center overflow-hidden rounded-2xl border border-border bg-muted">
                {form.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoUrl} alt="Brand logo" className="size-full object-contain" />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </span>
              {!readOnly && (
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    aria-label="Upload logo"
                    tabIndex={-1}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setUploading(true);
                      try {
                        const fileId = await uploadFile(file, 'LOGO');
                        setForm((f) => ({ ...f, logoFileId: fileId, logoUrl: URL.createObjectURL(file) }));
                      } catch (err) {
                        toast.error(`Upload failed: ${describeError(err)}`);
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    <Upload aria-hidden="true" /> {uploading ? 'Uploading…' : form.logoUrl ? 'Replace logo' : 'Upload logo'}
                  </Button>
                  {form.logoFileId && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, logoFileId: null, logoUrl: null }))}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">PNG with a transparent background works best.</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Colours</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {COLOR_LABELS.map(([k, label]) => (
                <ColorField key={k} label={label} value={form.colors[k]} disabled={readOnly} onChange={(v) => set('colors', { ...form.colors, [k]: v })} />
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Fonts</legend>
            {(['heading', 'body'] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`kit-font-${k}`}>{k === 'heading' ? 'Headings' : 'Body text'}</Label>
                <Select id={`kit-font-${k}`} value={form.fonts[k]} disabled={readOnly} onChange={(e) => set('fonts', { ...form.fonts, [k]: e.target.value as BrandKitInput['fonts']['heading'] })}>
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
            <p className="text-xs text-muted-foreground sm:col-span-2">Malayalam, Arabic and other scripts automatically use a matching Noto Sans font.</p>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Contact details (used in design footers)</legend>
            {text('website', 'Website', { maxLength: 200, placeholder: 'zatgo.com' })}
            {text('phone', 'Phone', { maxLength: 40, type: 'tel', placeholder: '+91 98765 43210' })}
            {text('whatsapp', 'WhatsApp', { maxLength: 40, type: 'tel' })}
            {text('email', 'Email', { maxLength: 254, type: 'email' })}
            <div className="sm:col-span-2">{text('address', 'Address', { maxLength: 300 })}</div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="kit-guidelines">Brand guidelines for the AI</Label>
            <textarea
              id="kit-guidelines"
              rows={4}
              maxLength={4000}
              readOnly={readOnly}
              value={form.guidelines ?? ''}
              onChange={(e) => set('guidelines', e.target.value)}
              placeholder="Tone of voice, words to avoid, claims you are allowed to make…"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {!readOnly && (
            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending || uploading}>
                {id ? 'Save changes' : 'Create brand kit'}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
