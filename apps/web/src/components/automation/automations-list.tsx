'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, ErrorState, Input, Meter, Select, Skeleton, Tabs } from '@zatma/ui';
import { TRIGGER_INFO, TRIGGER_KINDS, type WorkflowTemplate } from '@zatma/validation';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/activity';
import { autoLayout, RUN_LABEL, RUN_TONE, WORKFLOW_LABEL, WORKFLOW_TONE } from '@/lib/automation';
import { useNow } from '@/lib/use-now';
import { errorText } from '@/components/campaigns/shared';
import { RunsPanel } from './runs-panel';

const BLANK = { nodes: [{ id: 't1', type: 'trigger' as const, kind: 'lead.created', config: { sources: [] }, position: { x: 0, y: 0 } }], edges: [] };

export function AutomationsHome() {
  const [tab, setTab] = useState('automations');
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  return (
    <div className="space-y-4">
      <Tabs label="Automation sections" items={[{ id: 'automations', label: 'Automations' }, { id: 'runs', label: 'Run log' }]} value={tab} onChange={setTab} withPanels />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'automations' ? <List canWrite={org.data?.permissions.includes('automation:write') ?? false} /> : <RunsPanel canRetry={org.data?.permissions.includes('automation:write') ?? false} />}
      </div>
    </div>
  );
}

function List({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const now = useNow(60_000);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const list = useQuery({ queryKey: ['automation', 'list', status, q], queryFn: () => api.automation.list({ status: status || undefined, q: q.trim() || undefined, pageSize: 50 }), placeholderData: keepPreviousData });
  const stats = useQuery({ queryKey: ['automation', 'stats'], queryFn: api.automation.stats });
  const create = useMutation({
    mutationFn: (t: { name: string; graph: typeof BLANK; description?: string }) => api.automation.create({ name: t.name, description: t.description ?? '', graph: t.graph }),
    onSuccess: (dto) => router.push(`/marketing/automation/${dto.id}`),
    onError: (e) => toast.error(errorText(e)),
  });
  const fromTemplate = (t: WorkflowTemplate) => create.mutate({ name: t.name, description: t.description, graph: autoLayout(t.graph) as typeof BLANK });
  return (
    <div className="space-y-4">
      {stats.data && stats.data.runLimit !== -1 && (
        <Card className="p-4">
          <Meter label="Automation runs this month" used={stats.data.runsThisMonth} limit={stats.data.runLimit} />
          {stats.data.skipped > 0 && <p className="mt-2 text-xs text-muted-foreground">{stats.data.skipped} run{stats.data.skipped === 1 ? ' was' : 's were'} skipped this month (limits or loop protection). See the run log.</p>}
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search automations" placeholder="Search automations" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="DRAFT">Draft</option>
        </Select>
        {canWrite && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setPicking(true)}>
              From a template
            </Button>
            <Button disabled={create.isPending} onClick={() => create.mutate({ name: 'New automation', graph: BLANK })}>
              <Plus aria-hidden="true" /> New automation
            </Button>
          </div>
        )}
      </div>
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : list.isError ? (
        <ErrorState description="Couldn't load automations." onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          icon={<Workflow />}
          title={status || q ? 'No matching automations' : 'No automations yet'}
          description="Set rules like “when a hot lead arrives, assign a salesperson and create a call task”. Start from a template or build your own on a canvas."
          action={
            canWrite && !(status || q) ? (
              <Button variant="outline" onClick={() => setPicking(true)}>
                Start from a template
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">Automations</caption>
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Automation</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Starts when</th>
                <th className="p-3 text-right font-medium">Runs this month</th>
                <th className="p-3 text-right font-medium">Failed</th>
                <th className="p-3 font-medium">Last run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.data.map((w) => (
                <tr key={w.id} className="hover:bg-muted/50">
                  <td className="p-3">
                    <Link href={`/marketing/automation/${w.id}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                    {w.issues.some((i) => i.level === 'error') && w.status === 'DRAFT' && <span className="block text-xs text-muted-foreground">Needs finishing before it can be activated</span>}
                    {w.pausedReason && w.status === 'PAUSED' && <span className="block text-xs text-warning-text">{w.pausedReason.slice(0, 90)}</span>}
                  </td>
                  <td className="p-3">
                    <Badge tone={WORKFLOW_TONE[w.status]}>{WORKFLOW_LABEL[w.status]}</Badge>
                  </td>
                  <td className="p-3">{w.triggerKind ? TRIGGER_INFO[w.triggerKind].label : '–'}</td>
                  <td className="p-3 text-right tabular-nums">{w.stats.runsThisMonth.toLocaleString('en-IN')}</td>
                  <td className="p-3 text-right tabular-nums">{w.stats.failuresThisMonth}</td>
                  <td className="p-3 whitespace-nowrap">
                    {w.stats.lastRunAt ? (
                      <>
                        <Badge tone={RUN_TONE[w.stats.lastStatus!]}>{RUN_LABEL[w.stats.lastStatus!]}</Badge> <span className="text-muted-foreground">{timeAgo(w.stats.lastRunAt, now)}</span>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <TemplatePicker open={picking} onClose={() => setPicking(false)} onPick={fromTemplate} busy={create.isPending} />
    </div>
  );
}

function TemplatePicker({ open, onClose, onPick, busy }: { open: boolean; onClose: () => void; onPick: (t: WorkflowTemplate) => void; busy: boolean }) {
  const templates = useQuery({ queryKey: ['automation', 'templates'], queryFn: api.automation.templates, enabled: open });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Start from a template" description="You'll choose people and campaigns on the next screen. Nothing runs until you activate it.">
        <ul className="mt-4 space-y-2">
          {templates.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            templates.data?.map((t) => (
              <li key={t.id}>
                <button type="button" disabled={busy} onClick={() => onPick(t)} className="w-full rounded-xl border border-border p-3 text-left hover:bg-muted disabled:opacity-60">
                  <span className="block font-medium">{t.name}</span>
                  <span className="block text-sm text-muted-foreground">{t.description}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Starts when: {TRIGGER_INFO[t.graph.nodes.find((n) => n.type === 'trigger')!.kind as (typeof TRIGGER_KINDS)[number]].label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
