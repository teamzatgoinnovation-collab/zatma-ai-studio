import { ArrowRight, CheckCircle2, Clock, Rocket } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from '@zatma/ui';
import type { NavLeaf, NavSection } from '../nav';

/** Related live features we can point people to while a module is being built. */
const AVAILABLE_NOW: Record<string, { label: string; href: string }[]> = {
  studio: [
    { label: 'Upload your organization logo', href: '/settings' },
    { label: 'Set the default content language', href: '/settings' },
  ],
  crm: [{ label: 'Invite your sales team', href: '/team' }],
  marketing: [{ label: 'Create a workspace per brand or client', href: '/dashboard' }],
  advertising: [{ label: 'Review your plan limits', href: '/billing' }],
  analytics: [{ label: 'See recent organization activity', href: '/dashboard#activity' }],
  assistant: [{ label: 'Check AI provider status', href: '/dashboard' }],
};

function PhaseBadge({ phase }: { phase?: number }) {
  return phase ? (
    <Badge tone="primary" className="gap-1">
      <Clock className="size-3" aria-hidden="true" /> Phase {phase}
    </Badge>
  ) : (
    <Badge tone="success">Live</Badge>
  );
}

/** Overview of a section: one card per module with its status. */
function SectionOverview({ section }: { section: NavSection }) {
  const Icon = section.icon;
  return (
    <div className="space-y-6">
      <PageHeader icon={<Icon />} title={section.label} description={section.description} actions={<PhaseBadge phase={section.phase} />} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {section.children!.map((c) => (
          <Link key={c.href} href={c.href} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{c.label}</CardTitle>
                  <PhaseBadge phase={c.phase} />
                </div>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Details <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Layout for a module that is planned but not built yet. Shows real plans, never sample data. */
function UpcomingModule({ section, leaf }: { section: NavSection; leaf?: NavLeaf }) {
  const entry = leaf ?? section;
  const Icon = section.icon;
  const now = AVAILABLE_NOW[section.id] ?? [];
  return (
    <div className="space-y-6">
      <PageHeader icon={<Icon />} title={entry.label} description={entry.description} actions={<PhaseBadge phase={entry.phase} />} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <EmptyState
            icon={<Rocket />}
            title={`${entry.label} is coming in Phase ${entry.phase}`}
            description="This module is on the roadmap. It will appear here with your organization's real data once it ships. Nothing on this page is sample data."
          />
        </div>
        <div className="space-y-4">
          {entry.features && entry.features.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>What&apos;s planned</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {entry.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {now.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Available now</CardTitle>
                <CardDescription>Get ready while this module is built.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {now.map((n) => (
                    <li key={n.label}>
                      <Link href={n.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                        <ArrowRight className="size-4 text-primary" aria-hidden="true" /> {n.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export function ModulePage({ section, leaf }: { section: NavSection; leaf?: NavLeaf }) {
  if (!leaf && section.children?.length) return <SectionOverview section={section} />;
  return <UpcomingModule section={section} leaf={leaf} />;
}
