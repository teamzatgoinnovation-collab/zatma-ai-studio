import { z } from 'zod';
import { ACTIVITY_TYPES, LEAD_SOURCES, LEAD_STATUSES, LIFECYCLES, PRIORITIES } from './crm.js';
import { withoutDefaults } from './patch.js';
import { zonedParts } from './publishing.js';

// Phase 13: marketing automation. A workflow is a small acyclic graph: one trigger, then conditions (yes/no branches),
// actions and delays. Customer-facing email and WhatsApp are not available until Phase 14.

// ───────────── Catalogue ─────────────

export const TRIGGER_KINDS = ['lead.created', 'lead.status_changed', 'contact.became_customer', 'form.submitted', 'campaign.interaction', 'activity.followup_overdue', 'contact.inactive', 'deal.won', 'deal.lost'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export const CONDITION_KINDS = ['lead.score', 'lead.source', 'segment', 'deal.value', 'industry', 'tags', 'campaign.engagement', 'date'] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];
export const ACTION_KINDS = ['assign_owner', 'create_task', 'add_tag', 'remove_tag', 'set_lead_status', 'notify_team', 'email_team', 'enroll_campaign', 'generate_ai_message', 'email_lead', 'whatsapp_lead'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const NODE_TYPES = ['trigger', 'condition', 'action', 'delay'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Actions that message customers; they need Phase 14 (consent, templates, unsubscribe) and cannot run yet. */
export const UNAVAILABLE_ACTIONS: readonly ActionKind[] = ['email_lead', 'whatsapp_lead'];

export type EntityType = 'lead' | 'contact' | 'deal' | 'activity';
export const TRIGGER_INFO: Record<TriggerKind, { label: string; description: string; entity: EntityType }> = {
  'lead.created': { label: 'New lead created', description: 'A lead is added to the CRM from any source.', entity: 'lead' },
  'lead.status_changed': { label: 'Lead status changed', description: 'A lead moves to another status.', entity: 'lead' },
  'contact.became_customer': { label: 'New customer', description: 'A contact becomes a customer (first won deal).', entity: 'contact' },
  'form.submitted': { label: 'Form submission', description: 'A lead arrives through a lead form (Meta instant forms today).', entity: 'lead' },
  'campaign.interaction': { label: 'Campaign interaction', description: 'A lead is attributed to a campaign.', entity: 'lead' },
  'activity.followup_overdue': { label: 'Follow-up overdue', description: 'A follow-up task passes its due date without being completed.', entity: 'activity' },
  'contact.inactive': { label: 'Customer inactive', description: 'A customer has not been contacted for a number of days.', entity: 'contact' },
  'deal.won': { label: 'Deal won', description: 'A deal moves to a won stage.', entity: 'deal' },
  'deal.lost': { label: 'Deal lost', description: 'A deal moves to a lost stage.', entity: 'deal' },
};
export const CONDITION_INFO: Record<ConditionKind, { label: string; entities: EntityType[] | 'any' }> = {
  'lead.score': { label: 'Lead score', entities: ['lead'] },
  'lead.source': { label: 'Lead source', entities: ['lead'] },
  segment: { label: 'Customer segment', entities: ['lead', 'contact'] },
  'deal.value': { label: 'Deal value', entities: ['deal'] },
  industry: { label: 'Industry', entities: ['lead'] },
  tags: { label: 'Tags', entities: ['lead', 'contact', 'deal'] },
  'campaign.engagement': { label: 'Campaign engagement', entities: ['lead', 'deal'] },
  date: { label: 'Date and time', entities: 'any' },
};
export const ACTION_INFO: Record<ActionKind, { label: string; description: string; available: boolean; permissions: string[]; note?: string }> = {
  assign_owner: { label: 'Assign salesperson', description: 'Set the record owner (one person, or rotate through several).', available: true, permissions: ['crm:write'] },
  create_task: { label: 'Create follow-up task', description: 'Add a call, follow-up or task for the owner.', available: true, permissions: ['crm:write'] },
  add_tag: { label: 'Add tag', description: 'Add a tag to the record.', available: true, permissions: ['crm:write'] },
  remove_tag: { label: 'Remove tag', description: 'Remove a tag from the record.', available: true, permissions: ['crm:write'] },
  set_lead_status: { label: 'Update lead status', description: 'Move the lead to another status.', available: true, permissions: ['crm:write'] },
  notify_team: { label: 'Notify team', description: 'Email chosen team members or the record owner.', available: true, permissions: [] },
  email_team: { label: 'Email team (internal)', description: 'Send an internal email with details of the record.', available: true, permissions: [] },
  enroll_campaign: { label: 'Enrol in campaign', description: 'Add the lead or contact to a campaign (and attribute the lead if it has none).', available: true, permissions: ['campaign:write', 'crm:write'] },
  generate_ai_message: { label: 'Generate AI message', description: 'Draft a message for the owner to review and send. Nothing is sent.', available: true, permissions: ['ai:generate'] },
  email_lead: { label: 'Email the lead', description: 'Send an email to the lead.', available: false, permissions: [], note: 'Available in Phase 14' },
  whatsapp_lead: { label: 'WhatsApp the lead', description: 'Send a WhatsApp message to the lead.', available: false, permissions: [], note: 'Available in Phase 14' },
};

// ───────────── Node configs ─────────────

const id = z.string().min(1).max(64);
const uuid = z.uuid();
const NUM_OPS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const;
export type NumOp = (typeof NUM_OPS)[number];
const numOp = z.enum(NUM_OPS);
export const NUM_OP_LABELS: Record<NumOp, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };

const triggerConfig = {
  'lead.created': z.object({ sources: z.array(z.enum(LEAD_SOURCES)).max(20).default([]) }).strict(),
  'lead.status_changed': z.object({ from: z.array(z.enum(LEAD_STATUSES)).max(6).default([]), to: z.array(z.enum(LEAD_STATUSES)).max(6).default([]) }).strict(),
  'contact.became_customer': z.object({}).strict(),
  'form.submitted': z.object({ campaignId: uuid.nullable().default(null) }).strict(),
  'campaign.interaction': z.object({ campaignId: uuid.nullable().default(null) }).strict(),
  'activity.followup_overdue': z.object({ graceHours: z.number().int().min(0).max(720).default(0) }).strict(),
  'contact.inactive': z.object({ days: z.number().int().min(1).max(365).default(30) }).strict(),
  'deal.won': z.object({ minValue: z.number().min(0).max(1e12).nullable().default(null) }).strict(),
  'deal.lost': z.object({ minValue: z.number().min(0).max(1e12).nullable().default(null) }).strict(),
} satisfies Record<TriggerKind, z.ZodType>;

const conditionConfig = {
  'lead.score': z.object({ op: numOp, value: z.number().min(0).max(100) }).strict(),
  'lead.source': z.object({ sources: z.array(z.enum(LEAD_SOURCES)).min(1).max(20) }).strict(),
  segment: z
    .object({
      statuses: z.array(z.enum(LEAD_STATUSES)).max(6).default([]),
      lifecycles: z.array(z.enum(LIFECYCLES)).max(4).default([]),
      sources: z.array(z.enum(LEAD_SOURCES)).max(20).default([]),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
      cities: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    })
    .strict(),
  'deal.value': z.object({ op: numOp, value: z.number().min(0).max(1e12), currency: z.string().length(3).toUpperCase().nullable().default(null) }).strict(),
  industry: z.object({ industries: z.array(z.string().trim().min(1).max(80)).min(1).max(20) }).strict(),
  tags: z.object({ mode: z.enum(['any', 'all', 'none']), tags: z.array(z.string().trim().min(1).max(40)).min(1).max(20) }).strict(),
  'campaign.engagement': z.object({ campaignId: uuid.nullable().default(null), engaged: z.boolean().default(true) }).strict(),
  date: z
    .object({
      weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
      fromTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
      toTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
      minAgeDays: z.number().int().min(0).max(3650).nullable().default(null),
      maxAgeDays: z.number().int().min(0).max(3650).nullable().default(null),
    })
    .strict(),
} satisfies Record<ConditionKind, z.ZodType>;

const actionConfig = {
  assign_owner: z.object({ userIds: z.array(z.string().min(1).max(64)).min(1).max(20), strategy: z.enum(['specific', 'round_robin']).default('round_robin') }).strict(),
  create_task: z
    .object({
      type: z.enum(ACTIVITY_TYPES).default('FOLLOW_UP'),
      subject: z.string().trim().min(1).max(200),
      dueInHours: z.number().int().min(0).max(24 * 90).default(24),
      priority: z.enum(PRIORITIES).default('MEDIUM'),
      assigneeId: z.string().min(1).max(64).nullable().default(null),
    })
    .strict(),
  add_tag: z.object({ tag: z.string().trim().min(1).max(40) }).strict(),
  remove_tag: z.object({ tag: z.string().trim().min(1).max(40) }).strict(),
  set_lead_status: z.object({ status: z.enum(LEAD_STATUSES) }).strict(),
  notify_team: z.object({ userIds: z.array(z.string().min(1).max(64)).max(20).default([]), toOwner: z.boolean().default(true), message: z.string().trim().min(1).max(500) }).strict(),
  email_team: z.object({ userIds: z.array(z.string().min(1).max(64)).max(20).default([]), toOwner: z.boolean().default(true), subject: z.string().trim().min(1).max(150), body: z.string().trim().min(1).max(2000) }).strict(),
  enroll_campaign: z.object({ campaignId: uuid }).strict(),
  generate_ai_message: z.object({ channel: z.enum(['email', 'whatsapp', 'sms']).default('whatsapp'), goal: z.string().trim().min(1).max(300), language: z.string().min(2).max(5).default('en') }).strict(),
  email_lead: z.object({}).passthrough(),
  whatsapp_lead: z.object({}).passthrough(),
} satisfies Record<ActionKind, z.ZodType>;

const delayConfig = z.object({ amount: z.number().int().min(1).max(43_200), unit: z.enum(['minutes', 'hours', 'days']) }).strict();
export const MAX_DELAY_MS = 30 * 86_400_000;
export const delayMs = (c: { amount: number; unit: 'minutes' | 'hours' | 'days' }) => c.amount * { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[c.unit];

export type TriggerConfig<K extends TriggerKind = TriggerKind> = z.infer<(typeof triggerConfig)[K]>;
export type ConditionConfig<K extends ConditionKind = ConditionKind> = z.infer<(typeof conditionConfig)[K]>;
export type ActionConfig<K extends ActionKind = ActionKind> = z.infer<(typeof actionConfig)[K]>;
export type DelayConfig = z.infer<typeof delayConfig>;

/** Parses a node's config with its kind's schema (applying defaults). Returns the issues when invalid. */
export function parseNodeConfig(type: NodeType, kind: string, config: unknown): { ok: true; config: Record<string, unknown> } | { ok: false; message: string } {
  const schema = type === 'trigger' ? triggerConfig[kind as TriggerKind] : type === 'condition' ? conditionConfig[kind as ConditionKind] : type === 'action' ? actionConfig[kind as ActionKind] : kind === 'delay' ? delayConfig : undefined;
  if (!schema) return { ok: false, message: `Unknown ${type} "${kind}"` };
  const r = schema.safeParse(config ?? {});
  return r.success ? { ok: true, config: r.data as Record<string, unknown> } : { ok: false, message: r.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ') };
}

// ───────────── Graph ─────────────

export const MAX_NODES = 50;
export const EDGE_HANDLES = ['next', 'yes', 'no'] as const;
export type EdgeHandle = (typeof EDGE_HANDLES)[number];

export const workflowNodeSchema = z
  .object({
    id,
    type: z.enum(NODE_TYPES),
    kind: z.string().min(1).max(40),
    config: z.record(z.string(), z.unknown()).default({}),
    position: z.object({ x: z.number().min(-100_000).max(100_000), y: z.number().min(-100_000).max(100_000) }).default({ x: 0, y: 0 }),
  })
  .strict();
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export const workflowEdgeSchema = z.object({ id: id.optional(), source: id, sourceHandle: z.enum(EDGE_HANDLES).default('next'), target: id }).strict();
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export const workflowGraphSchema = z.object({ nodes: z.array(workflowNodeSchema).max(MAX_NODES), edges: z.array(workflowEdgeSchema).max(MAX_NODES * 2) }).strict();
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export interface WorkflowIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
}

/** Everything the editor and the API both check before a workflow may be saved as ready or activated. */
export function validateWorkflow(graph: WorkflowGraph): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const err = (code: string, message: string, nodeId?: string) => issues.push({ level: 'error', code, message, ...(nodeId ? { nodeId } : {}) });
  const warn = (code: string, message: string, nodeId?: string) => issues.push({ level: 'warning', code, message, ...(nodeId ? { nodeId } : {}) });
  const byId = new Map<string, WorkflowNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.id)) err('DUPLICATE_NODE', `Two steps share the id ${n.id}`, n.id);
    byId.set(n.id, n);
  }
  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) err('NO_TRIGGER', 'Add a trigger to start the workflow');
  if (triggers.length > 1) for (const t of triggers.slice(1)) err('MANY_TRIGGERS', 'A workflow has exactly one trigger', t.id);
  const trigger = triggers[0];
  const out = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      err('DANGLING_EDGE', 'A connection points to a step that does not exist');
      continue;
    }
    if (e.source === e.target) err('SELF_LOOP', 'A step cannot connect to itself', e.source);
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
  }
  for (const n of graph.nodes) {
    const parsed = parseNodeConfig(n.type, n.type === 'delay' ? 'delay' : n.kind, n.config);
    if (!parsed.ok) err('INVALID_CONFIG', parsed.message, n.id);
    if (n.type === 'action' && UNAVAILABLE_ACTIONS.includes(n.kind as ActionKind)) err('ACTION_UNAVAILABLE', `${ACTION_INFO[n.kind as ActionKind].label} is available in Phase 14`, n.id);
    const edges = out.get(n.id) ?? [];
    const handles = edges.map((e) => e.sourceHandle);
    if (n.type === 'condition') {
      if (new Set(handles).size !== handles.length) err('DUPLICATE_BRANCH', 'Each branch (Yes / No) can lead to one step', n.id);
      if (handles.some((h) => h === 'next')) err('BAD_HANDLE', 'A condition continues through Yes or No', n.id);
      if (!handles.includes('yes') && !handles.includes('no')) warn('DEAD_END', 'Neither branch leads anywhere; the workflow stops here', n.id);
      else if (!handles.includes('yes') || !handles.includes('no')) warn('ONE_BRANCH', `The ${handles.includes('yes') ? 'No' : 'Yes'} branch ends the workflow`, n.id);
    } else {
      if (edges.length > 1) err('MANY_NEXT', 'A step continues to one next step; use a condition to branch', n.id);
      if (handles.some((h) => h !== 'next')) err('BAD_HANDLE', 'Only conditions have Yes / No branches', n.id);
    }
  }
  for (const e of graph.edges) if (byId.get(e.target)?.type === 'trigger') err('INTO_TRIGGER', 'Nothing can lead into the trigger', e.target);
  // Reachability from the trigger and cycles (iterative DFS with colours).
  if (trigger) {
    const seen = new Set<string>();
    const colour = new Map<string, 1 | 2>();
    let cyclic = false;
    const stack: Array<{ id: string; i: number }> = [{ id: trigger.id, i: 0 }];
    colour.set(trigger.id, 1);
    seen.add(trigger.id);
    while (stack.length) {
      const top = stack.at(-1)!;
      const edges = out.get(top.id) ?? [];
      if (top.i >= edges.length) {
        colour.set(top.id, 2);
        stack.pop();
        continue;
      }
      const next = edges[top.i++]!.target;
      if (!byId.has(next)) continue;
      if (colour.get(next) === 1) {
        cyclic = true;
        continue;
      }
      if (!colour.has(next)) {
        colour.set(next, 1);
        seen.add(next);
        stack.push({ id: next, i: 0 });
      }
    }
    if (cyclic) err('CYCLE', 'The workflow loops back on itself; workflows must move forward');
    for (const n of graph.nodes) if (!seen.has(n.id) && n.type !== 'trigger') warn('UNREACHABLE', 'This step is not connected to the trigger and will never run', n.id);
    if (graph.nodes.length === 1) warn('EMPTY', 'Add at least one action after the trigger');
    if (!graph.nodes.some((n) => n.type === 'action')) warn('NO_ACTION', 'The workflow has no action, so it does nothing');
    // Condition applicability.
    const entity = trigger.kind in TRIGGER_INFO ? TRIGGER_INFO[trigger.kind as TriggerKind].entity : null;
    if (entity) {
      for (const n of graph.nodes) {
        if (n.type !== 'condition' || !(n.kind in CONDITION_INFO)) continue;
        const ok = CONDITION_INFO[n.kind as ConditionKind].entities;
        if (ok !== 'any' && !ok.includes(entity)) warn('CONDITION_NA', `${CONDITION_INFO[n.kind as ConditionKind].label} doesn't apply to a ${entity} trigger and will always be "No"`, n.id);
      }
    }
  }
  return issues;
}

