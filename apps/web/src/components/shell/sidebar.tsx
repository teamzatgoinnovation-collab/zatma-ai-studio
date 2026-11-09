'use client';

import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Badge, cn, Tooltip } from '@zatma/ui';
import { Logo } from '../logo';
import { activeSectionId, isActiveHref, NAV, NAV_DIVIDERS, type NavSection } from '../nav';
import { OrgSwitcher } from '../org-switcher';

const itemBase =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function PhaseBadge({ phase }: { phase?: number }) {
  if (!phase) return null;
  return (
    <Badge className="px-1.5 py-0 text-[10px]" title={`Ships in Phase ${phase}`}>
      P{phase}
    </Badge>
  );
}

function SectionItem({
  section,
  pathname,
  collapsed,
  open,
  onToggle,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const Icon = section.icon;
  const inSection = activeSectionId(pathname) === section.id;
  const exact = pathname === section.href;

  // Leaf section, or any section when collapsed: a single link with a tooltip.
  if (!section.children || collapsed) {
    return (
      <Tooltip content={section.phase ? `${section.label} · Phase ${section.phase}` : section.label} disabled={!collapsed}>
        <Link
          href={section.href}
          onClick={onNavigate}
          aria-current={exact ? 'page' : undefined}
          aria-label={collapsed ? section.label : undefined}
          className={cn(
            itemBase,
            collapsed && 'justify-center px-0',
            inSection ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span className="flex-1 truncate">{section.label}</span>}
          {!collapsed && <PhaseBadge phase={section.phase} />}
        </Link>
      </Tooltip>
    );
  }

  const groupId = `nav-group-${section.id}`;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={groupId}
        className={cn(itemBase, inSection ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
      >
        <Icon className={cn('size-4 shrink-0', inSection && 'text-primary')} aria-hidden="true" />
        <span className="flex-1 truncate text-left">{section.label}</span>
        <PhaseBadge phase={section.phase} />
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <ul id={groupId} className="ml-5 mt-1 space-y-0.5 border-l border-border pl-3">
          {[{ label: `${section.label} overview`, href: section.href, phase: undefined }, ...section.children]
            .filter((c, i) => i > 0 || !section.children?.some((x) => x.href === section.href))
            .map((child) => {
              const active = pathname === child.href || (child.href !== section.href && isActiveHref(pathname, child.href));
              return (
                <li key={child.href}>
                  <Link
                    href={child.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span className="flex-1 truncate">{child.label}</span>
                  </Link>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeSectionId(pathname);
  // Groups the user explicitly opened or closed; otherwise the group containing the current page is open.
  const [explicit, setExplicit] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => explicit[id] ?? id === current;
  const toggle = (id: string) => setExplicit((prev) => ({ ...prev, [id]: !isOpen(id) }));

  return (
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
      {NAV.map((section) => (
        <div key={section.id}>
          {NAV_DIVIDERS.has(section.id) && <div className="my-3 h-px bg-border" role="separator" />}
          <SectionItem
            section={section}
            pathname={pathname}
            collapsed={collapsed}
            open={isOpen(section.id)}
            onToggle={() => toggle(section.id)}
            onNavigate={onNavigate}
          />
        </div>
      ))}
    </nav>
  );
}

/** Desktop sidebar: full width or collapsed to icons. */
export function Sidebar({ collapsed, onToggleCollapsed }: { collapsed: boolean; onToggleCollapsed: () => void }) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[76px]' : 'w-[268px]',
      )}
    >
      <div className={cn('flex h-16 items-center px-4', collapsed && 'justify-center px-0')}>
        <Link href="/dashboard" aria-label="ZatGo AI Marketing home" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo compact={collapsed} />
        </Link>
      </div>
      {!collapsed && (
        <div className="px-3 pb-3">
          <OrgSwitcher variant="sidebar" />
        </div>
      )}
      <SidebarNav collapsed={collapsed} />
      <div className={cn('border-t border-border p-3', collapsed && 'flex justify-center')}>
        <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(itemBase, 'text-muted-foreground hover:bg-muted hover:text-foreground', collapsed && 'w-auto justify-center px-3')}
          >
            {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
