'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { toast } from 'sonner';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError, Input, Label, Select, Skeleton } from '@zatma/ui';
import { updateOrganizationSchema, type UpdateOrganizationInput } from '@zatma/validation';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { CURRENCIES, LANGUAGE_LABELS, LANGUAGES, timeZones } from '@/lib/options';
import { uploadFile } from '@/lib/upload';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function OrganizationSettings() {
  const qc = useQueryClient();
  const router = useRouter();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const canEdit = org.data?.permissions.includes('organization:update') ?? false;
  const zones = useMemo(() => timeZones(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<z.input<typeof updateOrganizationSchema>, unknown, UpdateOrganizationInput>({ resolver: zodResolver(updateOrganizationSchema) });

  useEffect(() => {
    if (org.data) {
      reset({
        name: org.data.name,
        website: org.data.website ?? '',
        industry: org.data.industry ?? '',
        timezone: org.data.timezone,
        defaultLanguage: org.data.defaultLanguage as UpdateOrganizationInput['defaultLanguage'],
        currency: org.data.currency as UpdateOrganizationInput['currency'],
      });
    }
  }, [org.data, reset]);

  const setOrg = (data: Awaited<ReturnType<typeof api.organizations.current>>) => qc.setQueryData(['organization', 'current'], data);

  const save = useMutation({
    mutationFn: (v: UpdateOrganizationInput) => api.organizations.update({ ...v, industry: v.industry || null }),
    onSuccess: (data) => {
      setOrg(data);
      toast.success('Organization updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeLogo = useMutation({
    mutationFn: api.organizations.removeLogo,
    onSuccess: (data) => {
      setOrg(data);
      toast.success('Logo removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return toast.error('Use a PNG, JPG, WebP or SVG image');
    if (file.size > MAX_LOGO_BYTES) return toast.error('The logo must be 2 MB or smaller');
    setUploading(true);
    try {
      const fileId = await uploadFile(file, 'LOGO');
      setOrg(await api.organizations.setLogo(fileId));
      toast.success('Logo updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const deleteOrg = async () => {
    if (!org.data) return;
    const typed = window.prompt(`This permanently deletes ${org.data.name} and all of its data. Type the organization name to confirm.`);
    if (typed !== org.data.name) return;
    const { error } = await authClient.organization.delete({ organizationId: org.data.id });
    if (error) return toast.error(error.message ?? 'Could not delete organization');
    toast.success('Organization deleted');
    router.replace('/onboarding/organization');
    router.refresh();
  };

  if (org.isPending) return <Skeleton className="h-96" />;
  if (!org.data) return <Alert>Could not load the organization.</Alert>;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Organization profile</CardTitle>
          <CardDescription>Used across designs, campaigns and invoices.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
            <fieldset disabled={!canEdit} className="contents">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="org-name">Name</Label>
                <Input id="org-name" aria-invalid={!!errors.name} aria-describedby="org-name-error" {...register('name')} />
                <FieldError id="org-name-error" message={errors.name?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-website">Website</Label>
                <Input id="org-website" placeholder="https://zatgoinnovation.com" aria-invalid={!!errors.website} aria-describedby="org-website-error" {...register('website')} />
                <FieldError id="org-website-error" message={errors.website?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-industry">Industry</Label>
                <Input id="org-industry" placeholder="Retail, Software, Healthcare…" {...register('industry')} />
                <FieldError message={errors.industry?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-timezone">Time zone</Label>
                <Select id="org-timezone" {...register('timezone')}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-currency">Currency</Label>
                <Select id="org-currency" {...register('currency')}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="org-language">Default content language</Label>
                <Select id="org-language" {...register('defaultLanguage')}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </div>
              {canEdit && (
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={!isDirty || save.isPending}>
                    {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                    Save changes
                  </Button>
                </div>
              )}
            </fieldset>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
            <CardDescription>PNG, JPG, WebP or SVG, up to 2 MB. Used by the Brand Kit later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid aspect-[3/2] place-items-center rounded-xl border border-dashed border-border bg-muted/50 p-4">
              {org.data.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
                <img src={org.data.logoUrl} alt={`${org.data.name} logo`} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-sm text-muted-foreground">No logo yet</span>
              )}
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept={LOGO_TYPES.join(',')}
                  className="sr-only"
                  id="logo-file"
                  aria-label="Upload logo"
                  tabIndex={-1}
                  onChange={(e) => void onLogo(e.target.files?.[0])}
                />
                <Button className="flex-1" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImageUp aria-hidden="true" />}
                  {org.data.logo ? 'Replace' : 'Upload'}
                </Button>
                {org.data.logo && (
                  <Button variant="ghost" size="icon" aria-label="Remove logo" onClick={() => removeLogo.mutate()}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {org.data.role === 'ORGANIZATION_OWNER' && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">Danger zone</CardTitle>
              <CardDescription>Deleting the organization removes all of its workspaces, files, CRM data and history.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={() => void deleteOrg()}>
                <Trash2 aria-hidden="true" /> Delete organization
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
