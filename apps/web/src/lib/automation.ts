import type { Edge, Node } from '@xyflow/react';
import {
  ACTION_INFO,
  CONDITION_INFO,
  NUM_OP_LABELS,
  TRIGGER_INFO,
  nodeLabel,
  type ActionKind,
  type ConditionKind,
  type EdgeHandle,
  type NodeType,
  type RunStatus,
  type TriggerKind,
  type WorkflowGraph,
  type WorkflowStatus,
} from '@zatma/validation';
import type { Tone } from './publishing';

export interface StepData extends Record<string, unknown> {
  nodeType: NodeType;
  kind: string;
  config: Record<string, unknown>;
}
export type StepNode = Node<StepData, 'step'>;

export const WORKFLOW_TONE: Record<WorkflowStatus, Tone> = { DRAFT: 'neutral', ACTIVE: 'success', PAUSED: 'warning' };
export const WORKFLOW_LABEL: Record<WorkflowStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', PAUSED: 'Paused' };
export const RUN_TONE: Record<RunStatus, Tone> = { RUNNING: 'primary', WAITING: 'primary', SUCCEEDED: 'success', FAILED: 'danger', SKIPPED: 'neutral', CANCELLED: 'neutral' };
export const RUN_LABEL: Record<RunStatus, string> = { RUNNING: 'Running', WAITING: 'Waiting', SUCCEEDED: 'Succeeded', FAILED: 'Failed', SKIPPED: 'Skipped', CANCELLED: 'Cancelled' };

// ───────────── Graph ⇄ canvas ─────────────

export function toFlow(graph: WorkflowGraph): { nodes: StepNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: 'step' as const, position: n.position, data: { nodeType: n.type, kind: n.kind, config: n.config } })),
    edges: graph.edges.map((e) => ({ id: `${e.source}-${e.sourceHandle}-${e.target}`, source: e.source, sourceHandle: e.sourceHandle, target: e.target })),
  };
}

export function toGraph(nodes: StepNode[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, kind: n.data.kind, config: n.data.config, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: edges.map((e) => ({ source: e.source, sourceHandle: (e.sourceHandle ?? 'next') as EdgeHandle, target: e.target })),
  };
}

export function newNodeId(existing: readonly string[], type: NodeType): string {
  const prefix = { trigger: 't', condition: 'c', action: 'a', delay: 'd' }[type];
  for (let i = 1; ; i++) if (!existing.includes(`${prefix}${i}`)) return `${prefix}${i}`;
}

// ───────────── Defaults and summaries ─────────────

const DEFAULTS: Record<NodeType, Record<string, Record<string, unknown>>> = {
  trigger: {
    'lead.created': { sources: [] },
    'lead.status_changed': { from: [], to: [] },
    'contact.became_customer': {},
    'form.submitted': { campaignId: null },
    'campaign.interaction': { campaignId: null },
    'activity.followup_overdue': { graceHours: 0 },
    'contact.inactive': { days: 30 },
    'deal.won': { minValue: null },
    'deal.lost': { minValue: null },
  },
  condition: {
    'lead.score': { op: 'gt', value: 70 },
    'lead.source': { sources: [] },
    segment: { statuses: [], lifecycles: [], sources: [], tags: [], cities: [] },
    'deal.value': { op: 'gte', value: 0, currency: null },
    industry: { industries: [] },
    tags: { mode: 'any', tags: [] },
    'campaign.engagement': { campaignId: null, engaged: true },
    date: { weekdays: [], fromTime: null, toTime: null, minAgeDays: null, maxAgeDays: null },
  },
  action: {
    assign_owner: { userIds: [], strategy: 'round_robin' },
    create_task: { type: 'FOLLOW_UP', subject: 'Follow up with {{lead.name}}', dueInHours: 24, priority: 'MEDIUM', assigneeId: null },
    add_tag: { tag: '' },
    remove_tag: { tag: '' },
    set_lead_status: { status: 'CONTACTED' },
    notify_team: { userIds: [], toOwner: true, message: '' },
    email_team: { userIds: [], toOwner: true, subject: '', body: '' },
    enroll_campaign: { campaignId: '' },
    generate_ai_message: { channel: 'whatsapp', goal: '', language: 'en' },
    email_lead: {},
    whatsapp_lead: {},
  },
  delay: { delay: { amount: 1, unit: 'days' } },
};

export const defaultConfig = (type: NodeType, kind: string): Record<string, unknown> => structuredClone(DEFAULTS[type][type === 'delay' ? 'delay' : kind] ?? {});

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const plural = (c: number, one: string, many = `${one}s`) => `${c} ${c === 1 ? one : many}`;

