'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Skeleton } from '@zatma/ui';
import { ROLE_LABELS } from '@zatma/types';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

export function OrgSwitcher() {
  const router = useRouter();
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const orgs = authClient.useListOrganizations();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const switchTo = async (organizationId: string) => {
    setOpen(false);
    if (organizationId === org.data?.id) return;
    const { error } = await authClient.organization.setActive({ organizationId });
    if (error) return toast.error(error.message ?? 'Could not switch organization');
    qc.clear(); // every cached query belongs to the previous tenant
    router.refresh();
  };

  if (org.isPending) return <Skeleton className="h-9 w-48" />;
  if (!org.data) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
      >
        {org.data.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img src={org.data.logoUrl} alt="" className="size-7 rounded-lg object-contain" />
        ) : (
          <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">{org.data.name.slice(0, 1)}</span>
        )}
        <span className="truncate font-semibold">{org.data.name}</span>
        <Badge tone="primary" className="hidden sm:inline-flex">
          {ROLE_LABELS[org.data.role]}
        </Badge>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-label="Organizations" className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-card p-1 shadow-lg">
          {orgs.data?.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === org.data.id}
              onClick={() => void switchTo(o.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="flex-1 truncate">{o.name}</span>
              {o.id === org.data.id && <Check className="size-4 text-primary" aria-hidden="true" />}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <Link href="/onboarding/organization" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="size-4" aria-hidden="true" /> Create organization
          </Link>
        </div>
      )}
    </div>
  );
}
