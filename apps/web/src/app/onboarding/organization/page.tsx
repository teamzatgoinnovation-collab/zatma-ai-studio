import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { getServerSession } from '@/lib/server-session';
import { OrganizationOnboarding } from './organization-onboarding';

export const metadata: Metadata = { title: 'Set up your organization' };

export default async function OnboardingPage() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between p-4">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-lg px-4 pb-16 pt-6">
        <OrganizationOnboarding userName={session.user.name} />
      </main>
    </div>
  );
}
