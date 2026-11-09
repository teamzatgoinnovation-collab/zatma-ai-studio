'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError, Input, Label, Skeleton } from '@zatma/ui';
import { createOrganizationSchema, type CreateOrganizationInput } from '@zatma/validation';
import { authClient } from '@/lib/auth-client';

const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export function OrganizationOnboarding({ userName }: { userName: string }) {
  const router = useRouter();
  const { data: orgs, isPending } = authClient.useListOrganizations();
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationInput>({ resolver: zodResolver(createOrganizationSchema), defaultValues: { name: '', slug: '' } });

  const goToDashboard = () => {
    router.replace('/dashboard');
    router.refresh();
  };

  const onCreate = handleSubmit(async (values) => {
    setError(null);
    const { error: e } = await authClient.organization.create(values);
    if (e) {
      setError(e.message ?? 'Could not create organization');
      return;
    }
    goToDashboard();
  });

  const openOrg = async (organizationId: string) => {
    setSwitching(organizationId);
    const { error: e } = await authClient.organization.setActive({ organizationId });
    setSwitching(null);
    if (e) {
      setError(e.message ?? 'Could not open organization');
      return;
    }
    goToDashboard();
  };

  const nameField = register('name', {
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!slugTouched) setValue('slug', slugify(event.target.value), { shouldValidate: false });
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {userName.split(' ')[0]} 👋</h1>
        <p className="text-sm text-muted-foreground">
          Organizations keep your brand, CRM and campaigns separate. Your team works inside one.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {isPending ? (
        <Skeleton className="h-20" />
      ) : orgs && orgs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Your organizations</CardTitle>
            <CardDescription>Continue where you left off.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {orgs.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => void openOrg(org.id)}
                disabled={switching !== null}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted disabled:opacity-60"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-4" aria-hidden="true" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">{org.name}</span>
                  <span className="block text-xs text-muted-foreground">{org.slug}</span>
                </span>
                {switching === org.id ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4 text-muted-foreground" />}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create an organization</CardTitle>
          <CardDescription>You&apos;ll be its owner. You can invite your team later.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input id="org-name" placeholder="ZatGo Innovation" aria-invalid={!!errors.name} aria-describedby="org-name-error" {...nameField} />
              <FieldError id="org-name-error" message={errors.name?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">URL handle</Label>
              <Input
                id="org-slug"
                placeholder="zatgo-innovation"
                aria-invalid={!!errors.slug}
                aria-describedby="org-slug-error"
                {...register('slug', { onChange: () => setSlugTouched(true) })}
              />
              <FieldError id="org-slug-error" message={errors.slug?.message} />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              Create organization
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
