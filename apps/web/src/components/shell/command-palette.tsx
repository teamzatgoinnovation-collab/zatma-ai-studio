'use client';

import { Building2, CreditCard, LogOut, Monitor, Moon, Sun, UserCog, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Dialog, DialogContent, Kbd } from '@zatma/ui';
import { authClient } from '@/lib/auth-client';
import { allNavEntries } from '../nav';
import { useSwitchOrganization } from '../org-switcher';

interface PaletteContext {
  open: () => void;
}
const Ctx = createContext<PaletteContext>({ open: () => undefined });
export const useCommandPalette = () => useContext(Ctx);

/** True for ⌘K on macOS and Ctrl+K elsewhere. */
export const isPaletteShortcut = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>) => e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const orgs = authClient.useListOrganizations();
  const active = authClient.useActiveOrganization();
  const switchTo = useSwitchOrganization();
  const entries = useMemo(() => allNavEntries(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, []);

  const ctx = useMemo(() => ({ open: () => setOpen(true) }), []);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent title="Command menu" description="Search pages and run actions" hideTitle className="max-w-xl overflow-hidden p-0">
          <Command loop>
            <CommandInput placeholder="Search pages, actions and organizations…" aria-label="Search commands" />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>

              <CommandGroup heading="Pages">
                {entries.map((e) => {
                  const Icon = e.icon;
                  return (
                    <CommandItem
                      key={e.href}
                      value={e.href === '/dashboard' ? e.label : `${e.label} ${e.href}`}
                      keywords={[e.section, ...(e.keywords ?? [])]}
                      onSelect={() => run(() => router.push(e.href))}
                    >
                      <Icon aria-hidden="true" />
                      <span className="flex-1 truncate">
                        {e.section !== e.label && <span className="text-muted-foreground">{e.section} / </span>}
                        {e.label}
                      </span>
                      {e.phase && <Badge className="text-[10px]">Phase {e.phase}</Badge>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>

              <CommandGroup heading="Actions">
                <CommandItem value="Invite a teammate" keywords={['member', 'team', 'add user']} onSelect={() => run(() => router.push('/team'))}>
                  <UserPlus aria-hidden="true" /> Invite a teammate
                </CommandItem>
                <CommandItem value="Organization settings" keywords={['logo', 'timezone', 'currency']} onSelect={() => run(() => router.push('/settings'))}>
                  <Building2 aria-hidden="true" /> Organization settings
                </CommandItem>
                <CommandItem value="Account settings" keywords={['password', 'profile', 'sessions']} onSelect={() => run(() => router.push('/settings?tab=account'))}>
                  <UserCog aria-hidden="true" /> Account settings
                </CommandItem>
                <CommandItem value="Change plan" keywords={['upgrade', 'billing', 'subscription']} onSelect={() => run(() => router.push('/billing'))}>
                  <CreditCard aria-hidden="true" /> Change plan
                </CommandItem>
                <CommandItem value="Theme light" onSelect={() => run(() => setTheme('light'))}>
                  <Sun aria-hidden="true" /> Light theme
                </CommandItem>
                <CommandItem value="Theme dark" onSelect={() => run(() => setTheme('dark'))}>
                  <Moon aria-hidden="true" /> Dark theme
                </CommandItem>
                <CommandItem value="Theme system" onSelect={() => run(() => setTheme('system'))}>
                  <Monitor aria-hidden="true" /> System theme
                </CommandItem>
                <CommandItem
                  value="Sign out"
                  onSelect={() =>
                    run(async () => {
                      await authClient.signOut();
                      router.replace('/sign-in');
                      router.refresh();
                    })
                  }
                >
                  <LogOut aria-hidden="true" /> Sign out
                </CommandItem>
              </CommandGroup>

              {orgs.data && orgs.data.length > 1 && (
                <CommandGroup heading="Switch organization">
                  {orgs.data
                    .filter((o) => o.id !== active.data?.id)
                    .map((o) => (
                      <CommandItem key={o.id} value={`Switch to ${o.name}`} onSelect={() => run(() => void switchTo(o.id))}>
                        <Building2 aria-hidden="true" /> {o.name}
                      </CommandItem>
                    ))}
                </CommandGroup>
              )}
            </CommandList>
            <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd> close
              </span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
