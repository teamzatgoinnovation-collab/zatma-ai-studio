'use client';

import { useQuery } from '@tanstack/react-query';
import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Badge, Button, cn, Skeleton } from '@zatma/ui';
import { ROLE_LABELS } from '@zatma/types';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { Logo } from './logo';
import { NAV } from './nav';
import { ThemeToggle } from './theme-toggle';

export function AppShell({ user, children }: { user: { name: string; email: string }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });

  const signOut = async () => {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  };

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center justify-between px-2 pt-1">
        <Logo />
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>
      {NAV.map(({ label, href, icon: Icon, phase }) => {
        const active = pathname.startsWith(href);
        const classes = cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
          active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground',
          !phase && !active && 'hover:bg-muted hover:text-foreground',
          phase && 'cursor-not-allowed opacity-60',
        );
        return phase ? (
          <span key={href} className={classes} aria-disabled="true" title={`Coming in Phase ${phase}`}>
            <Icon className="size-4" aria-hidden="true" />
            <span className="flex-1">{label}</span>
            <Badge className="text-[10px]">P{phase}</Badge>
          </span>
        ) : (
          <Link key={href} href={href} className={classes} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}>
            <Icon className="size-4" aria-hidden="true" />
            <span className="flex-1">{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-sidebar lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 border-r border-border bg-sidebar">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            {org.isPending ? (
              <Skeleton className="h-5 w-40" />
            ) : org.data ? (
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{org.data.name}</span>
                <Badge tone="primary">{ROLE_LABELS[org.data.role]}</Badge>
              </div>
            ) : null}
          </div>
          <ThemeToggle />
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void signOut()}>
            <LogOut />
          </Button>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
