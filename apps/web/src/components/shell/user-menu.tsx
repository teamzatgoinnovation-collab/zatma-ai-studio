'use client';

import { Building2, CreditCard, LogOut, Monitor, Moon, Sun, UserCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@zatma/ui';
import { authClient } from '@/lib/auth-client';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

const THEMES = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const signOut = async () => {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-xl p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-primary-foreground">
          {initials(user.name)}
        </span>
        <span className="sr-only xl:hidden">Account menu for {user.name}</span>
        <span className="hidden max-w-40 text-left xl:block">
          <span className="sr-only">Account menu: </span>
          <span className="block truncate text-sm font-medium leading-tight">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel className="text-foreground">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/settings?tab=account')}>
          <UserCog aria-hidden="true" /> Your account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <Building2 aria-hidden="true" /> Organization settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/billing')}>
          <CreditCard aria-hidden="true" /> Billing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <div className="grid grid-cols-3 gap-1 px-1 pb-1" role="group" aria-label="Theme">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <DropdownMenuItem
              key={id}
              onSelect={(e) => {
                e.preventDefault();
                setTheme(id);
              }}
              aria-checked={theme === id}
              role="menuitemradio"
              className={cn('flex-col gap-1 px-2 py-2 text-xs', theme === id && 'bg-primary/10 text-primary')}
            >
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
