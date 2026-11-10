'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trophy, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Select,
  Skeleton,
} from '@zatma/ui';
import type { BoardDto, DealDto, StageDto } from '@zatma/validation';
import { api } from '@/lib/api';
import { formatDate, formatMoney, moveOnBoard } from '@/lib/crm';
import { DealSheet } from './forms';
import { describeError, FormSheet, OwnerChip, Tags, useCrmAccess, useDebounced, useMembers } from './shared';
import { ActivityComposer, Timeline } from './timeline';

type PendingMove = { deal: DealDto; stage: StageDto; beforeId: string | null };

export function PipelineBoard() {
  const qc = useQueryClient();
  const access = useCrmAccess();
  const members = useMembers(access.seesAll && access.loaded);
  const pipelines = useQuery({ queryKey: ['crm', 'pipelines'], queryFn: api.crm.pipelines.list });
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const activeId = pipelineId ?? pipelines.data?.[0]?.id ?? null;
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [ownerId, setOwnerId] = useState('');
  const key = ['crm', 'board', activeId, search, ownerId];
  const board = useQuery({
    queryKey: key,
    queryFn: () => api.crm.pipelines.board(activeId!, { ...(search ? { q: search } : {}), ...(ownerId ? { ownerId } : {}) }),
    enabled: !!activeId,
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<StageDto | null>(null);

  const move = useMutation({
    mutationFn: (m: PendingMove & { lostReason?: string }) => api.crm.deals.move(m.deal.id, { stageId: m.stage.id, beforeId: m.beforeId, ...(m.lostReason ? { lostReason: m.lostReason } : {}) }),
    onMutate: async (m) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardDto>(key);
      if (prev) qc.setQueryData<BoardDto>(key, { ...prev, columns: moveOnBoard(prev.columns, m.deal.id, m.stage.id, m.beforeId) });
      return { prev };
    },
    onSuccess: (d, m) => {
      if (m.stage.kind === 'WON') toast.success(`🎉 ${d.name} won`);
      else if (m.stage.kind === 'LOST') toast.success(`${d.name} marked lost`);
    },
    onError: (e, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(describeError(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });

  /** Closing stages ask for confirmation (and a reason for lost deals). */
  const requestMove = (deal: DealDto, stage: StageDto, beforeId: string | null) => {
    if (deal.stageId === stage.id && !beforeId) return;
    if (stage.kind !== 'OPEN' && deal.stageId !== stage.id) {
      setLostReason('');
      setPending({ deal, stage, beforeId });
      return;
    }
    move.mutate({ deal, stage, beforeId });
  };

  if (pipelines.isPending || (activeId && board.isPending)) return <Skeleton className="h-[60vh]" />;
  if (pipelines.isError || board.isError) return <ErrorState description="Couldn't load the pipeline." onRetry={() => void Promise.all([pipelines.refetch(), board.refetch()])} />;
  const data = board.data!;
  const stages = data.columns.map((c) => c.stage);
  const findDeal = (id: string) => data.columns.flatMap((c) => c.deals).find((d) => d.id === id);
  const openTotal = data.columns.filter((c) => c.stage.kind === 'OPEN').reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {pipelines.data!.length > 1 && (
          <div className="w-52">
            <Label htmlFor="pipeline-select" className="sr-only">
              Pipeline
            </Label>
            <Select id="pipeline-select" value={activeId ?? ''} onChange={(e) => setPipelineId(e.target.value)}>
              {pipelines.data!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="min-w-48 flex-1">
          <Label htmlFor="board-search" className="sr-only">
            Search deals
          </Label>
          <Input id="board-search" type="search" placeholder="Search deals" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {access.seesAll && (
          <div className="w-44">
            <Label htmlFor="board-owner" className="sr-only">
              Owner
            </Label>
            <Select id="board-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Owner: all</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <p className="ml-auto text-sm text-muted-foreground">
          Open pipeline: <strong className="text-foreground">{formatMoney(openTotal, data.currency)}</strong>
        </p>
      </div>
      <p className="sr-only" id="board-help">
        Drag a deal card to another column, or use its “Move” menu. With a card focused, press Alt and the left or right arrow to move it one stage.
      </p>

      <div className="flex gap-3 overflow-x-auto pb-3" aria-describedby="board-help">
        {data.columns.map((col, ci) => (
          <section
            key={col.stage.id}
            aria-label={`${col.stage.name}: ${col.count} deals, ${formatMoney(col.total, data.currency)}`}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/40 transition-colors',
              overStage === col.stage.id ? 'border-primary bg-primary/5' : 'border-border',
            )}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverStage(col.stage.id);
            }}
            onDragLeave={() => setOverStage((s) => (s === col.stage.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOverStage(null);
              const deal = dragId ? findDeal(dragId) : undefined;
              setDragId(null);
              if (deal) requestMove(deal, col.stage, null);
            }}
          >
            <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  {col.stage.kind === 'WON' && <Trophy className="size-3.5 text-success-text" aria-hidden="true" />}
                  {col.stage.kind === 'LOST' && <XCircle className="size-3.5 text-destructive" aria-hidden="true" />}
                  {col.stage.name}
                  <Badge className="px-1.5 py-0">{col.count}</Badge>
                </h2>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatMoney(col.total, data.currency)}
                  {col.stage.kind === 'OPEN' ? ` · ${col.stage.probability}%` : ''}
                </p>
              </div>
              {access.canWrite && col.stage.kind === 'OPEN' && (
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Add deal to ${col.stage.name}`} onClick={() => setCreatingIn(col.stage)}>
                  <Plus aria-hidden="true" />
                </Button>
              )}
            </header>
            <ol className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {col.deals.map((d) => (
                <li
                  key={d.id}
                  draggable={access.canWrite}
                  onDragStart={(e) => {
                    setDragId(d.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', d.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverStage(null);
                  }}
                  onDrop={(e) => {
                    // Dropping on a card inserts before it.
                    e.preventDefault();
                    e.stopPropagation();
                    setOverStage(null);
                    const deal = dragId ? findDeal(dragId) : undefined;
                    setDragId(null);
                    if (deal && deal.id !== d.id) requestMove(deal, col.stage, d.id);
                  }}
                  className={cn('group rounded-xl border border-border bg-card p-3 shadow-sm', access.canWrite && 'cursor-grab active:cursor-grabbing', dragId === d.id && 'opacity-50')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 text-left text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setOpenDeal(d.id)}
                      onKeyDown={(e) => {
                        if (!access.canWrite || !e.altKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
                        e.preventDefault();
                        const target = stages[ci + (e.key === 'ArrowRight' ? 1 : -1)];
                        if (target) requestMove(d, target, null);
                      }}
                    >
                      {d.name}
                    </button>
                    {access.canWrite && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="-mr-1 -mt-1 size-7 shrink-0" aria-label={`Move ${d.name}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Move to</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {stages
                            .filter((s) => s.id !== d.stageId)
                            .map((s) => (
                              <DropdownMenuItem key={s.id} onSelect={() => requestMove(d, s, null)}>
                                {s.name}
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-semibold tabular-nums">{formatMoney(d.value, d.currency)}</p>
                  {(d.company || d.contact) && <p className="truncate text-xs text-muted-foreground">{d.company?.name ?? d.contact?.name}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <OwnerChip owner={d.owner} />
                    {d.expectedCloseAt && <span>{formatDate(d.expectedCloseAt)}</span>}
                  </div>
                </li>
              ))}
              {col.deals.length === 0 && <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Drop deals here</li>}
            </ol>
          </section>
        ))}
      </div>
      {data.columns.every((c) => c.count === 0) && !search && (
        <EmptyState title="No deals in this pipeline yet" description="Add a deal with the + button on a stage, or convert a lead with “Create deal” selected." />
      )}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent
          title={pending?.stage.kind === 'WON' ? 'Mark deal as won?' : 'Mark deal as lost?'}
          description={pending ? (pending.stage.kind === 'WON' ? `“${pending.deal.name}” (${formatMoney(pending.deal.value, pending.deal.currency)}) will be closed as won and its contact becomes a customer.` : `“${pending.deal.name}” will be closed as lost.`) : undefined}
        >
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pending) return;
              if (pending.stage.kind === 'LOST' && lostReason.trim().length < 2) return;
              move.mutate({ ...pending, ...(pending.stage.kind === 'LOST' ? { lostReason: lostReason.trim() } : {}) });
              setPending(null);
            }}
          >
            {pending?.stage.kind === 'LOST' && (
              <div className="space-y-1.5">
                <Label htmlFor="lost-reason">Why was it lost?</Label>
                <Input id="lost-reason" required minLength={2} maxLength={300} value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Chose a competitor, budget, no response" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={pending?.stage.kind === 'LOST' ? 'destructive' : 'primary'}>
                {pending?.stage.kind === 'WON' ? 'Mark won' : 'Mark lost'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DealPanel dealId={openDeal} onClose={() => setOpenDeal(null)} />
      <DealSheet open={!!creatingIn} onOpenChange={(o) => !o && setCreatingIn(null)} defaults={creatingIn ? { stageId: creatingIn.id, pipelineId: activeId ?? '' } : {}} />
    </div>
  );
}

/** Deal details with its timeline, in a side sheet. */
export function DealPanel({ dealId, onClose }: { dealId: string | null; onClose: () => void }) {
  const access = useCrmAccess();
  const deal = useQuery({ queryKey: ['crm', 'deal', dealId], queryFn: () => api.crm.deals.get(dealId!), enabled: !!dealId });
  const timeline = useQuery({ queryKey: ['crm', 'deal', dealId, 'timeline'], queryFn: () => api.crm.deals.timeline(dealId!), enabled: !!dealId });
  const [editing, setEditing] = useState(false);
  const d = deal.data;
  return (
    <>
      <FormSheet open={!!dealId && !editing} onOpenChange={(o) => !o && onClose()} title={d?.name ?? 'Deal'}>
        {!d ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={d.status === 'WON' ? 'success' : d.status === 'LOST' ? 'danger' : 'primary'}>{d.stageName}</Badge>
              <span className="text-2xl font-semibold tabular-nums">{formatMoney(d.value, d.currency)}</span>
              {access.canWrite && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" /> Edit
                </Button>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Contact</dt>
                <dd>{d.contact ? <Link className="text-primary hover:underline" href={`/crm/contacts/${d.contact.id}`}>{d.contact.name}</Link> : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Company</dt>
                <dd>{d.company ? <Link className="text-primary hover:underline" href={`/crm/companies/${d.company.id}`}>{d.company.name}</Link> : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expected close</dt>
                <dd>{formatDate(d.expectedCloseAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Probability</dt>
                <dd>{d.probability}%</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>
                  <OwnerChip owner={d.owner} />
                </dd>
              </div>
              {d.lostReason && (
                <div>
                  <dt className="text-muted-foreground">Lost reason</dt>
                  <dd>{d.lostReason}</dd>
                </div>
              )}
              {d.tags.length > 0 && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Tags</dt>
                  <dd>
                    <Tags tags={d.tags} />
                  </dd>
                </div>
              )}
              {d.notes && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{d.notes}</dd>
                </div>
              )}
            </dl>
            <ActivityComposer link={{ dealId: d.id, ...(d.contact ? { contactId: d.contact.id } : {}) }} canWrite={access.canWrite} />
            <Timeline activities={timeline.data?.activities ?? []} canWrite={access.canWrite} />
          </div>
        )}
      </FormSheet>
      {d && <DealSheet open={editing} onOpenChange={setEditing} record={d} />}
    </>
  );
}
