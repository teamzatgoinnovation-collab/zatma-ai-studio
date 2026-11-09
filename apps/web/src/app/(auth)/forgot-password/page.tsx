'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, FieldError, Input, Label } from '@zatma/ui';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@zatma/validation';
import { authClient } from '@/lib/auth-client';
import { absoluteUrl } from '@/lib/redirect';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const { error: e } = await authClient.requestPasswordReset({ email, redirectTo: absoluteUrl('/reset-password') });
    if (e) setError(e.message ?? 'Could not send the reset email');
    else setSentTo(email);
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Reset your password</h2>
        <p className="text-sm text-muted-foreground">We&apos;ll email you a link to choose a new password.</p>
      </div>
      {sentTo ? (
        <Alert tone="info">
          <span className="flex items-start gap-2">
            <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              If an account exists for <strong>{sentTo}</strong>, a reset link is on its way. The link expires in 1 hour.
            </span>
          </span>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby="email-error" {...register('email')} />
            <FieldError id="email-error" message={errors.email?.message} />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
            Send reset link
          </Button>
        </form>
      )}
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
