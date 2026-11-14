'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, LayoutGrid, Pause, Play, Plus, Trash2, Wand2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, ErrorState, Input, Label, Select, Skeleton, Tabs } from '@zatma/ui';
import {
  ACTION_INFO,
  ACTION_KINDS,
  CONDITION_INFO,
  CONDITION_KINDS,
  TRIGGER_INFO,
  TRIGGER_KINDS,
  requiredPermissions,
  stableStringify,
  validateWorkflow,
  type ActionKind,
  type ConditionKind,
  type EdgeHandle,
  type NodeType,
  type TestRunResult,
  type TriggerKind,
  type WorkflowDto,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { autoLayout, defaultConfig, newNodeId, nextPosition, stepLabel, summarize, toFlow, toGraph, WORKFLOW_LABEL, WORKFLOW_TONE, type StepNode } from '@/lib/automation';
import { errorText } from '@/components/campaigns/shared';
import { RunsPanel } from './runs-panel';
import { StepNodeView, type DecoratedNode, type Outcome } from './step-node';
import { StepForm, type FormContext } from './step-forms';
import { TestDialog } from './test-dialog';

const nodeTypes = { step: StepNodeView };
const PERMISSION_TEXT: Record<string, string> = {
  'automation:write': 'build and run automations',
  'crm:write': 'change leads, contacts and deals, and create tasks',
  'campaign:write': 'enrol people in campaigns',
  'ai:generate': 'use AI credits to draft messages',
};

/** Whether connecting source → target would make the workflow loop back on itself. */
function wouldCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) return true;
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

const handlesOf = (type: NodeType): EdgeHandle[] => (type === 'condition' ? ['yes', 'no'] : ['next']);

export function AutomationEditor({ id }: { id: string }) {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const q = useQuery({ queryKey: ['automation', 'one', id], queryFn: () => api.automation.get(id) });
  const members = useQuery({ queryKey: ['organization', 'members'], queryFn: api.organizations.members });
  const campaigns = useQuery({ queryKey: ['campaigns', 'picker'], queryFn: () => api.campaigns.list({ pageSize: 100 }) });
  if (q.isPending || org.isPending) return <Skeleton className="h-[32rem]" />;
  if (q.isError) return <ErrorState description="Couldn't load this automation." onRetry={() => void q.refetch()} />;
  const ctx: FormContext = { members: (members.data ?? []).map((m) => ({ userId: m.userId, name: m.name })), campaigns: (campaigns.data?.data ?? []).map((c) => ({ id: c.id, name: c.name })) };
  return (
    <ReactFlowProvider>
      <Editor workflow={q.data} ctx={ctx} canWrite={org.data?.permissions.includes('automation:write') ?? false} />
    </ReactFlowProvider>
  );
}

