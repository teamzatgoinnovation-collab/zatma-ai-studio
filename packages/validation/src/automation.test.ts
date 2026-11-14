import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  parseNodeConfig,
  renderMerge,
  stableStringify,
  requiredPermissions,
  unknownMergeFields,
  updateWorkflowSchema,
  validateWorkflow,
  WORKFLOW_TEMPLATES,
  type RecordFacts,
  type WorkflowGraph,
} from './automation.js';

const node = (id: string, type: 'trigger' | 'condition' | 'action' | 'delay', kind: string, config: Record<string, unknown> = {}) => ({ id, type, kind, config, position: { x: 0, y: 0 } });
const edge = (source: string, target: string, sourceHandle: 'next' | 'yes' | 'no' = 'next') => ({ source, sourceHandle, target });
const codes = (g: WorkflowGraph, level?: 'error' | 'warning') => validateWorkflow(g).filter((i) => !level || i.level === level).map((i) => i.code);
const facts = (over: Partial<RecordFacts> = {}): RecordFacts => ({ entity: 'lead', score: 80, source: 'meta_ads', status: 'NEW', lifecycle: null, tags: ['Hot'], industry: 'Retail', city: 'Kochi', dealValue: null, dealCurrency: null, campaignId: null, enrolledCampaignIds: [], createdAt: new Date('2026-11-01T00:00:00Z'), ...over });
const evalC = (kind: Parameters<typeof evaluateCondition>[0], config: Record<string, unknown>, f = facts(), now = new Date('2026-11-12T10:00:00Z'), tz = 'Asia/Kolkata') => evaluateCondition(kind, config, f, now, tz);