export function nodeLabel(type: NodeType, kind: string): string {
  if (type === 'trigger') return TRIGGER_INFO[kind as TriggerKind]?.label ?? kind;
  if (type === 'condition') return CONDITION_INFO[kind as ConditionKind]?.label ?? kind;
  if (type === 'action') return ACTION_INFO[kind as ActionKind]?.label ?? kind;
  return 'Wait';
}

/**
 * JSON with object keys in sorted order. Postgres stores JSON with its own key order, so comparing a saved graph with a
 * freshly built one needs a canonical form (otherwise "nothing changed" is reported as a change after every save).
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Permissions a workflow needs to run (union over its actions), used when activating and again at run time. */
export function requiredPermissions(graph: WorkflowGraph): string[] {
  const perms = new Set<string>(['automation:write']);
  for (const n of graph.nodes) if (n.type === 'action' && n.kind in ACTION_INFO) for (const p of ACTION_INFO[n.kind as ActionKind].permissions) perms.add(p);
  return [...perms].sort();
}

// ───────────── Condition evaluation ─────────────

/** The facts about the triggering record that conditions look at (assembled by the engine from the CRM). */
export interface RecordFacts {
  entity: EntityType;
  score: number | null;
  source: string | null;
  status: string | null;
  lifecycle: string | null;
  tags: string[];
  industry: string | null;
  city: string | null;
  dealValue: number | null;
  dealCurrency: string | null;
  campaignId: string | null;
  enrolledCampaignIds: string[];
  createdAt: Date | null;
}