function Editor({ workflow, ctx, canWrite }: { workflow: WorkflowDto; ctx: FormContext; canWrite: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const flow = useReactFlow();
  const initial = toFlow(workflow.graph);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [settings, setSettings] = useState(workflow.settings);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState('builder');
  const [dialog, setDialog] = useState<'activate' | 'test' | 'delete' | null>(null);
  const [result, setResult] = useState<TestRunResult | null>(null);

  const graph = toGraph(nodes, edges);
  const issues = validateWorkflow(graph);
  const errors = issues.filter((i) => i.level === 'error');
  const dirty = stableStringify(graph) !== stableStringify(workflow.graph) || name.trim() !== workflow.name || description !== workflow.description || stableStringify(settings) !== stableStringify(workflow.settings);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const live = workflow.status === 'ACTIVE';
  const outcomes = new Map<string, Outcome>((result?.path ?? []).map((p) => [p.nodeId, p.outcome]));

  const sync = async (dto: WorkflowDto) => {
    qc.setQueryData(['automation', 'one', dto.id], dto);
    await qc.invalidateQueries({ queryKey: ['automation'] });
  };
  const save = useMutation({
    mutationFn: () => api.automation.update(workflow.id, { name: name.trim(), description, graph, settings }),
    onSuccess: async (dto) => {
      await sync(dto);
      toast.success(live ? 'Saved. New runs use this version.' : 'Saved');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const activate = useMutation({
    mutationFn: async () => {
      if (dirty) await api.automation.update(workflow.id, { name: name.trim(), description, graph, settings });
      return api.automation.activate(workflow.id);
    },
    onSuccess: async (dto) => {
      await sync(dto);
      setDialog(null);
      toast.success('Automation is active');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const pause = useMutation({
    mutationFn: () => api.automation.pause(workflow.id),
    onSuccess: async (dto) => {
      await sync(dto);
      toast.success('Automation paused');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.automation.remove(workflow.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['automation'] });
      toast.success('Automation deleted');
      router.push('/marketing/automation');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  // ── editing ──
  const patchStep = (stepId: string, patch: Partial<StepNode['data']>) => setNodes((ns) => ns.map((n) => (n.id === stepId ? { ...n, data: { ...n.data, ...patch } } : n)));
  const connect = (source: string, handle: EdgeHandle, target: string | null) =>
    setEdges((es) => {
      const rest = es.filter((e) => !(e.source === source && (e.sourceHandle ?? 'next') === handle));
      return target && !wouldCycle(rest, source, target) ? [...rest, { id: `${source}-${handle}-${target}`, source, sourceHandle: handle, target }] : rest;
    });
  const addStep = (type: NodeType, kind: string, from?: { id: string; handle: EdgeHandle }) => {
    if (type === 'trigger') {
      const existing = nodes.find((n) => n.data.nodeType === 'trigger');
      if (existing) {
        patchStep(existing.id, { kind, config: defaultConfig('trigger', kind) });
        setSelectedId(existing.id);
        return;
      }
    }
    const stepId = newNodeId(nodes.map((n) => n.id), type);
    const parent = from ? nodes.find((n) => n.id === from.id) : selected;
    // Connect to the first free output of the selected step.
    const handle = from?.handle ?? (parent ? handlesOf(parent.data.nodeType).find((h) => !edges.some((e) => e.source === parent.id && (e.sourceHandle ?? 'next') === h)) : undefined);
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id: stepId, type: 'step' as const, position: nextPosition(ns, parent?.id ?? null, handle ?? 'next'), selected: true, data: { nodeType: type, kind, config: defaultConfig(type, kind) } }]);
    if (parent && handle && type !== 'trigger') setEdges((es) => [...es.filter((e) => !(e.source === parent.id && (e.sourceHandle ?? 'next') === handle)), { id: `${parent.id}-${handle}-${stepId}`, source: parent.id, sourceHandle: handle, target: stepId }]);
    setSelectedId(stepId);
  };
  const removeStep = (stepId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== stepId));
    setEdges((es) => es.filter((e) => e.source !== stepId && e.target !== stepId));
    setSelectedId(null);
  };
  const tidy = () => {
    const laid = autoLayout(graph);
    setNodes((ns) => ns.map((n) => ({ ...n, position: laid.nodes.find((x) => x.id === n.id)?.position ?? n.position })));
    window.setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }), 30);
  };

  const issuesOf = (nodeId: string) => issues.filter((i) => i.nodeId === nodeId);
  const shown: DecoratedNode[] = nodes.map((n) => ({
    ...n,
    ariaLabel: `${stepLabel(n.data.nodeType, n.data.kind)}: ${summarize(n.data.nodeType, n.data.kind, n.data.config)}`,
    data: { ...n.data, issues: issuesOf(n.id), outcome: outcomes.get(n.id) ?? null },
  }));
  const shownEdges: Edge[] = edges.map((e) => {
    const onPath = outcomes.has(e.source) && outcomes.has(e.target);
    // Yes / No are labelled on the step itself, so the lines stay clean.
    return { ...e, animated: onPath, style: onPath ? { stroke: 'var(--color-success)', strokeWidth: 2 } : undefined };
  });

  const stepsInOrder = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const perms = requiredPermissions(graph);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="wf-name">Name</Label>
            <Input id="wf-name" value={name} maxLength={120} disabled={!canWrite} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Badge tone={WORKFLOW_TONE[workflow.status]}>{WORKFLOW_LABEL[workflow.status]}</Badge>
            {workflow.owner && live && <span className="text-xs text-muted-foreground">runs as {workflow.owner.name}</span>}
          </div>
          {canWrite && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDialog('test')} disabled={errors.length > 0 && !nodes.some((n) => n.data.nodeType === 'trigger')}>
                <Wand2 aria-hidden="true" /> Test run
              </Button>
              <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              {live ? (
                <Button variant="outline" disabled={pause.isPending} onClick={() => pause.mutate()}>
                  <Pause aria-hidden="true" /> Pause
                </Button>
              ) : (
                <Button onClick={() => setDialog('activate')}>
                  <Play aria-hidden="true" /> Activate
                </Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Delete automation" onClick={() => setDialog('delete')}>
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          )}
        </CardContent>
        {workflow.pausedReason && workflow.status === 'PAUSED' && (
          <div className="border-t border-border px-4 py-3 text-sm text-warning-text">
            <AlertTriangle className="mr-1.5 inline size-4" aria-hidden="true" />
            Paused: {workflow.pausedReason}
          </div>
        )}
        {live && dirty && <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">This automation is running. Saving applies your changes to new runs and checks your permissions again.</div>}
      </Card>

      <Tabs label="Automation sections" items={[{ id: 'builder', label: 'Builder' }, { id: 'runs', label: 'Runs' }, { id: 'settings', label: 'Settings' }]} value={tab} onChange={setTab} withPanels />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'builder' && (
          <div className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_21rem]">
            {canWrite && <Palette onAdd={(t, k) => addStep(t, k)} />}
            <div className="space-y-3 xl:order-none">
              <div role="group" className="h-[34rem] overflow-hidden rounded-2xl border border-border bg-card" aria-label="Workflow canvas. Use the step list to build without dragging.">
                <ReactFlow
                  nodes={shown}
                  edges={shownEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={(c: Connection) => c.source && connect(c.source, (c.sourceHandle ?? 'next') as EdgeHandle, c.target)}
                  isValidConnection={(c) => !!c.source && !!c.target && !wouldCycle(edges, c.source, c.target) && nodes.find((n) => n.id === c.target)?.data.nodeType !== 'trigger'}
                  onNodeClick={(_, n) => setSelectedId(n.id)}
                  onPaneClick={() => setSelectedId(null)}
                  onBeforeDelete={async ({ nodes: ns, edges: es }) => ({ nodes: ns.filter((n) => (n.data as { nodeType?: string }).nodeType !== 'trigger'), edges: es })}
                  nodesDraggable={canWrite}
                  nodesConnectable={canWrite}
                  deleteKeyCode={canWrite ? ['Backspace', 'Delete'] : null}
                  fitView
                  fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                  minZoom={0.3}
                  colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
                >
                  <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable ariaLabel="Overview of the workflow" style={{ width: 110, height: 72 }} className="!hidden 2xl:!block" />
                </ReactFlow>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canWrite && (
                  <Button variant="outline" size="sm" onClick={tidy}>
                    <LayoutGrid aria-hidden="true" /> Tidy up
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">Drag from the dot under a step to connect it. Select a step to edit it. Backspace removes the selected step or line.</p>
              </div>
              {result && <TestResult result={result} onClear={() => setResult(null)} />}
              {issues.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Checks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5 text-sm">
                      {issues.map((i, k) => (
                        <li key={`${i.code}-${i.nodeId ?? ''}-${k}`} className="flex items-start gap-2">
                          <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${i.level === 'error' ? 'text-destructive-text' : 'text-warning-text'}`} aria-hidden="true" />
                          <span>
                            <span className="sr-only">{i.level === 'error' ? 'Problem: ' : 'Warning: '}</span>
                            {i.nodeId && (
                              <button type="button" className="mr-1 font-medium underline" onClick={() => setSelectedId(i.nodeId!)}>
                                {stepLabel(nodes.find((n) => n.id === i.nodeId)?.data.nodeType ?? 'action', nodes.find((n) => n.id === i.nodeId)?.data.kind ?? '')}
                              </button>
                            )}
                            {i.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
            <Inspector
              nodes={nodes}
              edges={edges}
              order={stepsInOrder}
              selected={selected}
              ctx={ctx}
              canWrite={canWrite}
              onSelect={setSelectedId}
              onPatch={patchStep}
              onKind={(stepId, type, kind) => patchStep(stepId, { kind, config: defaultConfig(type, kind) })}
              onConnect={connect}
              onAdd={addStep}
              onRemove={removeStep}
            />
          </div>
        )}
        {tab === 'runs' && <RunsPanel workflowId={workflow.id} canRetry={canWrite} />}
        {tab === 'settings' && (
          <Card>
            <CardContent className="grid gap-4 p-5 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="wf-desc">Description</Label>
                <textarea id="wf-desc" className="min-h-20 w-full rounded-xl border border-input bg-background p-3 text-sm" value={description} maxLength={1000} disabled={!canWrite} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-rate">Most runs per hour</Label>
                <Input id="wf-rate" type="number" min={1} max={10000} value={settings.maxRunsPerHour} disabled={!canWrite} onChange={(e) => setSettings({ ...settings, maxRunsPerHour: Math.max(1, Number(e.target.value) || 1) })} />
                <p className="text-xs text-muted-foreground">Extra events are skipped and logged, so one busy hour can&apos;t use up your plan.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-cool">Wait before running again for the same record (minutes)</Label>
                <Input id="wf-cool" type="number" min={0} max={10080} value={settings.reentryCooldownMinutes} disabled={!canWrite} onChange={(e) => setSettings({ ...settings, reentryCooldownMinutes: Math.max(0, Number(e.target.value) || 0) })} />
                <p className="text-xs text-muted-foreground">Stops a record from triggering the same automation over and over.</p>
              </div>
              <p className="text-sm text-muted-foreground md:col-span-2">
                Automations started by other automations stop after three levels, and an automation never restarts itself. Save to apply changes.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialog === 'activate'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Start this automation?" description="It will run on its own whenever its trigger happens.">
          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-xl border border-border p-4">
              <p className="font-medium">It runs as you, with your permissions:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {perms.map((p) => (
                  <li key={p}>
                    <span className="font-mono text-xs">{p}</span>: {PERMISSION_TEXT[p] ?? p}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">If your role changes later, runs stop and the automation pauses. Nothing is ever sent to customers from here; email and WhatsApp to leads arrive in Phase 14.</p>
            </div>
            {errors.length > 0 && <Alert>{errors[0]!.message}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button disabled={errors.length > 0 || activate.isPending} onClick={() => activate.mutate()}>
                {dirty ? 'Save and activate' : 'Activate'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <TestDialog
        open={dialog === 'test'}
        workflowId={workflow.id}
        triggerKind={(nodes.find((n) => n.data.nodeType === 'trigger')?.data.kind ?? null) as TriggerKind | null}
        dirty={dirty}
        saveFirst={() => save.mutateAsync().then(() => undefined)}
        onClose={() => setDialog(null)}
        onResult={(r) => {
          setResult(r);
          setDialog(null);
          setTab('builder');
        }}
      />
      <Dialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Delete automation?" description="Its run history is kept for reporting but it stops running immediately.">
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Palette({ onAdd }: { onAdd: (type: NodeType, kind: string) => void }) {
  const group = (title: string, items: Array<{ type: NodeType; kind: string; label: string; disabled?: string }>) => (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={`${i.type}-${i.kind}`}>
            <button
              type="button"
              disabled={!!i.disabled}
              title={i.disabled}
              onClick={() => onAdd(i.type, i.kind)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{i.label}</span>
              {i.disabled ? <span className="text-[10px] text-muted-foreground">Phase 14</span> : <Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <aside aria-label="Add a step" className="max-h-[34rem] space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-3 xl:max-h-[40rem]">
      <p className="text-xs text-muted-foreground">Click to add after the selected step.</p>
      {group('Trigger', TRIGGER_KINDS.map((k) => ({ type: 'trigger' as const, kind: k, label: TRIGGER_INFO[k as TriggerKind].label })))}
      {group('Condition', CONDITION_KINDS.map((k) => ({ type: 'condition' as const, kind: k, label: CONDITION_INFO[k as ConditionKind].label })))}
      {group('Action', ACTION_KINDS.map((k) => ({ type: 'action' as const, kind: k, label: ACTION_INFO[k as ActionKind].label, ...(ACTION_INFO[k as ActionKind].available ? {} : { disabled: ACTION_INFO[k as ActionKind].note }) })))}
      {group('Timing', [{ type: 'delay', kind: 'delay', label: 'Wait' }])}
    </aside>
  );
}

function Inspector({
  nodes,
  edges,
  order,
  selected,
  ctx,
  canWrite,
  onSelect,
  onPatch,
  onKind,
  onConnect,
  onAdd,
  onRemove,
}: {
  nodes: StepNode[];
  edges: Edge[];
  order: StepNode[];
  selected: StepNode | null;
  ctx: FormContext;
  canWrite: boolean;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<StepNode['data']>) => void;
  onKind: (id: string, type: NodeType, kind: string) => void;
  onConnect: (source: string, handle: EdgeHandle, target: string | null) => void;
  onAdd: (type: NodeType, kind: string, from?: { id: string; handle: EdgeHandle }) => void;
  onRemove: (id: string) => void;
}) {
  const kinds = (type: NodeType) =>
    type === 'trigger' ? TRIGGER_KINDS.map((k) => [k, TRIGGER_INFO[k as TriggerKind].label] as const) : type === 'condition' ? CONDITION_KINDS.map((k) => [k, CONDITION_INFO[k as ConditionKind].label] as const) : ACTION_KINDS.filter((k) => ACTION_INFO[k as ActionKind].available).map((k) => [k, ACTION_INFO[k as ActionKind].label] as const);
  return (
    <aside aria-label="Step details" className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <section aria-label="All steps">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</h3>
        <ol className="space-y-1">
          {order.map((n, i) => (
            <li key={n.id}>
              <button type="button" aria-current={n.id === selected?.id ? 'true' : undefined} onClick={() => onSelect(n.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted ${n.id === selected?.id ? 'bg-muted font-medium' : ''}`}>
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted-foreground/15 text-[11px]">{i + 1}</span>
                <span className="truncate">{stepLabel(n.data.nodeType, n.data.kind)}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      {!selected ? (
        <p className="text-sm text-muted-foreground">Select a step on the canvas or in the list to edit it.</p>
      ) : (
        <fieldset disabled={!canWrite} className="space-y-4 border-t border-border pt-4">
          <legend className="sr-only">Edit {stepLabel(selected.data.nodeType, selected.data.kind)}</legend>
          <h3 className="font-semibold">{stepLabel(selected.data.nodeType, selected.data.kind)}</h3>
          {selected.data.nodeType !== 'delay' && (
            <div className="space-y-1.5">
              <Label htmlFor={`${selected.id}-kind`}>{selected.data.nodeType === 'trigger' ? 'Starts when' : selected.data.nodeType === 'condition' ? 'Check' : 'Do this'}</Label>
              <Select id={`${selected.id}-kind`} value={selected.data.kind} onChange={(e) => onKind(selected.id, selected.data.nodeType, e.target.value)}>
                {kinds(selected.data.nodeType).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <StepForm stepId={selected.id} nodeType={selected.data.nodeType} kind={selected.data.kind} config={selected.data.config} ctx={ctx} onChange={(patch) => onPatch(selected.id, { config: { ...selected.data.config, ...patch } })} />
          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="text-sm font-medium">What happens next</h4>
            {handlesOf(selected.data.nodeType).map((h) => {
              const edge = edges.find((e) => e.source === selected.id && (e.sourceHandle ?? 'next') === h);
              const label = h === 'yes' ? 'If yes, go to' : h === 'no' ? 'If no, go to' : 'Then go to';
              return (
                <div key={h} className="space-y-1.5">
                  <Label htmlFor={`${selected.id}-${h}`}>{label}</Label>
                  <Select
                    id={`${selected.id}-${h}`}
                    value={edge?.target ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__new_action') onAdd('action', 'add_tag', { id: selected.id, handle: h });
                      else if (v === '__new_delay') onAdd('delay', 'delay', { id: selected.id, handle: h });
                      else onConnect(selected.id, h, v || null);
                    }}
                  >
                    <option value="">{selected.data.nodeType === 'condition' ? 'Nothing (the workflow ends)' : 'Nothing (it ends here)'}</option>
                    {nodes
                      .filter((n) => n.id !== selected.id && n.data.nodeType !== 'trigger')
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {order.indexOf(n) + 1}. {stepLabel(n.data.nodeType, n.data.kind)}
                        </option>
                      ))}
                    <option value="__new_action">＋ New action…</option>
                    <option value="__new_delay">＋ New wait…</option>
                  </Select>
                </div>
              );
            })}
          </div>
          {selected.data.nodeType !== 'trigger' && (
            <Button type="button" variant="outline" size="sm" onClick={() => onRemove(selected.id)}>
              <Trash2 aria-hidden="true" /> Remove step
            </Button>
          )}
        </fieldset>
      )}
    </aside>
  );
}

function TestResult({ result, onClear }: { result: TestRunResult; onClear: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Test run: what would happen</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ol className="space-y-1">
          {result.path.map((p, i) => (
            <li key={`${p.nodeId}-${i}`}>
              <span className="font-medium">{p.label}</span>
              {p.outcome === 'yes' || p.outcome === 'no' ? <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">{p.outcome === 'yes' ? 'Yes' : 'No'}</span> : null}
              {p.outcome === 'would_wait' && <span className="ml-1.5 text-muted-foreground">waits {p.detail}</span>}
              {p.outcome === 'run' && p.detail && <span className="ml-1.5 text-muted-foreground">{p.detail}</span>}
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{result.wouldWrite.length ? `It would: ${result.wouldWrite.join('; ')}.` : 'It would not change anything.'} This was a dry run: nothing was changed, sent or charged.</p>
      </CardContent>
    </Card>
  );
}
