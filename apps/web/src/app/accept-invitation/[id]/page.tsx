import type { Metadata } from 'next';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { getServerSession } from '@/lib/server-session';
import { AcceptInvitation } from './accept-invitation';

export const metadata: Metadata = { title: 'Join organization' };

export default async function AcceptInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between p-4">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-md px-4 pb-16 pt-10">
        <AcceptInvitation invitationId={id} currentEmail={session?.user.email ?? null} />
      </main>
    </div>
  );
}