const compare = (op: NumOp, a: number, b: number) => (op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : op === 'lte' ? a <= b : a === b);
const lower = (xs: readonly string[]) => xs.map((x) => x.toLowerCase());
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Whether a condition node's config holds for the facts. Missing facts never satisfy a positive test. */
export function evaluateCondition(kind: ConditionKind, config: Record<string, unknown>, facts: RecordFacts, now: Date, timeZone: string): boolean {
  const parsed = parseNodeConfig('condition', kind, config);
  if (!parsed.ok) return false;
  const c = parsed.config;
  switch (kind) {
    case 'lead.score':
      {
      const k = c as unknown as ConditionConfig<'lead.score'>;
      return facts.score !== null && compare(k.op, facts.score, k.value);
    }
    case 'lead.source':
      return facts.source !== null && (c as unknown as ConditionConfig<'lead.source'>).sources.includes(facts.source as never);
    case 'segment': {
      const s = c as unknown as ConditionConfig<'segment'>;
      if (s.statuses.length && (!facts.status || !s.statuses.includes(facts.status as never))) return false;
      if (s.lifecycles.length && (!facts.lifecycle || !s.lifecycles.includes(facts.lifecycle as never))) return false;
      if (s.sources.length && (!facts.source || !s.sources.includes(facts.source as never))) return false;
      if (s.tags.length && !lower(s.tags).some((t) => lower(facts.tags).includes(t))) return false;
      if (s.cities.length && (!facts.city || !lower(s.cities).includes(facts.city.toLowerCase()))) return false;
      return true;
    }
    case 'deal.value': {
      const d = c as unknown as ConditionConfig<'deal.value'>;
      if (facts.dealValue === null) return false;
      if (d.currency && facts.dealCurrency !== d.currency) return false;
      return compare(d.op, facts.dealValue, d.value);
    }
    case 'industry':
      return facts.industry !== null && lower((c as unknown as ConditionConfig<'industry'>).industries).includes(facts.industry.toLowerCase());
    case 'tags': {
      const t = c as unknown as ConditionConfig<'tags'>;
      const have = lower(facts.tags);
      const want = lower(t.tags);
      return t.mode === 'any' ? want.some((x) => have.includes(x)) : t.mode === 'all' ? want.every((x) => have.includes(x)) : !want.some((x) => have.includes(x));
    }
    case 'campaign.engagement': {
      const e = c as unknown as ConditionConfig<'campaign.engagement'>;
      const engaged = e.campaignId ? facts.campaignId === e.campaignId || facts.enrolledCampaignIds.includes(e.campaignId) : facts.campaignId !== null || facts.enrolledCampaignIds.length > 0;
      return e.engaged ? engaged : !engaged;
    }
    case 'date': {
      const d = c as unknown as ConditionConfig<'date'>;
      const p = zonedParts(now, timeZone);
      if (d.weekdays.length && !d.weekdays.includes(p.weekday)) return false;
      if (d.fromTime || d.toTime) {
        const m = p.hour * 60 + p.minute;
        const from = d.fromTime ? toMinutes(d.fromTime) : 0;
        const to = d.toTime ? toMinutes(d.toTime) : 24 * 60;
        // A window like 22:00–06:00 wraps past midnight.
        const inside = from <= to ? m >= from && m < to : m >= from || m < to;
        if (!inside) return false;
      }
      if (d.minAgeDays !== null || d.maxAgeDays !== null) {
        if (!facts.createdAt) return false;
        const age = (now.getTime() - facts.createdAt.getTime()) / 86_400_000;
        if (d.minAgeDays !== null && age < d.minAgeDays) return false;
        if (d.maxAgeDays !== null && age > d.maxAgeDays) return false;
      }
      return true;
    }
  }
}

