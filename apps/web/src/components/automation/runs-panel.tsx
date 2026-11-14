'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton } from '@zatma/ui';
import { RUN_STATUSES, TRIGGER_INFO, type RunDto, type RunStatus } from '@zatma/validation';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/activity';
import { RUN_LABEL, RUN_TONE } from '@/lib/automation';
import { useNow } from '@/lib/use-now';
import { errorText } from '@/components/campaigns/shared';

const recordHref = (r: RunDto['trigger']): string | null => (r.entityType === 'lead' ? `/crm/leads/${r.entityId}` : r.entityType === 'contact' ? `/crm/contacts/${r.entityId}` : r.entityType === 'deal' ? `/crm/deals/${r.entityId}` : null);
const STEP_TONE = { SUCCEEDED: 'success', FAILED: 'danger', SKIPPED: 'neutral', WAITING: 'primary' } as const;

function duration(r: RunDto): string {
  if (!r.finishedAt) return '–';
  const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
  return ms < 1000 ? '<1 s' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/** Execution log: every run with its trigger record, and the step-by-step timeline when opened. */
export function RunsPanel({ workflowId, canRetry }: { workflowId?: string; canRetry: boolean }) {
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [status, setStatus] = useState<'' | RunStatus>('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['automation', 'runs', workflowId ?? 'all', status, page],
    queryFn: () => (workflowId ? api.automation.workflowRuns(workflowId, { status: status || undefined, page, pageSize: 20 }) : api.automation.runs({ status: status || undefined, page, pageSize: 20 })),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.data.some((r) => r.status === 'RUNNING' || r.status === 'WAITING') ? 5_000 : false),
  });
  const retry = useMutation({
    mutationFn: (runId: string) => api.automation.retryRun(runId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['automation'] });
      toast.success('Retrying from the step that failed');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status" className="w-44" value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setPage(1))}>
          <option value="">All statuses</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {RUN_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <ErrorState description="Couldn't load runs." onRetry={() => void q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <EmptyState title="No runs yet" description="Runs appear here when the trigger happens, including ones that were skipped and why." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Automation runs</caption>
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 p-3" />
                {!workflowId && <th className="p-3 font-medium">Automation</th>}
                <th className="p-3 font-medium">Started by</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">When</th>
                <th className="p-3 font-medium">Took</th>
              </tr>
            </thead>
            {q.data.data.map((r) => {
              const expanded = open === r.id;
              const href = recordHref(r.trigger);
              return (
                <tbody key={r.id} className="divide-y divide-border border-b border-border last:border-0">
                  <tr className="hover:bg-muted/50">
                    <td className="p-3">
                      <button type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} steps of the run for ${r.trigger.entityLabel ?? r.trigger.entityType}`} onClick={() => setOpen(expanded ? null : r.id)}>
                        {expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                      </button>
                    </td>
                    {!workflowId && (
                      <td className="p-3">
                        <Link href={`/marketing/automation/${r.workflowId}`} className="font-medium hover:underline">
                          {r.workflowName}
                        </Link>
                      </td>
                    )}
                    <td className="p-3">
                      <span className="text-muted-foreground">{TRIGGER_INFO[r.trigger.kind]?.label ?? r.trigger.kind}</span>
                      <br />
                      {href && r.trigger.entityLabel ? (
                        <Link href={href} className="hover:underline">
                          {r.trigger.entityLabel}
                        </Link>
                      ) : (
                        <span>{r.trigger.entityLabel ?? r.trigger.entityType}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                      {r.depth > 0 && <span className="ml-1.5 text-xs text-muted-foreground">level {r.depth + 1}</span>}
                    </td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{timeAgo(r.startedAt, now)}</td>
                    <td className="p-3">{duration(r)}</td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={workflowId ? 5 : 6} className="bg-muted/30 p-4">
                        <RunDetail run={r} canRetry={canRetry} retrying={retry.isPending} onRetry={() => retry.mutate(r.id)} />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </Card>
      )}
      {q.data && q.data.meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {q.data.meta.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= q.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function RunDetail({ run, canRetry, retrying, onRetry }: { run: RunDto; canRetry: boolean; retrying: boolean; onRetry: () => void }) {
  const q = useQuery({ queryKey: ['automation', 'run', run.id, run.status], queryFn: () => api.automation.run(run.id) });
  if (q.isPending) return <Skeleton className="h-16" />;
  if (q.isError) return <p className="text-sm text-destructive-text">Couldn&apos;t load the steps.</p>;
  const d = q.data;
  return (
    <div className="space-y-3 text-sm">
      {d.skipReason && <p className="text-muted-foreground">{d.skipReason.replace(/^[A-Z_]+: /, '')}</p>}
      {d.error && <p className="text-destructive-text">{d.error}</p>}
      {d.steps && d.steps.length > 0 && (
        <ol className="space-y-1.5">
          {d.steps.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-2">
              <Badge tone={STEP_TONE[s.status]}>{s.status.toLowerCase()}</Badge>
              <span className="font-medium">{s.label}</span>
              {s.attempts > 1 && <span className="text-xs text-muted-foreground">{s.attempts} attempts</span>}
              {s.output && Object.keys(s.output).length > 0 && <span className="text-xs text-muted-foreground">{Object.entries(s.output).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</span>}
              {s.error && <span className="text-destructive-text">{s.error}</span>}
            </li>
          ))}
        </ol>
      )}
      {run.status === 'FAILED' && canRetry && (
        <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
          <RotateCcw aria-hidden="true" /> Retry from the failed step
        </Button>
      )}
    </div>
  );
}
