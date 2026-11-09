import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getServerSession } from '@/lib/server-session';
import { AppShell } from '@/components/app-shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  if (!session.session.activeOrganizationId) redirect('/onboarding/organization');

  return <AppShell user={{ name: session.user.name, email: session.user.email }}>{children}</AppShell>;
}
