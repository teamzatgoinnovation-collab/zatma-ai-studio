'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, Building2, CheckCircle2, CreditCard, Database, Layers, Server, Users, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Card, ErrorState, PageHeader, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@zatma/ui';
import { ROLE_LABELS } from '@zatma/types';
import Link from 'next/link';
import { api } from '@/lib/api';
import { describeActivity } from '@/lib/activity';
import { WorkspacesCard } from './workspaces-card';

const formatDate = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

function StatCard({ icon, label, value, hint, loading }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; loading?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="h-6 w-24" /> : <p className="truncate text-xl font-semibold">{value}</p>}
          {hint && !loading && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function Status({ up, label }: { up: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {up ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> : <XCircle className="size-4 text-destructive" aria-hidden="true" />}
      {label}
      <span className="sr-only">{up ? 'up' : 'down'}</span>
    </span>
  );
}

export function Dashboard() {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 });
  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: api.organizations.members });
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: api.ai.providers });
  const canReadAudit = org.data?.permissions.includes('audit:read') ?? false;
  const audit = useQuery({ queryKey: ['audit-logs'], queryFn: () => api.auditLogs.list({ pageSize: 8 }), enabled: canReadAudit });

  if (org.isError) return <ErrorState description={org.error.message} onRetry={() => void org.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.data ? `Welcome to ${org.data.name}` : 'Dashboard'}
        description="Your organization at a glance. Modules light up here as each phase ships."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Building2 className="size-5" />}
          label="Organization"
          loading={org.isPending}
          value={org.data?.name}
          hint={org.data && `${ROLE_LABELS[org.data.role]} · ${org.data.currency} · ${org.data.timezone}`}
        />
        <StatCard
          icon={<CreditCard className="size-5" />}
          label="Plan"
          loading={org.isPending}
          value={org.data?.subscription?.plan.name ?? 'None'}
          hint={org.data?.subscription && `${org.data.subscription.plan.limits.aiCredits} AI credits / month`}
        />
        <StatCard icon={<Users className="size-5" />} label="Team members" loading={members.isPending} value={members.data?.length ?? '–'} />
        <StatCard
          icon={<Server className="size-5" />}
          label="Platform status"
          loading={health.isPending}
          value={health.data ? (health.data.status === 'ok' ? 'Operational' : 'Degraded') : 'Unreachable'}
          hint={
            health.data && (
              <span className="flex gap-3">
                <Status up={health.data.checks.database === 'up'} label="Database" />
                <Status up={health.data.checks.redis === 'up'} label="Redis" />
              </span>
            )
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WorkspacesCard canCreate={org.data?.permissions.includes('workspace:create') ?? false} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-primary" aria-hidden="true" /> AI providers
            </CardTitle>
            <CardDescription>Generation adapters are connected in Phase 4.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {providers.isPending && <Skeleton className="h-16" />}
            {providers.data?.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.capabilities.join(' · ')}</p>
                </div>
                <Badge tone={p.implemented ? 'success' : p.configured ? 'primary' : 'neutral'}>
                  {p.implemented ? 'Active' : p.configured ? 'Key set' : 'Not configured'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden="true" /> Team
            </CardTitle>
            <CardDescription>
              <Link href="/team" className="font-medium text-primary hover:underline">
                Manage team &amp; invitations
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {members.isPending && <Skeleton className="h-10" />}
            {members.data?.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-secondary/15 text-sm font-semibold text-secondary">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                {m.role && <Badge>{ROLE_LABELS[m.role]}</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="scroll-mt-24 xl:col-span-2" id="activity">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-primary" aria-hidden="true" /> Recent activity
            </CardTitle>
            <CardDescription>Audit trail of changes in this organization.</CardDescription>
          </CardHeader>
          <CardContent>
            {!canReadAudit && !org.isPending && <p className="text-sm text-muted-foreground">Your role cannot view the audit log.</p>}
            {audit.isPending && canReadAudit && <Skeleton className="h-24" />}
            {audit.data && audit.data.data.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
            <ul className="divide-y divide-border">
              {audit.data?.data.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1">
                    {describeActivity(entry)}
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>
                    {formatDate(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Database className="size-3.5" aria-hidden="true" /> All data shown is live from the ZatGo API.
      </p>
    </div>
  );
}