// ───────────── Merge fields ─────────────

/** Fields available in messages: `{{lead.firstName}}`, `{{deal.value}}`, … Unknown fields render empty; nothing executes. */
export const MERGE_FIELDS = ['lead.firstName', 'lead.lastName', 'lead.name', 'lead.email', 'lead.phone', 'lead.company', 'lead.score', 'lead.status', 'lead.source', 'contact.name', 'deal.name', 'deal.value', 'deal.currency', 'campaign.name', 'org.name'] as const;
const MERGE_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]{0,40})\s*\}\}/g;

export function renderMerge(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(MERGE_RE, (_m, key: string) => {
    const v = (MERGE_FIELDS as readonly string[]).includes(key) ? values[key] : undefined;
    return v === null || v === undefined ? '' : String(v);
  });
}

/** Merge field names used in a template that are not in the catalogue (to warn in the editor). */
export function unknownMergeFields(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(MERGE_RE)) if (!(MERGE_FIELDS as readonly string[]).includes(m[1]!)) out.add(m[1]!);
  return [...out];
}

// ───────────── Workflow API schemas ─────────────

export const WORKFLOW_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export const RUN_STATUSES = ['RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const STEP_STATUSES = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'WAITING'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const workflowSettingsSchema = z.object({ maxRunsPerHour: z.number().int().min(1).max(10_000).default(200), reentryCooldownMinutes: z.number().int().min(0).max(10_080).default(60) }).strict();
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;
export const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = { maxRunsPerHour: 200, reentryCooldownMinutes: 60 };

const workflowFields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(''),
  graph: workflowGraphSchema,
  settings: workflowSettingsSchema.optional(),
};
export const createWorkflowSchema = z.object(workflowFields).strict();
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type CreateWorkflowRequest = z.input<typeof createWorkflowSchema>;
export const updateWorkflowSchema = withoutDefaults(z.object(workflowFields).partial()).strict();
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type UpdateWorkflowRequest = Partial<CreateWorkflowRequest>;

