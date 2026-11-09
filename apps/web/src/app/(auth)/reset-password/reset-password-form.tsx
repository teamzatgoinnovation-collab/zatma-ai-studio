'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, FieldError, Input, Label } from '@zatma/ui';
import { resetPasswordSchema, type ResetPasswordInput } from '@zatma/validation';
import { authClient } from '@/lib/auth-client';

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [error, setError] = useState<string | null>(params.get('error') ? 'This reset link is invalid or has expired.' : null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  if (!token) {
    return (
      <Alert>
        {error ?? 'This reset link is missing its token.'}{' '}
        <Link href="/forgot-password" className="font-medium underline">
          Request a new link
        </Link>
      </Alert>
    );
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    const { error: e } = await authClient.resetPassword({ newPassword: password, token });
    if (e) {
      setError(e.message ?? 'This reset link is invalid or has expired.');
      return;
    }
    router.replace('/sign-in?reset=1');
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && (
        <Alert>
          {error}{' '}
          <Link href="/forgot-password" className="font-medium underline">
            Request a new link
          </Link>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} aria-describedby="password-error" {...register('password')} />
        <FieldError id="password-error" message={errors.password?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          aria-describedby="confirm-error"
          {...register('confirmPassword')}
        />
        <FieldError id="confirm-error" message={errors.confirmPassword?.message} />
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
        Update password
      </Button>
    </form>
  );
}
