'use client';

import { ChevronRight, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { breadcrumbsFor } from '../nav';

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        <li>
          <Link href="/dashboard" className="flex items-center text-muted-foreground hover:text-foreground" aria-label="Home">
            <Home className="size-4" aria-hidden="true" />
          </Link>
        </li>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.href} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {last ? (
                <span aria-current="page" className="truncate font-medium">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
