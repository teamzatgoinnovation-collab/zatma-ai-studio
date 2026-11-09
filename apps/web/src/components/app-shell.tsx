'use client';

import { Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Dialog, Kbd, SheetContent, TooltipProvider } from '@zatma/ui';
import { SIDEBAR_COOKIE } from '@/lib/ui-prefs';
import { Logo } from './logo';
import { OrgSwitcher } from './org-switcher';
import { ActivityBell } from './shell/activity-bell';
import { Breadcrumbs } from './shell/breadcrumbs';
import { CommandPaletteProvider, useCommandPalette } from './shell/command-palette';
import { Sidebar, SidebarNav } from './shell/sidebar';
import { UserMenu } from './shell/user-menu';

const noopSubscribe = () => () => undefined;

function SearchButton() {
  const { open } = useCommandPalette();
  const shortcut = useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'),
    () => 'Ctrl K',
  );
  return (
    <>
      <button
        type="button"
        onClick={open}
        className="hidden h-9 w-64 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>{shortcut}</Kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={open}>
        <Search aria-hidden="true" />
      </Button>
    </>
  );
}

export function AppShell({ user, initialCollapsed, children }: { user: { name: string; email: string }; initialCollapsed: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  };

  return (
    <TooltipProvider>
      <CommandPaletteProvider>
        <a
          href="#main"
          className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh">
          <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />

          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent title="Navigation" side="left">
              <div className="flex h-16 items-center px-4">
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <Logo />
                </Link>
              </div>
              <div className="px-3 pb-3">
                <OrgSwitcher variant="sidebar" />
              </div>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Dialog>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-8">
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
                <Menu aria-hidden="true" />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="hidden lg:block">
                  <Breadcrumbs />
                </div>
                <div className="lg:hidden">
                  <OrgSwitcher variant="compact" />
                </div>
              </div>
              <SearchButton />
              <ActivityBell />
              <UserMenu user={user} />
            </header>
            <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 focus:outline-none lg:px-8">
              <div className="mx-auto w-full max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
      </CommandPaletteProvider>
    </TooltipProvider>
  );
}
