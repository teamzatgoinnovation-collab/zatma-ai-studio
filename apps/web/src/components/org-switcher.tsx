'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from '@zatma/ui';
import { ROLE_LABELS } from '@zatma/types';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

export function OrgAvatar({ name, logoUrl, className }: { name: string; logoUrl: string | null; className?: string }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
    <img src={logoUrl} alt="" className={cn('size-8 shrink-0 rounded-lg bg-white object-contain', className)} />
  ) : (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-secondary text-xs font-semibold text-primary-foreground', className)}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Switch the active organization; clears every cached query because they belong to the previous tenant. */
export function useSwitchOrganization() {
  const router = useRouter();
  const qc = useQueryClient();
  return async (organizationId: string) => {
    const { error } = await authClient.organization.setActive({ organizationId });
    if (error) {
      toast.error(error.message ?? 'Could not switch organization');
      return;
    }
    qc.clear();
    router.refresh();
  };
}

export function OrgSwitcher({ variant = 'sidebar' }: { variant?: 'sidebar' | 'compact' }) {
  const router = useRouter();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const orgs = authClient.useListOrganizations();
  const switchTo = useSwitchOrganization();

  if (org.isPending) return <Skeleton className={variant === 'sidebar' ? 'h-14 w-full' : 'h-9 w-40'} />;
  if (!org.data) return null;
  const current = org.data;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex min-w-0 items-center gap-2.5 rounded-xl text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          variant === 'sidebar' ? 'w-full border border-border bg-background p-2' : 'max-w-full px-2 py-1.5',
        )}
      >
        <OrgAvatar name={current.name} logoUrl={current.logoUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current.name}</span>
          {variant === 'sidebar' && <span className="block truncate text-xs text-muted-foreground">{ROLE_LABELS[current.role]}</span>}
        </span>
        <span className="sr-only">: switch organization</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.data?.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => o.id !== current.id && void switchTo(o.id)}>
            <OrgAvatar name={o.name} logoUrl={o.id === current.id ? current.logoUrl : null} className="size-6 text-[10px]" />
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === current.id ? <Check className="text-primary" aria-label="Current" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/onboarding/organization')}>
          <Plus aria-hidden="true" /> Create organization
        </DropdownMenuItem>
        {variant === 'compact' && (
          <div className="px-3 pb-2 pt-1">
            <Badge tone="primary">{ROLE_LABELS[current.role]}</Badge>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