export const listWorkflowsSchema = z.object({
  status: z.enum(WORKFLOW_STATUSES).optional(),
  trigger: z.enum(TRIGGER_KINDS).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsSchema>;
export const listRunsSchema = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  entityId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListRunsQuery = z.infer<typeof listRunsSchema>;
export const testRunSchema = z.object({ entityType: z.enum(['lead', 'contact', 'deal', 'activity']), entityId: z.uuid() }).strict();
export type TestRunInput = z.infer<typeof testRunSchema>;

// ───────────── Templates ─────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  /** Things the user must choose (members, campaigns) before the template can be activated. */
  needs: Array<'members' | 'campaign'>;
}

const n = (nid: string, type: NodeType, kind: string, config: Record<string, unknown>, x: number, y: number): WorkflowNode => ({ id: nid, type, kind, config, position: { x, y } });
const e = (source: string, target: string, sourceHandle: EdgeHandle = 'next'): WorkflowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'hot-meta-lead',
    name: 'Hot Meta lead: assign and call, else nurture',
    description: 'A new Meta lead with a score above 70 goes to a salesperson with a call task; others join a nurture campaign.',
    needs: ['members', 'campaign'],
    graph: {
      nodes: [
        n('t', 'trigger', 'lead.created', { sources: ['meta_ads', 'facebook', 'instagram'] }, 0, 0),
        n('c', 'condition', 'lead.score', { op: 'gt', value: 70 }, 0, 140),
        n('a1', 'action', 'assign_owner', { userIds: [], strategy: 'round_robin' }, -200, 300),
        n('a2', 'action', 'create_task', { type: 'CALL', subject: 'Call {{lead.name}} (score {{lead.score}})', dueInHours: 2, priority: 'HIGH', assigneeId: null }, -200, 450),
        n('a3', 'action', 'enroll_campaign', { campaignId: '' }, 200, 300),
      ],
      edges: [e('t', 'c'), e('c', 'a1', 'yes'), e('a1', 'a2'), e('c', 'a3', 'no')],
    },
  },
  {
    id: 'followup-overdue',
    name: 'Follow-up overdue: notify the owner',
    description: 'When a follow-up passes its due date, the owner is notified and the task is escalated.',
    needs: [],
    graph: {
      nodes: [n('t', 'trigger', 'activity.followup_overdue', { graceHours: 2 }, 0, 0), n('a1', 'action', 'notify_team', { userIds: [], toOwner: true, message: 'A follow-up is overdue: {{lead.name}}' }, 0, 140)],
      edges: [e('t', 'a1')],
    },
  },
  {
    id: 'deal-won-customer',
    name: 'Deal won: tag the customer and thank them',
    description: 'Tags big wins and creates a thank-you task for the owner.',
    needs: [],
    graph: {
      nodes: [
        n('t', 'trigger', 'deal.won', { minValue: null }, 0, 0),
        n('c', 'condition', 'deal.value', { op: 'gte', value: 50000, currency: null }, 0, 140),
        n('a1', 'action', 'add_tag', { tag: 'key-account' }, -200, 300),
        n('a2', 'action', 'create_task', { type: 'CALL', subject: 'Thank {{contact.name}} for {{deal.name}}', dueInHours: 24, priority: 'MEDIUM', assigneeId: null }, 200, 300),
      ],
      edges: [e('t', 'c'), e('c', 'a1', 'yes'), e('a1', 'a2'), e('c', 'a2', 'no')],
    },
  },
  {
    id: 'inactive-customer',
    name: 'Inactive customer: draft a message and a task',
    description: 'After 45 days without contact, AI drafts a check-in for the owner and a task is created.',
    needs: [],
    graph: {
      nodes: [
        n('t', 'trigger', 'contact.inactive', { days: 45 }, 0, 0),
        n('a1', 'action', 'generate_ai_message', { channel: 'whatsapp', goal: 'Friendly check-in to see how things are going and offer help', language: 'en' }, 0, 140),
        n('a2', 'action', 'create_task', { type: 'FOLLOW_UP', subject: 'Check in with {{contact.name}}', dueInHours: 24, priority: 'LOW', assigneeId: null }, 0, 290),
      ],
      edges: [e('t', 'a1'), e('a1', 'a2')],
    },
  },
];

