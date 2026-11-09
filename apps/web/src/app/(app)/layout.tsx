import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getServerSession } from '@/lib/server-session';
import { AppShell } from '@/components/app-shell';
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  if (!session.session.activeOrganizationId) redirect('/onboarding/organization');

  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed';
  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }} initialCollapsed={collapsed}>
      {children}
    </AppShell>
  );
}
