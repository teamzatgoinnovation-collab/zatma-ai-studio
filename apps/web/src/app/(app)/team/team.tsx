'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MailPlus, RotateCw, Trash2, UserMinus, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Badge, Button, ErrorState, PageHeader, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError, Input, Label, Meter, Select, Skeleton } from '@zatma/ui';
import { ROLE_LABELS, toAuthRole, type OrgRole } from '@zatma/types';
import { ASSIGNABLE_ROLES, inviteMemberSchema, type InviteMemberInput } from '@zatma/validation';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

const ROLE_HELP: Record<OrgRole, string> = {
  ORGANIZATION_OWNER: 'Full access including billing and deleting the organization',
  ADMIN: 'Manage team, settings and all modules (not billing)',
  MARKETING_MANAGER: 'Designs, campaigns, social publishing and ads',
  CRM_MANAGER: 'Full CRM access and automations',
  SALES_AGENT: 'Work leads, contacts and deals',
  DESIGNER: 'Create and edit designs',
  ANALYST: 'Read-only access plus analytics and audit log',
  VIEWER: 'Read-only access',
};

/** Better Auth returns `{ message }` errors; surface them as thrown errors for react-query. */
async function unwrap<T>(p: Promise<{ data: T | null; error: { message?: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(error.message ?? 'Request failed');
  return data;
}

export function TeamPage() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: api.organizations.members });
  const invitations = useQuery({ queryKey: ['organization', 'invitations'], queryFn: api.organizations.invitations });
  const perms = new Set(org.data?.permissions ?? []);
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: api.billing.usage, enabled: perms.has('billing:read') });
  const memberMetric = usage.data?.metrics.find((m) => m.metric === 'members');

  const refresh = () =>
    Promise.all(['members', 'invitations'].map((k) => qc.invalidateQueries({ queryKey: ['organization', k] }))).then(() =>
      qc.invalidateQueries({ queryKey: ['billing', 'usage'] }),
    );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteMemberInput>({ resolver: zodResolver(inviteMemberSchema), defaultValues: { email: '', role: 'VIEWER' } });

  const invite = useMutation({
    mutationFn: (v: InviteMemberInput & { resend?: boolean }) =>
      unwrap(authClient.organization.inviteMember({ email: v.email, role: toAuthRole(v.role) as never, resend: v.resend })),
    onSuccess: async (_d, v) => {
      toast.success(v.resend ? `Invitation re-sent to ${v.email}` : `Invitation sent to ${v.email}`);
      reset({ email: '', role: v.role });
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelInvite = useMutation({
    mutationFn: (invitationId: string) => unwrap(authClient.organization.cancelInvitation({ invitationId })),
    onSuccess: async () => {
      toast.success('Invitation canceled');
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeRole = useMutation({
    mutationFn: (v: { memberId: string; role: OrgRole }) => unwrap(authClient.organization.updateMemberRole({ memberId: v.memberId, role: toAuthRole(v.role) as never })),
    onSuccess: async () => {
      toast.success('Role updated');
      await refresh();
    },
    onError: async (e: Error) => {
      toast.error(e.message);
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (memberId: string) => unwrap(authClient.organization.removeMember({ memberIdOrEmail: memberId })),
    onSuccess: async () => {
      toast.success('Member removed');
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const me = authClient.useSession().data?.user.id;
  const isOwner = org.data?.role === 'ORGANIZATION_OWNER';

  return (
    <div className="space-y-6">
      <PageHeader icon={<Users />} title="Team" description="Invite teammates and control what each role can do." />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Role changes apply immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            {members.isPending && <Skeleton className="h-32" />}
            {members.isError && <ErrorState description="Couldn't load members." onRetry={() => void members.refetch()} />}
            <ul className="divide-y divide-border">
              {members.data?.map((m) => {
                const editable = perms.has('member:update') && m.userId !== me && (isOwner || m.role !== 'ORGANIZATION_OWNER');
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="grid size-9 place-items-center rounded-full bg-secondary/15 text-sm font-semibold text-secondary">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-sm font-medium">
                        {m.name} {m.userId === me && <span className="text-muted-foreground">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    {editable ? (
                      <Select
                        aria-label={`Role for ${m.name}`}
                        className="order-last w-full sm:order-none sm:w-48"
                        value={m.role ?? 'VIEWER'}
                        disabled={changeRole.isPending}
                        onChange={(e) => changeRole.mutate({ memberId: m.id, role: e.target.value as OrgRole })}
                      >
                        {(isOwner ? (['ORGANIZATION_OWNER', ...ASSIGNABLE_ROLES] as OrgRole[]) : [...ASSIGNABLE_ROLES]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      m.role && <Badge tone={m.role === 'ORGANIZATION_OWNER' ? 'primary' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
                    )}
                    {perms.has('member:remove') && m.userId !== me && (isOwner || m.role !== 'ORGANIZATION_OWNER') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${m.name}`}
                        onClick={() => window.confirm(`Remove ${m.name} from the organization?`) && remove.mutate(m.id)}
                      >
                        <UserMinus />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {perms.has('member:invite') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MailPlus className="size-4 text-primary" aria-hidden="true" /> Invite a teammate
                </CardTitle>
                <CardDescription>They&apos;ll get an email with a link to join.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit((v) => invite.mutate(v))} className="space-y-3" noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input id="invite-email" type="email" placeholder="name@company.com" aria-invalid={!!errors.email} aria-describedby="invite-email-error" {...register('email')} />
                    <FieldError id="invite-email-error" message={errors.email?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select id="invite-role" {...register('role')}>
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}: {ROLE_HELP[r]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit" className="w-full" disabled={invite.isPending}>
                    {invite.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                    Send invitation
                  </Button>
                </form>
                {memberMetric && (
                  <div className="mt-4">
                    <Meter label="Seats used (incl. pending)" used={memberMetric.used} limit={memberMetric.limit} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
            </CardHeader>
            <CardContent>
              {invitations.isPending && <Skeleton className="h-12" />}
              {invitations.data?.length === 0 && <p className="text-sm text-muted-foreground">No pending invitations.</p>}
              <ul className="space-y-3">
                {invitations.data?.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.role ? ROLE_LABELS[inv.role] : 'Member'} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    {perms.has('member:invite') && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Resend invitation to ${inv.email}`}
                          onClick={() => invite.mutate({ email: inv.email, role: (inv.role ?? 'VIEWER') as InviteMemberInput['role'], resend: true })}
                        >
                          <RotateCw />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Cancel invitation to ${inv.email}`} onClick={() => cancelInvite.mutate(inv.id)}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
