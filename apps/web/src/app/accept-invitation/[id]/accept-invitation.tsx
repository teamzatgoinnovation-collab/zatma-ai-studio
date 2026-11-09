'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, CardContent, Skeleton } from '@zatma/ui';
import { ROLE_LABELS } from '@zatma/types';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

export function AcceptInvitation({ invitationId, currentEmail }: { invitationId: string; currentEmail: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invitation = useQuery({ queryKey: ['invitation', invitationId], queryFn: () => api.organizations.publicInvitation(invitationId) });
  const next = encodeURIComponent(`/accept-invitation/${invitationId}`);

  if (invitation.isPending) return <Skeleton className="h-56" />;
  if (invitation.isError) return <Alert>This invitation link is invalid.</Alert>;
  const inv = invitation.data;

  const accept = async () => {
    setBusy('accept');
    setError(null);
    const { data, error: e } = await authClient.organization.acceptInvitation({ invitationId });
    if (e) {
      setBusy(null);
      setError(e.message ?? 'Could not accept the invitation');
      return;
    }
    const organizationId = data?.member?.organizationId;
    if (organizationId) await authClient.organization.setActive({ organizationId });
    router.replace('/dashboard');
    router.refresh();
  };

  const decline = async () => {
    setBusy('decline');
    await authClient.organization.rejectInvitation({ invitationId });
    router.replace(currentEmail ? '/dashboard' : '/sign-in');
  };

  const wrongAccount = currentEmail && currentEmail.toLowerCase() !== inv.email.toLowerCase();

  return (
    <Card>
      <CardContent className="space-y-5 p-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Building2 className="size-6" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Join {inv.organizationName}</h1>
          <p className="text-sm text-muted-foreground">
            {inv.inviterName ?? 'A teammate'} invited <strong className="text-foreground">{inv.email}</strong> to join as{' '}
            <strong className="text-foreground">{inv.role ? ROLE_LABELS[inv.role] : 'Member'}</strong>.
          </p>
        </div>

        {error && <Alert>{error}</Alert>}

        {inv.status !== 'pending' ? (
          <Alert>This invitation is {inv.status}. Ask your team for a new one.</Alert>
        ) : !currentEmail ? (
          <div className="space-y-2">
            <Button asChild className="w-full">
              <Link href={`/sign-in?next=${next}`}>Sign in to accept</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/sign-up?next=${next}`}>Create an account</Link>
            </Button>
          </div>
        ) : wrongAccount ? (
          <Alert>
            You&apos;re signed in as {currentEmail}. Sign in as {inv.email} to accept this invitation.
          </Alert>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={busy !== null} onClick={() => void decline()}>
              {busy === 'decline' && <Loader2 className="animate-spin" aria-hidden="true" />}
              Decline
            </Button>
            <Button className="flex-1" disabled={busy !== null} onClick={() => void accept()}>
              {busy === 'accept' && <Loader2 className="animate-spin" aria-hidden="true" />}
              Accept invitation
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