/** One line shown on the node so the workflow reads without opening each step. */
export function summarize(type: NodeType, kind: string, c: Record<string, unknown>): string {
  if (type === 'trigger') {
    if (kind === 'lead.created') return list(c.sources).length ? `From ${list(c.sources).join(', ')}` : 'From any source';
    if (kind === 'lead.status_changed') return [list(c.from).length ? `from ${list(c.from).join('/')}` : '', list(c.to).length ? `to ${list(c.to).join('/')}` : ''].filter(Boolean).join(' ') || 'Any change';
    if (kind === 'activity.followup_overdue') return n(c.graceHours) ? `${n(c.graceHours)} h after it is due` : 'When it is due';
    if (kind === 'contact.inactive') return `${n(c.days)} days without contact`;
    if (kind === 'deal.won' || kind === 'deal.lost') return c.minValue !== null && c.minValue !== undefined ? `Value ≥ ${n(c.minValue)}` : 'Any value';
    return TRIGGER_INFO[kind as TriggerKind]?.description ?? '';
  }
  if (type === 'condition') {
    if (kind === 'lead.score') return `Score ${NUM_OP_LABELS[c.op as keyof typeof NUM_OP_LABELS] ?? ''} ${n(c.value)}`;
    if (kind === 'lead.source') return list(c.sources).length ? `Source is ${list(c.sources).join(' or ')}` : 'Choose sources';
    if (kind === 'deal.value') return `Value ${NUM_OP_LABELS[c.op as keyof typeof NUM_OP_LABELS] ?? ''} ${n(c.value)}${c.currency ? ` ${String(c.currency)}` : ''}`;
    if (kind === 'industry') return list(c.industries).length ? `Industry: ${list(c.industries).join(', ')}` : 'Choose industries';
    if (kind === 'tags') return list(c.tags).length ? `${String(c.mode)} of ${list(c.tags).join(', ')}` : 'Choose tags';
    if (kind === 'campaign.engagement') return c.engaged === false ? 'Not in a campaign' : 'In a campaign';
    if (kind === 'date') return [list(c.weekdays).length ? plural(list(c.weekdays).length, 'weekday') : '', c.fromTime ? `${String(c.fromTime)}–${String(c.toTime ?? '24:00')}` : ''].filter(Boolean).join(' · ') || 'Any time';
    return CONDITION_INFO[kind as ConditionKind]?.label ?? kind;
  }
  if (type === 'delay') return `${n(c.amount)} ${String(c.unit)}`;
  switch (kind) {
    case 'assign_owner':
      return list(c.userIds).length ? `${c.strategy === 'round_robin' && list(c.userIds).length > 1 ? 'Rotate' : 'Assign'} ${plural(list(c.userIds).length, 'person', 'people')}` : 'Choose people';
    case 'create_task':
      return `${String(c.type ?? 'TASK').toLowerCase()}: ${String(c.subject ?? '')}`.slice(0, 60);
    case 'add_tag':
    case 'remove_tag':
      return c.tag ? `“${String(c.tag)}”` : 'Choose a tag';
    case 'set_lead_status':
      return `Set to ${String(c.status)}`;
    case 'notify_team':
    case 'email_team':
      return [c.toOwner ? 'Owner' : '', list(c.userIds).length ? plural(list(c.userIds).length, 'person', 'people') : ''].filter(Boolean).join(' + ') || 'Choose recipients';
    case 'generate_ai_message':
      return `${String(c.channel)} draft for the owner`;
    default:
      return ACTION_INFO[kind as ActionKind]?.description ?? '';
  }
}

export const stepLabel = (type: NodeType, kind: string) => nodeLabel(type, kind);

// ───────────── Layout ─────────────

export const NODE_W = 220;
export const ROW_H = 150;

/** Layered top-to-bottom layout: a step sits one row below its parent; siblings spread sideways. */
export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const trigger = graph.nodes.find((x) => x.type === 'trigger');
  if (!trigger) return graph;
  const depth = new Map<string, number>([[trigger.id, 0]]);
  const queue = [trigger.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges.filter((x) => x.source === id)) {
      if (!depth.has(e.target)) {
        depth.set(e.target, depth.get(id)! + 1);
        queue.push(e.target);
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  // Steps not connected to the trigger go in a row below, so they stay visible.
  for (const x of graph.nodes) if (!depth.has(x.id)) depth.set(x.id, maxDepth + 1);
  const rows = new Map<number, string[]>();
  for (const x of graph.nodes) rows.set(depth.get(x.id)!, [...(rows.get(depth.get(x.id)!) ?? []), x.id]);
  return {
    ...graph,
    nodes: graph.nodes.map((x) => {
      const row = rows.get(depth.get(x.id)!)!;
      const i = row.indexOf(x.id);
      return { ...x, position: { x: (i - (row.length - 1) / 2) * (NODE_W + 60), y: depth.get(x.id)! * ROW_H } };
    }),
  };
}

/** Where a new step goes: below the selected step (or the lowest one), nudged sideways if the spot is taken. */
export function nextPosition(nodes: StepNode[], selectedId: string | null, handle: EdgeHandle = 'next'): { x: number; y: number } {
  const parent = nodes.find((x) => x.id === selectedId) ?? [...nodes].sort((a, b) => b.position.y - a.position.y)[0];
  if (!parent) return { x: 0, y: 0 };
  let x = parent.position.x + (handle === 'yes' ? -(NODE_W / 2 + 30) : handle === 'no' ? NODE_W / 2 + 30 : 0);
  const y = parent.position.y + ROW_H;
  while (nodes.some((o) => Math.abs(o.position.x - x) < NODE_W && Math.abs(o.position.y - y) < 60)) x += NODE_W + 40;
  return { x, y };
}
