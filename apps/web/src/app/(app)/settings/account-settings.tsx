'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Loader2, LogOut, Trash2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError, Input, Label, Select, Skeleton } from '@zatma/ui';
import { changePasswordSchema, updateProfileSchema, type ChangePasswordInput, type UpdateProfileInput } from '@zatma/validation';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { absoluteUrl } from '@/lib/redirect';
import { LANGUAGE_LABELS, LANGUAGES, timeZones } from '@/lib/options';

function describeAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function AccountSettings() {
  const qc = useQueryClient();
  const zones = useMemo(() => timeZones(), []);
  const me = useQuery({ queryKey: ['users', 'me'], queryFn: api.users.me });
  const session = authClient.useSession();
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => {
      const { data, error } = await authClient.listSessions();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const profile = useForm<UpdateProfileInput>({ resolver: zodResolver(updateProfileSchema) });
  useEffect(() => {
    if (me.data) profile.reset({ name: me.data.name, locale: me.data.locale as UpdateProfileInput['locale'], timezone: me.data.timezone });
  }, [me.data, profile]);

  const saveProfile = useMutation({
    mutationFn: api.users.updateMe,
    onSuccess: (data) => {
      qc.setQueryData(['users', 'me'], data);
      toast.success('Profile updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const password = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });
  const changePassword = useMutation({
    mutationFn: async (v: ChangePasswordInput) => {
      const { error } = await authClient.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword, revokeOtherSessions: true });
      if (error) throw new Error(error.message ?? 'Could not change password');
    },
    onSuccess: async () => {
      password.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed. Other devices were signed out.');
      await qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const { error } = await authClient.revokeSession({ token });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success('Session signed out');
      await qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eligibility = useQuery({ queryKey: ['users', 'deletion-eligibility'], queryFn: api.users.deletionEligibility });
  const requestDeletion = async () => {
    if (!window.confirm('We will email you a link to permanently delete your account. Continue?')) return;
    const { error } = await authClient.deleteUser({ callbackURL: absoluteUrl('/sign-in?deleted=1') });
    if (error) toast.error(error.message ?? 'Could not start account deletion');
    else toast.success('Check your email to confirm account deletion');
  };

  if (me.isPending) return <Skeleton className="h-96" />;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{me.data?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={profile.handleSubmit((v) => saveProfile.mutate(v))} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" aria-invalid={!!profile.formState.errors.name} {...profile.register('name')} />
              <FieldError message={profile.formState.errors.name?.message} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-locale">Language</Label>
                <Select id="profile-locale" {...profile.register('locale')}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-tz">Time zone</Label>
                <Select id="profile-tz" {...profile.register('timezone')}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button type="submit" disabled={!profile.formState.isDirty || saveProfile.isPending}>
              {saveProfile.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>You&apos;ll stay signed in here; other devices are signed out.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={password.handleSubmit((v) => changePassword.mutate(v))} className="space-y-4" noValidate>
            {(
              [
                ['currentPassword', 'Current password', 'current-password'],
                ['newPassword', 'New password', 'new-password'],
                ['confirmPassword', 'Confirm new password', 'new-password'],
              ] as const
            ).map(([name, label, autoComplete]) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={`pw-${name}`}>{label}</Label>
                <Input id={`pw-${name}`} type="password" autoComplete={autoComplete} aria-invalid={!!password.formState.errors[name]} {...password.register(name)} />
                <FieldError message={password.formState.errors[name]?.message} />
              </div>
            ))}
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.isPending && <Skeleton className="h-16" />}
          <ul className="divide-y divide-border">
            {sessions.data?.map((s) => {
              const current = s.id === session.data?.session.id;
              return (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  <Laptop className="size-4 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {describeAgent(s.userAgent)} {current && <Badge tone="success">This device</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.ipAddress ?? 'Unknown IP'} · since {new Date(s.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!current && (
                    <Button variant="ghost" size="icon" aria-label="Sign out this session" onClick={() => revoke.mutate(s.token)}>
                      <LogOut />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>Permanently deletes your account. Organizations where you are the only member are deleted too.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {eligibility.data && !eligibility.data.canDelete && (
            <Alert>
              You are the only owner of {eligibility.data.blockingOrganizations.map((o) => o.name).join(', ')}. Make another member an owner or
              remove the other members first.
            </Alert>
          )}
          <Button variant="destructive" disabled={!eligibility.data?.canDelete} onClick={() => void requestDeletion()}>
            <Trash2 aria-hidden="true" /> Delete my account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