// ───────────── DTOs ─────────────

export interface WorkflowDto {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  triggerKind: TriggerKind | null;
  graph: WorkflowGraph;
  version: number;
  settings: WorkflowSettings;
  owner: { id: string; name: string } | null;
  activatedAt: string | null;
  pausedReason: string | null;
  stats: { runsThisMonth: number; failuresThisMonth: number; lastRunAt: string | null; lastStatus: RunStatus | null };
  issues: WorkflowIssue[];
  requiredPermissions: string[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunStepDto {
  id: string;
  nodeId: string;
  kind: string;
  type: NodeType;
  label: string;
  status: StepStatus;
  attempts: number;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RunDto {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  status: RunStatus;
  skipReason: string | null;
  trigger: { kind: TriggerKind; entityType: EntityType; entityId: string; entityLabel: string | null };
  depth: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps?: RunStepDto[];
}

export interface TestRunResult {
  /** Node ids in the order they would run, with the branch taken at each condition. */
  path: Array<{ nodeId: string; label: string; outcome: 'run' | 'yes' | 'no' | 'stop' | 'would_wait'; detail?: string }>;
  wouldWrite: string[];
}

export interface AutomationStatsDto {
  runsThisMonth: number;
  runLimit: number;
  succeeded: number;
  failed: number;
  skipped: number;
  daily: Array<{ date: string; runs: number; failed: number }>;
}
