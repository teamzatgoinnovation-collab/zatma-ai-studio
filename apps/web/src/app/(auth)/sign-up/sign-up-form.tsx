'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, FieldError, Input, Label } from '@zatma/ui';
import { signUpSchema, type SignUpInput } from '@zatma/validation';
import { GoogleButton } from '@/components/google-button';
import { authClient } from '@/lib/auth-client';
import { absoluteUrl, safeRedirect } from '@/lib/redirect';

export function SignUpForm() {
  const router = useRouter();
  const next = safeRedirect(useSearchParams().get('next'), '/onboarding/organization');
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const { data, error: authError } = await authClient.signUp.email({ ...values, callbackURL: absoluteUrl(`/verify-email?status=verified&next=${encodeURIComponent(next)}`) });
    if (authError) {
      setError(authError.message ?? 'Could not create your account');
      return;
    }
    if (!data?.token) {
      // Email verification required: no session until the link is opened.
      router.replace(`/verify-email?email=${encodeURIComponent(values.email)}&next=${encodeURIComponent(next)}`);
      return;
    }
    router.replace(next);
    router.refresh();
  });

  return (
    <div className="space-y-4">
    <GoogleButton callbackURL={next} />
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="space-y-2">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" autoComplete="name" aria-invalid={!!errors.name} aria-describedby="name-error" {...register('name')} />
        <FieldError id="name-error" message={errors.name?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby="email-error" {...register('email')} />
        <FieldError id="email-error" message={errors.email?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          aria-describedby="password-error"
          {...register('password')}
        />
        <FieldError id="password-error" message={errors.password?.message ?? undefined} />
        {!errors.password && <p className="text-xs text-muted-foreground">At least 10 characters, with a letter and a number.</p>}
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
        Create account
      </Button>
    </form>
    </div>
  );
}
