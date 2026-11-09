'use client';

import { CheckCircle2, Loader2, MailOpen, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@zatma/ui';
import { authClient } from '@/lib/auth-client';
import { absoluteUrl, safeRedirect } from '@/lib/redirect';

export function VerifyEmail() {
  const params = useSearchParams();
  const status = params.get('status');
  const error = params.get('error');
  const email = params.get('email');
  const next = safeRedirect(params.get('next'), '/onboarding/organization');
  const [sending, setSending] = useState(false);

  const resend = async () => {
    if (!email) return;
    setSending(true);
    const { error: e } = await authClient.sendVerificationEmail({ email, callbackURL: absoluteUrl(`/verify-email?status=verified&next=${encodeURIComponent(next)}`) });
    setSending(false);
    if (e) toast.error(e.message ?? 'Could not send email');
    else toast.success('Verification email sent');
  };

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <XCircle className="mx-auto size-12 text-destructive" aria-hidden="true" />
        <h2 className="text-2xl font-semibold tracking-tight">Link expired or invalid</h2>
        <p className="text-sm text-muted-foreground">Sign in to get a fresh verification link.</p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  if (status === 'verified') {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden="true" />
        <h2 className="text-2xl font-semibold tracking-tight">Email verified</h2>
        <p className="text-sm text-muted-foreground">Your account is ready. Let&apos;s set up your organization.</p>
        <Button asChild className="w-full">
          <Link href={next}>Continue</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <MailOpen className="mx-auto size-12 text-primary" aria-hidden="true" />
      <h2 className="text-2xl font-semibold tracking-tight">Check your inbox</h2>
      <p className="text-sm text-muted-foreground">
        We sent a verification link{email ? (
          <>
            {' '}to <strong className="text-foreground">{email}</strong>
          </>
        ) : null}
        . Open it to activate your account. The link expires in 24 hours.
      </p>
      {email && (
        <Button variant="outline" className="w-full" disabled={sending} onClick={() => void resend()}>
          {sending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Resend email
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        Wrong address?{' '}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Sign up again
        </Link>
      </p>
    </div>
  );
}
