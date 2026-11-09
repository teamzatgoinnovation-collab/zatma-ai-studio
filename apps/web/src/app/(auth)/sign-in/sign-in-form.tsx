'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, Button, FieldError, Input, Label } from '@zatma/ui';
import { signInSchema, type SignInInput } from '@zatma/validation';
import { GoogleButton } from '@/components/google-button';
import { authClient } from '@/lib/auth-client';
import { absoluteUrl, safeRedirect } from '@/lib/redirect';

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirect(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  const verifyCallback = () => absoluteUrl(`/verify-email?status=verified&next=${encodeURIComponent(next)}`);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setUnverifiedEmail(null);
    const { error: authError } = await authClient.signIn.email(values);
    if (authError) {
      if (authError.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(values.email);
        await authClient.sendVerificationEmail({ email: values.email, callbackURL: verifyCallback() });
        return;
      }
      setError(authError.message ?? 'Invalid email or password');
      return;
    }
    router.replace(next);
    router.refresh();
  });

  const resend = async () => {
    if (!unverifiedEmail) return;
    const { error: e } = await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL: verifyCallback() });
    if (e) toast.error(e.message ?? 'Could not send email');
    else toast.success('Verification email sent');
  };

  return (
    <div className="space-y-4">
      {params.get('reset') === '1' && <Alert tone="info">Your password was changed. Sign in with your new password.</Alert>}
      {params.get('deleted') === '1' && <Alert tone="info">Your account has been deleted.</Alert>}
      <GoogleButton callbackURL={next} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {unverifiedEmail && (
          <Alert tone="info">
            Please verify your email first. We sent a link to <strong>{unverifiedEmail}</strong> (we just sent a new one).{' '}
            <button type="button" className="font-medium underline" onClick={() => void resend()}>
              Send again
            </button>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby="email-error" {...register('email')} />
          <FieldError id="email-error" message={errors.email?.message} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby="password-error"
            {...register('password')}
          />
          <FieldError id="password-error" message={errors.password?.message} />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
          Sign in
        </Button>
      </form>
    </div>
  );
}