describe('validateWorkflow', () => {
  const ok: WorkflowGraph = { nodes: [node('t', 'trigger', 'lead.created'), node('a', 'action', 'add_tag', { tag: 'new' })], edges: [edge('t', 'a')] };
  it('accepts a simple workflow and every shipped template (once its choices are filled)', () => {
    expect(codes(ok, 'error')).toEqual([]);
    for (const t of WORKFLOW_TEMPLATES) {
      const errors = validateWorkflow(t.graph).filter((i) => i.level === 'error');
      // The only errors allowed are the placeholders the user must choose.
      expect(errors.every((i) => i.code === 'INVALID_CONFIG'), t.id).toBe(true);
    }
  });
  it('needs exactly one trigger', () => {
    expect(codes({ nodes: [node('a', 'action', 'add_tag', { tag: 'x' })], edges: [] })).toContain('NO_TRIGGER');
    expect(codes({ nodes: [node('t', 'trigger', 'lead.created'), node('u', 'trigger', 'deal.won')], edges: [] })).toContain('MANY_TRIGGERS');
  });
  it('rejects cycles, self loops, dangling and duplicate edges', () => {
    const cyc: WorkflowGraph = { nodes: [node('t', 'trigger', 'lead.created'), node('a', 'action', 'add_tag', { tag: 'x' }), node('b', 'action', 'add_tag', { tag: 'y' })], edges: [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')] };
    expect(codes(cyc, 'error')).toContain('CYCLE');
    expect(codes({ ...ok, edges: [edge('t', 't')] }, 'error')).toContain('SELF_LOOP');
    expect(codes({ ...ok, edges: [edge('t', 'zzz')] }, 'error')).toContain('DANGLING_EDGE');
    expect(codes({ ...ok, nodes: [...ok.nodes, node('a', 'action', 'add_tag', { tag: 'x' })] }, 'error')).toContain('DUPLICATE_NODE');
    expect(codes({ ...ok, edges: [edge('a', 't')] }, 'error')).toContain('INTO_TRIGGER');
  });
  it('checks branching rules', () => {
    const g: WorkflowGraph = {
      nodes: [node('t', 'trigger', 'lead.created'), node('c', 'condition', 'lead.score', { op: 'gt', value: 70 }), node('a', 'action', 'add_tag', { tag: 'x' }), node('b', 'action', 'add_tag', { tag: 'y' })],
      edges: [edge('t', 'c'), edge('c', 'a', 'yes')],
    };
    expect(validateWorkflow(g).find((i) => i.code === 'ONE_BRANCH')?.message).toContain('No branch');
    expect(codes({ ...g, edges: [...g.edges, edge('c', 'b', 'yes')] }, 'error')).toContain('DUPLICATE_BRANCH');
    expect(codes({ ...g, edges: [edge('t', 'c'), edge('c', 'a', 'next')] }, 'error')).toContain('BAD_HANDLE');
    expect(codes({ ...ok, nodes: [...ok.nodes, node('b', 'action', 'add_tag', { tag: 'y' })], edges: [edge('t', 'a'), edge('t', 'b')] }, 'error')).toContain('MANY_NEXT');
  });
  it('validates configs and refuses customer messaging until Phase 14', () => {
    expect(codes({ ...ok, nodes: [ok.nodes[0]!, node('a', 'action', 'add_tag', {})] }, 'error')).toContain('INVALID_CONFIG');
    const g: WorkflowGraph = { nodes: [node('t', 'trigger', 'lead.created'), node('a', 'action', 'whatsapp_lead', {})], edges: [edge('t', 'a')] };
    expect(validateWorkflow(g).find((i) => i.code === 'ACTION_UNAVAILABLE')?.message).toBe('WhatsApp the lead is available in Phase 14');
  });
  it('warns about unreachable steps and conditions that cannot apply', () => {
    const g: WorkflowGraph = { nodes: [node('t', 'trigger', 'deal.won'), node('c', 'condition', 'lead.score', { op: 'gt', value: 1 }), node('x', 'action', 'add_tag', { tag: 'x' })], edges: [edge('t', 'c')] };
    expect(codes(g, 'warning')).toEqual(expect.arrayContaining(['UNREACHABLE', 'CONDITION_NA', 'DEAD_END']));
  });
  it('handles large graphs without recursion limits', () => {
    const nodes = [node('t', 'trigger', 'lead.created'), ...Array.from({ length: 49 }, (_, i) => node(`n${i}`, 'action', 'add_tag', { tag: 'x' }))];
    const edges = nodes.slice(0, -1).map((x, i) => edge(x.id, nodes[i + 1]!.id));
    expect(codes({ nodes, edges }, 'error')).toEqual([]);
  });
  it('unions the permissions a workflow needs', () => {
    const g: WorkflowGraph = { nodes: [node('t', 'trigger', 'lead.created'), node('a', 'action', 'enroll_campaign', { campaignId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }), node('b', 'action', 'generate_ai_message', { goal: 'hi' })], edges: [] };
    expect(requiredPermissions(g)).toEqual(['ai:generate', 'automation:write', 'campaign:write', 'crm:write']);
  });
});

describe('evaluateCondition', () => {
  it('compares scores and sources; missing facts never match', () => {
    expect(evalC('lead.score', { op: 'gt', value: 70 })).toBe(true);
    expect(evalC('lead.score', { op: 'gt', value: 80 })).toBe(false);
    expect(evalC('lead.score', { op: 'gte', value: 80 })).toBe(true);
    expect(evalC('lead.score', { op: 'lt', value: 100 }, facts({ score: null }))).toBe(false);
    expect(evalC('lead.source', { sources: ['meta_ads', 'facebook'] })).toBe(true);
    expect(evalC('lead.source', { sources: ['website'] })).toBe(false);
  });
  it('matches tags case-insensitively in any / all / none modes', () => {
    expect(evalC('tags', { mode: 'any', tags: ['hot', 'vip'] })).toBe(true);
    expect(evalC('tags', { mode: 'all', tags: ['hot', 'vip'] })).toBe(false);
    expect(evalC('tags', { mode: 'none', tags: ['vip'] })).toBe(true);
    expect(evalC('tags', { mode: 'none', tags: ['HOT'] })).toBe(false);
  });
  it('matches segments, industries and deal values', () => {
    expect(evalC('segment', { statuses: ['NEW'], cities: ['kochi'] })).toBe(true);
    expect(evalC('segment', { statuses: ['QUALIFIED'] })).toBe(false);
    expect(evalC('segment', { lifecycles: ['CUSTOMER'] }, facts({ lifecycle: 'CUSTOMER' }))).toBe(true);
    expect(evalC('industry', { industries: ['retail'] })).toBe(true);
    expect(evalC('deal.value', { op: 'gte', value: 50000, currency: 'INR' }, facts({ dealValue: 60000, dealCurrency: 'INR' }))).toBe(true);
    expect(evalC('deal.value', { op: 'gte', value: 50000, currency: 'INR' }, facts({ dealValue: 60000, dealCurrency: 'AED' }))).toBe(false);
    expect(evalC('deal.value', { op: 'gt', value: 1 })).toBe(false);
  });
  it('checks campaign engagement', () => {
    const cid = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(evalC('campaign.engagement', { campaignId: null, engaged: true })).toBe(false);
    expect(evalC('campaign.engagement', { campaignId: cid, engaged: true }, facts({ campaignId: cid }))).toBe(true);
    expect(evalC('campaign.engagement', { campaignId: cid, engaged: true }, facts({ enrolledCampaignIds: [cid] }))).toBe(true);
    expect(evalC('campaign.engagement', { campaignId: null, engaged: false })).toBe(true);
  });
  it('evaluates dates in the organization time zone, including windows past midnight', () => {
    // 2026-11-12 10:00 UTC = 15:30 IST (Thursday)
    expect(evalC('date', { weekdays: [4] })).toBe(true);
    expect(evalC('date', { weekdays: [0, 6] })).toBe(false);
    expect(evalC('date', { fromTime: '09:00', toTime: '18:00' })).toBe(true);
    expect(evalC('date', { fromTime: '16:00', toTime: '18:00' })).toBe(false);
    expect(evalC('date', { fromTime: '09:00', toTime: '18:00' }, facts(), new Date('2026-11-12T10:00:00Z'), 'Asia/Dubai')).toBe(true);
    expect(evalC('date', { fromTime: '22:00', toTime: '06:00' }, facts(), new Date('2026-11-12T18:00:00Z'))).toBe(true); // 23:30 IST
    expect(evalC('date', { fromTime: '22:00', toTime: '06:00' })).toBe(false);
    expect(evalC('date', { minAgeDays: 5, maxAgeDays: 30 })).toBe(true); // created 11 days ago
    expect(evalC('date', { minAgeDays: 20 })).toBe(false);
  });
  it('an invalid config is a "No", never an exception', () => {
    expect(evalC('lead.score', { op: 'nope' })).toBe(false);
  });
});

describe('merge fields', () => {
  it('fills known fields and drops unknown ones without executing anything', () => {
    expect(renderMerge('Hi {{lead.firstName}}, score {{ lead.score }}. {{secret.token}} {{constructor}}', { 'lead.firstName': 'Anu', 'lead.score': 82, 'secret.token': 'x' })).toBe('Hi Anu, score 82.  ');
    expect(renderMerge('{{lead.firstName}}', {})).toBe('');
    expect(renderMerge('{{lead.firstName}}', { 'lead.firstName': '<b>{{lead.lastName}}</b>', 'lead.lastName': 'no recursion' })).toBe('<b>{{lead.lastName}}</b>');
    expect(unknownMergeFields('{{lead.firstName}} {{foo.bar}} {{foo.bar}}')).toEqual(['foo.bar']);
  });
});

describe('schemas', () => {
  it('applies defaults when parsing node configs, but PATCH leaves omitted fields alone', () => {
    const r = parseNodeConfig('action', 'create_task', { subject: 'Call' });
    expect(r.ok && r.config).toMatchObject({ type: 'FOLLOW_UP', dueInHours: 24, priority: 'MEDIUM', assigneeId: null });
    expect(parseNodeConfig('delay', 'delay', { amount: 0, unit: 'days' }).ok).toBe(false);
    expect(updateWorkflowSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });
});

describe('stableStringify', () => {
  it('ignores key order (as stored by Postgres) but not values or array order', () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(stableStringify({ a: [1, 2] })).not.toBe(stableStringify({ a: [2, 1] }));
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(null)).toBe('null');
  });
});
