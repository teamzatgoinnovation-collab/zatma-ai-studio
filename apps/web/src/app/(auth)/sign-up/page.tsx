import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getServerSession } from '@/lib/server-session';
import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignUpPage() {
  if (await getServerSession()) redirect('/dashboard');
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
        <p className="text-sm text-muted-foreground">Start free. No credit card required.</p>
      </div>
      <Suspense>
        <SignUpForm />
      </Suspense>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
