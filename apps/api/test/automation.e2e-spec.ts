import { getQueueToken } from '@nestjs/bullmq';
import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIProviderRegistry } from '../src/ai/ai-provider.registry.js';
import type { AITextProvider } from '../src/ai/ai-provider.interfaces.js';
import { AutomationActions } from '../src/automation/automation-actions.js';
import { AUTOMATION_RUNS_QUEUE } from '../src/automation/automation-events.service.js';
import { AutomationScanner } from '../src/automation/automation.worker.js';
import { AppException } from '../src/common/errors.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, waitForEmail, type TestUser } from './helpers.js';

type Node = { id: string; type: string; kind: string; config: Record<string, unknown>; position: { x: number; y: number } };
const N = (id: string, type: string, kind: string, config: Record<string, unknown> = {}): Node => ({ id, type, kind, config, position: { x: 0, y: 0 } });
const E = (source: string, target: string, sourceHandle: 'next' | 'yes' | 'no' = 'next') => ({ source, sourceHandle, target });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

function textProvider(reply: string): AITextProvider {
  return { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-opus-5-5', generateText: async () => ({ text: reply, model: 'claude-opus-5-5', usage: { inputTokens: 300, outputTokens: 120, costMicroUsd: 4_000 }, finishReason: 'stop' as const }) } as AITextProvider;
}

describe('Marketing automation (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: TestUser;
  let admin: TestUser;
  let manager: TestUser;
  let agent: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let ws: string;
  let campaignId: string;
  let leadSeq = 0;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    app.get(AIProviderRegistry).register('TEXT', textProvider(JSON.stringify({ subject: 'Thank you', text: 'Thanks for choosing us! Let us know if you need anything.' })));
    owner = await signUp(app, 'Auto Owner');
    orgId = await createOrg(app, owner, 'Automation Org');
    ws = (await api(app, owner).get('/workspaces').expect(200)).body.data[0].id;
    admin = await signUp(app, 'Ada Admin');
    await inviteAndAccept(app, owner, admin, orgId, 'admin');
    manager = await signUp(app, 'Mia Manager');
    await inviteAndAccept(app, owner, manager, orgId, 'marketing_manager');
    agent = await signUp(app, 'Sam Sales');
    await inviteAndAccept(app, owner, agent, orgId, 'sales_agent');
    viewer = await signUp(app, 'Vic Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    campaignId = (await api(app, owner).post('/campaigns', { workspaceId: ws, name: 'Nurture drip', type: 'LEAD_GENERATION' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });
  // Each test builds its own workflows; stop the previous ones so they never react to this test's records.
  beforeEach(async () => {
    await prisma.system.automationWorkflow.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    await sleep(150);
  });

  // ── helpers ──
  const make = async (user: TestUser, name: string, nodes: Node[], edges: ReturnType<typeof E>[], settings: Record<string, unknown> = {}) =>
    (await api(app, user).post('/automations', { name, graph: { nodes, edges }, settings: { reentryCooldownMinutes: 0, ...settings } }).expect(201)).body as { id: string };
  const live = async (user: TestUser, name: string, nodes: Node[], edges: ReturnType<typeof E>[], settings: Record<string, unknown> = {}) => {
    const w = await make(user, name, nodes, edges, settings);
    await api(app, user).post(`/automations/${w.id}/activate`).expect(200);
    return w;
  };
  const runsOf = async (id: string, q = '') => (await api(app, owner).get(`/automations/${id}/runs?pageSize=50${q}`).expect(200)).body.data as Array<{ id: string; status: string; skipReason: string | null; depth: number; trigger: { entityId: string; entityLabel: string | null } }>;
  const waitRuns = async (id: string, count: number, statuses: string[] = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'], ms = 12_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const r = (await runsOf(id)).filter((x) => statuses.includes(x.status));
      if (r.length >= count) return r;
      if (Date.now() > end) throw new Error(`Expected ${count} run(s) of ${id} in ${statuses}; have ${JSON.stringify((await runsOf(id)).map((x) => x.status))}`);
      await sleep(120);
    }
  };
  const newLead = async (user: TestUser, over: Record<string, unknown> = {}) => {
    const i = ++leadSeq;
    return (await api(app, user).post('/crm/leads', { firstName: `Lead${i}`, lastName: 'Test', phone: `9847${String(100000 + i)}`, source: 'meta_ads', ...over }).expect(201)).body as { id: string; score: number | null; owner: { id: string } | null; tags: string[]; status: string; campaign: { id: string } | null };
  };
  const tasksOf = async (query: string) => (await api(app, owner).get(`/crm/activities?pageSize=50&${query}`).expect(200)).body.data as Array<{ subject: string; type: string; owner: { id: string } | null; body: string | null; completedAt: string | null }>;
  const stepsOf = async (runId: string) => (await api(app, owner).get(`/automations/runs/${runId}`).expect(200)).body.steps as Array<{ nodeId: string; status: string; attempts: number; output: Record<string, unknown> | null; error: string | null }>;

  it('lists templates, creates workflows, and shows issues for an unfinished one', async () => {
    expect((await api(app, viewer).get('/automations/templates').expect(200)).body.map((t: { id: string }) => t.id)).toEqual(['hot-meta-lead', 'followup-overdue', 'deal-won-customer', 'inactive-customer']);
    await api(app, viewer).post('/automations', { name: 'Nope', graph: { nodes: [N('t', 'trigger', 'lead.created')], edges: [] } }).expect(403);
    await api(app, manager).post('/automations', { name: 'Bad', graph: { nodes: [{ id: 't' }], edges: [] } }).expect(400);
    const tpl = (await api(app, owner).get('/automations/templates').expect(200)).body[0];
    const w = (await api(app, manager).post('/automations', { name: 'Hot Meta lead', graph: tpl.graph }).expect(201)).body;
    expect(w).toMatchObject({ status: 'DRAFT', triggerKind: 'lead.created', version: 1, settings: { maxRunsPerHour: 200, reentryCooldownMinutes: 60 } });
    // The template still needs people and a campaign chosen.
    expect(w.issues.filter((i: { level: string }) => i.level === 'error').length).toBeGreaterThan(0);
    expect(w.requiredPermissions).toEqual(['automation:write', 'campaign:write', 'crm:write']);
    expect((await api(app, viewer).get(`/automations/${w.id}`).expect(200)).body.name).toBe('Hot Meta lead');
    const patched = (await api(app, manager).patch(`/automations/${w.id}`, { name: 'Hot Meta leads' }).expect(200)).body;
    expect(patched).toMatchObject({ name: 'Hot Meta leads', version: 1 });
    expect((await api(app, manager).patch(`/automations/${w.id}`, { graph: { nodes: [N('t', 'trigger', 'lead.created')], edges: [] } }).expect(200)).body.version).toBe(2);
    expect((await api(app, viewer).get('/automations?q=hot').expect(200)).body.data.map((x: { id: string }) => x.id)).toEqual([w.id]);
    await api(app, manager).delete(`/automations/${w.id}`).expect(204);
    await api(app, manager).get(`/automations/${w.id}`).expect(404);
  });

  it('refuses to activate without permissions, a valid graph, or while it needs Phase 14', async () => {
    const tag = await make(manager, 'Tagging', [N('t', 'trigger', 'lead.created'), N('a', 'action', 'add_tag', { tag: 'x' })], [E('t', 'a')]);
    const denied = await api(app, manager).post(`/automations/${tag.id}/activate`).expect(403);
    expect(denied.body).toMatchObject({ code: 'AUTOMATION_PERMISSION_MISSING', details: { missing: ['crm:write'] } });
    await api(app, viewer).post(`/automations/${tag.id}/activate`).expect(403);
    const wa = await make(owner, 'WhatsApp lead', [N('t', 'trigger', 'lead.created'), N('a', 'action', 'whatsapp_lead', {})], [E('t', 'a')]);
    const r = await api(app, owner).post(`/automations/${wa.id}/activate`).expect(422);
    expect(r.body.message).toContain('Phase 14');
    const none = await make(owner, 'Only a trigger', [N('t', 'trigger', 'lead.created')], []);
    expect((await api(app, owner).post(`/automations/${none.id}/activate`).expect(422)).body.message).toContain('at least one action');
    const stranger = await make(owner, 'Gone', [N('t', 'trigger', 'lead.created'), N('a', 'action', 'assign_owner', { userIds: ['not-a-member'] })], [E('t', 'a')]);
    expect((await api(app, owner).post(`/automations/${stranger.id}/activate`).expect(422)).body.message).toContain('not on the team');
    const cyc = await make(owner, 'Cycle', [N('t', 'trigger', 'lead.created'), N('a', 'action', 'add_tag', { tag: 'x' }), N('b', 'action', 'add_tag', { tag: 'y' })], [E('t', 'a'), E('a', 'b'), E('b', 'a')]);
    expect((await api(app, owner).post(`/automations/${cyc.id}/activate`).expect(422)).body.message).toContain('loops');
  });

  it('runs the hot-lead example end to end: assign + call task, or enrol in nurture', async () => {
    const people = [owner.userId, agent.userId];
    const w = await live(
      owner,
      'Meta lead router',
      [
        N('t', 'trigger', 'lead.created', { sources: ['meta_ads', 'website'] }),
        N('c', 'condition', 'lead.source', { sources: ['meta_ads'] }),
        N('a1', 'action', 'assign_owner', { userIds: people, strategy: 'round_robin' }),
        N('a2', 'action', 'create_task', { type: 'CALL', subject: 'Call {{lead.name}} from {{lead.source}}', dueInHours: 2, priority: 'HIGH' }),
        N('a3', 'action', 'enroll_campaign', { campaignId }),
      ],
      [E('t', 'c'), E('c', 'a1', 'yes'), E('a1', 'a2'), E('c', 'a3', 'no')],
    );
    const l1 = await newLead(owner);
    const l2 = await newLead(owner);
    const web = await newLead(owner, { source: 'website' });
    const runs = await waitRuns(w.id, 3);
    expect(runs.every((r) => r.status === 'SUCCEEDED')).toBe(true);
    // Hot branch: owners rotate and each gets a call task with the merge fields filled in.
    const o1 = (await api(app, owner).get(`/crm/leads/${l1.id}`).expect(200)).body.owner.id;
    const o2 = (await api(app, owner).get(`/crm/leads/${l2.id}`).expect(200)).body.owner.id;
    expect([o1, o2].sort()).toEqual([...people].sort());
    const t1 = await tasksOf(`leadId=${l1.id}`);
    const call = t1.find((t) => t.type === 'CALL')!;
    expect(call).toMatchObject({ owner: { id: o1 }, completedAt: null });
    expect(call.subject).toMatch(/^Call Lead\d+ Test from meta_ads$/);
    // Other branch: enrolled in the campaign and attributed to it.
    const enrolled = await prisma.system.campaignEnrollment.findMany({ where: { leadId: web.id } });
    expect(enrolled).toMatchObject([{ campaignId, source: 'automation', workflowId: w.id }]);
    expect((await api(app, owner).get(`/crm/leads/${web.id}`).expect(200)).body.campaign).toMatchObject({ id: campaignId });
    expect(await tasksOf(`leadId=${web.id}`)).toEqual([]);
    // Every step is logged with what it did; nothing sensitive is in the log.
    const hot = runs.find((r) => r.trigger.entityId === l1.id)!;
    const steps = await stepsOf(hot.id);
    expect(steps.map((s) => [s.nodeId, s.status])).toEqual([['t', 'SUCCEEDED'], ['c', 'SUCCEEDED'], ['a1', 'SUCCEEDED'], ['a2', 'SUCCEEDED']]);
    expect(steps.find((s) => s.nodeId === 'c')!.output).toEqual({ branch: 'yes' });
    expect(JSON.stringify(steps)).not.toMatch(/9847\d+|@example/);
    expect(runs.find((r) => r.trigger.entityId === l1.id)!.trigger.entityLabel).toMatch(/^Lead\d+ Test$/);
    // Stats and plan usage count the three runs.
    const stats = (await api(app, viewer).get('/automations/stats').expect(200)).body;
    expect(stats.runsThisMonth).toBeGreaterThanOrEqual(3);
    expect((await api(app, owner).get('/billing/usage').expect(200)).body.metrics.find((m: { metric: string }) => m.metric === 'automationRuns').used).toBeGreaterThanOrEqual(3);
  });

  it('dry-runs a workflow against a real record without changing anything', async () => {
    const low = await newLead(owner, { source: 'website', firstName: 'Cold' });
    const high = await newLead(owner, { source: 'meta_ads', firstName: 'Warm', email: 'warm@example.in', company: 'Warm Co', jobTitle: 'Owner', city: 'Kochi' });
    const lo = (await api(app, owner).get(`/crm/leads/${low.id}`).expect(200)).body.score as number;
    const hi = (await api(app, owner).get(`/crm/leads/${high.id}`).expect(200)).body.score as number;
    expect(hi).toBeGreaterThan(lo);
    const threshold = Math.floor((hi + lo) / 2);
    const w = await make(owner, 'Score router', [N('t', 'trigger', 'lead.created'), N('c', 'condition', 'lead.score', { op: 'gt', value: threshold }), N('a', 'action', 'create_task', { subject: 'Call {{lead.firstName}}', type: 'CALL', dueInHours: 1 }), N('n', 'action', 'add_tag', { tag: 'nurture' })], [E('t', 'c'), E('c', 'a', 'yes'), E('c', 'n', 'no')]);
    const before = await prisma.system.automationRun.count({ where: { organizationId: orgId } });
    const yes = (await api(app, owner).post(`/automations/${w.id}/test`, { entityType: 'lead', entityId: high.id }).expect(200)).body;
    expect(yes.path.map((p: { outcome: string }) => p.outcome)).toEqual(['run', 'yes', 'run']);
    expect(yes.wouldWrite).toEqual(['Create follow-up task: “Call Warm” due in 1 h']);
    const no = (await api(app, owner).post(`/automations/${w.id}/test`, { entityType: 'lead', entityId: low.id }).expect(200)).body;
    expect(no.path.map((p: { outcome: string }) => p.outcome)).toEqual(['run', 'no', 'run']);
    expect(no.wouldWrite).toEqual(['Add tag: “nurture”']);
    expect((await api(app, owner).post(`/automations/${w.id}/test`, { entityType: 'deal', entityId: high.id }).expect(422)).body.code).toBe('WRONG_RECORD_TYPE');
    await api(app, viewer).post(`/automations/${w.id}/test`, { entityType: 'lead', entityId: high.id }).expect(403);
    expect(await prisma.system.automationRun.count({ where: { organizationId: orgId } })).toBe(before);
    expect((await api(app, owner).get(`/crm/leads/${low.id}`).expect(200)).body.tags).toEqual([]);
    expect(await tasksOf(`leadId=${high.id}`)).toEqual([]);
  });

  it('starts from status changes, deal wins and new customers, and drafts an AI message without sending it', async () => {
    const status = await live(owner, 'Qualified lead', [N('t', 'trigger', 'lead.status_changed', { to: ['QUALIFIED'] }), N('a', 'action', 'add_tag', { tag: 'qualified-auto' })], [E('t', 'a')]);
    const lead = await newLead(owner);
    await api(app, owner).patch(`/crm/leads/${lead.id}`, { status: 'CONTACTED' }).expect(200);
    await api(app, owner).patch(`/crm/leads/${lead.id}`, { status: 'QUALIFIED' }).expect(200);
    await waitRuns(status.id, 1);
    expect((await api(app, owner).get(`/crm/leads/${lead.id}`).expect(200)).body.tags).toContain('qualified-auto');
    expect(await runsOf(status.id)).toHaveLength(1); // the CONTACTED change did not match

    const won = await live(owner, 'Big win', [N('t', 'trigger', 'deal.won', { minValue: 1000 }), N('c', 'condition', 'deal.value', { op: 'gte', value: 5000 }), N('a', 'action', 'create_task', { subject: 'Thank {{contact.name}} for {{deal.name}} ({{deal.value}})', type: 'CALL', dueInHours: 24 })], [E('t', 'c'), E('c', 'a', 'yes')]);
    const customer = await live(owner, 'New customer', [N('t', 'trigger', 'contact.became_customer'), N('a', 'action', 'add_tag', { tag: 'customer-auto' }), N('m', 'action', 'generate_ai_message', { channel: 'whatsapp', goal: 'Thank them for their order', language: 'en' })], [E('t', 'a'), E('a', 'm')]);
    const contact = (await api(app, owner).post('/crm/contacts', { firstName: 'Deepa', lastName: 'Nair', phone: '9847700001' }).expect(201)).body;
    const board = (await api(app, owner).get('/crm/pipelines').expect(200)).body[0];
    const wonStage = board.stages.find((s: { kind: string }) => s.kind === 'WON').id;
    const small = (await api(app, owner).post('/crm/deals', { name: 'Small order', value: 900, contactId: contact.id }).expect(201)).body;
    await api(app, owner).post(`/crm/deals/${small.id}/move`, { stageId: wonStage }).expect(200);
    const deal = (await api(app, owner).post('/crm/deals', { name: 'Showroom fit-out', value: 8000, contactId: contact.id }).expect(201)).body;
    await api(app, owner).post(`/crm/deals/${deal.id}/move`, { stageId: wonStage }).expect(200);
    await waitRuns(won.id, 1); // the 900 deal is below the trigger's minimum
    await sleep(500);
    expect(await runsOf(won.id)).toHaveLength(1);
    expect((await tasksOf(`dealId=${deal.id}`))[0]).toMatchObject({ subject: 'Thank Deepa Nair for Showroom fit-out (8000)', type: 'CALL' });
    // First win made the contact a customer: tag + a drafted message saved as a note (nothing was sent).
    const [cRun] = await waitRuns(customer.id, 1);
    expect((await stepsOf(cRun!.id)).map((s) => s.status)).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
    expect((await api(app, owner).get(`/crm/contacts/${contact.id}`).expect(200)).body.tags).toContain('customer-auto');
    const note = (await tasksOf(`contactId=${contact.id}`)).find((a) => a.subject.startsWith('AI draft'))!;
    expect(note).toMatchObject({ type: 'NOTE', body: 'Thanks for choosing us! Let us know if you need anything.' });
  });

  it('finds overdue follow-ups and inactive customers, emails the team, and triggers once per occurrence', async () => {
    const overdue = await live(owner, 'Overdue follow-up', [N('t', 'trigger', 'activity.followup_overdue', { graceHours: 1 }), N('n', 'action', 'notify_team', { toOwner: true, userIds: [], message: 'Follow-up overdue for {{lead.name}}' })], [E('t', 'n')]);
    const inactive = await live(owner, 'Gone quiet', [N('t', 'trigger', 'contact.inactive', { days: 45 }), N('a', 'action', 'add_tag', { tag: 'win-back' })], [E('t', 'a')]);
    const lead = await newLead(owner, { firstName: 'Late' });
    await api(app, owner).post('/crm/activities', { type: 'FOLLOW_UP', subject: 'Call back', leadId: lead.id, dueAt: new Date(Date.now() - 3 * DAY).toISOString(), ownerId: owner.userId }).expect(201);
    await api(app, owner).post('/crm/activities', { type: 'FOLLOW_UP', subject: 'Not due yet', leadId: lead.id, dueAt: new Date(Date.now() + 3 * DAY).toISOString() }).expect(201);
    const customer = (await api(app, owner).post('/crm/contacts', { firstName: 'Quiet', lifecycle: 'CUSTOMER', phone: '9847700002' }).expect(201)).body;
    const active = (await api(app, owner).post('/crm/contacts', { firstName: 'Recent', lifecycle: 'CUSTOMER', phone: '9847700003' }).expect(201)).body;
    await prisma.system.contact.update({ where: { id: customer.id }, data: { lastContactedAt: new Date(Date.now() - 60 * DAY) } });
    await prisma.system.contact.update({ where: { id: active.id }, data: { lastContactedAt: new Date(Date.now() - 5 * DAY) } });
    const scanner = app.get(AutomationScanner);
    expect(await scanner.scan(orgId)).toBe(2);
    await waitRuns(overdue.id, 1);
    await waitRuns(inactive.id, 1);
    expect((await api(app, owner).get(`/crm/contacts/${customer.id}`).expect(200)).body.tags).toContain('win-back');
    expect((await api(app, owner).get(`/crm/contacts/${active.id}`).expect(200)).body.tags).not.toContain('win-back');
    const mail = await waitForEmail(app, owner.email, 'automation-notice');
    expect(mail.subject).toBe('Automation: Overdue follow-up');
    expect(mail.text).toContain('Follow-up overdue for Late Test');
    // Scanning again does not repeat what already ran.
    expect(await scanner.scan(orgId)).toBe(0);
    await sleep(400);
    expect(await runsOf(overdue.id)).toHaveLength(1);
    expect(await runsOf(inactive.id)).toHaveLength(1);
  });

  it('waits through a delay and resumes; retries a transient failure; resumes a failed run without repeating steps', async () => {
    const w = await live(owner, 'Delayed tagging', [N('t', 'trigger', 'lead.created', { sources: ['referral'] }), N('a', 'action', 'add_tag', { tag: 'first' }), N('d', 'delay', 'delay', { amount: 5, unit: 'minutes' }), N('b', 'action', 'add_tag', { tag: 'second' })], [E('t', 'a'), E('a', 'd'), E('d', 'b')]);
    const lead = await newLead(owner, { source: 'referral' });
    const [waiting] = await waitRuns(w.id, 1, ['WAITING']);
    expect((await api(app, owner).get(`/crm/leads/${lead.id}`).expect(200)).body.tags).toEqual(['first']);
    expect((await stepsOf(waiting!.id)).map((s) => [s.nodeId, s.status])).toEqual([['t', 'SUCCEEDED'], ['a', 'SUCCEEDED'], ['d', 'WAITING']]);
    const runs = app.get<Queue>(getQueueToken(AUTOMATION_RUNS_QUEUE));
    const delayed = (await runs.getDelayed()).find((j) => j.data.runId === waiting!.id)!;
    expect(delayed.opts.delay).toBe(5 * 60_000);
    await delayed.promote();
    await waitRuns(w.id, 1, ['SUCCEEDED']);
    expect((await api(app, owner).get(`/crm/leads/${lead.id}`).expect(200)).body.tags).toEqual(['first', 'second']);

    // A transient error is retried by the queue; the step records two attempts.
    const actions = app.get(AutomationActions);
    const real = actions.execute.bind(actions);
    const executed: string[] = [];
    let blip = true;
    const spy = vi.spyOn(actions, 'execute').mockImplementation(async (node, ctx) => {
      executed.push(node.id);
      if (node.id === 'b' && blip) {
        blip = false;
        throw new Error('socket hang up');
      }
      return real(node, ctx);
    });
    const r = await live(owner, 'Flaky', [N('t', 'trigger', 'lead.created', { sources: ['phone'] }), N('a', 'action', 'add_tag', { tag: 'one' }), N('b', 'action', 'add_tag', { tag: 'two' })], [E('t', 'a'), E('a', 'b')]);
    const lead2 = await newLead(owner, { source: 'phone' });
    const [ok] = await waitRuns(r.id, 1, ['SUCCEEDED'], 20_000);
    expect((await stepsOf(ok!.id)).find((s) => s.nodeId === 'b')).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
    expect(executed).toEqual(['a', 'b', 'b']); // the step that had already worked ran once
    expect((await api(app, owner).get(`/crm/leads/${lead2.id}`).expect(200)).body.tags).toEqual(['one', 'two']);

    // A permanent error fails the run at once, emails the owner, and the run can be resumed from that step.
    executed.length = 0;
    let broken = true;
    spy.mockImplementation(async (node, ctx) => {
      executed.push(node.id);
      if (node.id === 'b' && broken) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'MEMBER_NOT_FOUND', 'A person chosen in this step is no longer on the team');
      return real(node, ctx);
    });
    const lead3 = await newLead(owner, { source: 'phone' });
    const [failed] = await waitRuns(r.id, 1, ['FAILED']);
    expect(failed).toBeTruthy();
    const detail = (await api(app, owner).get(`/automations/runs/${failed!.id}`).expect(200)).body;
    expect(detail.error).toContain('no longer on the team');
    expect((await api(app, owner).get(`/automations/${r.id}`).expect(200)).body.stats).toMatchObject({ failuresThisMonth: 1 });
    expect((await waitForEmail(app, owner.email, 'automation-failed')).subject).toBe('Automation “Flaky” had a failed run');
    broken = false;
    executed.length = 0;
    await api(app, viewer).post(`/automations/runs/${failed!.id}/retry`).expect(403);
    await api(app, owner).post(`/automations/runs/${failed!.id}/retry`).expect(200);
    for (let i = 0; i < 100 && (await api(app, owner).get(`/automations/runs/${failed!.id}`).expect(200)).body.status !== 'SUCCEEDED'; i++) await sleep(100);
    expect(executed).toEqual(['b']); // only the failed step ran again
    expect((await api(app, owner).get(`/crm/leads/${lead3.id}`).expect(200)).body.tags).toEqual(['one', 'two']);
    await api(app, owner).post(`/automations/runs/${failed!.id}/retry`).expect(409);
    spy.mockRestore();
  });

  it('stops loops: ping-pong workflows end at depth 3, and a workflow cannot re-trigger itself', async () => {
    const a = await live(owner, 'To contacted', [N('t', 'trigger', 'lead.status_changed', { to: ['QUALIFIED'] }), N('s', 'action', 'set_lead_status', { status: 'CONTACTED' })], [E('t', 's')]);
    const b = await live(owner, 'To qualified', [N('t', 'trigger', 'lead.status_changed', { to: ['CONTACTED'] }), N('s', 'action', 'set_lead_status', { status: 'QUALIFIED' })], [E('t', 's')]);
    const lead = await newLead(owner);
    await api(app, owner).patch(`/crm/leads/${lead.id}`, { status: 'QUALIFIED' }).expect(200);
    await waitRuns(b.id, 2, ['SUCCEEDED', 'SKIPPED']);
    await sleep(600);
    const ra = await runsOf(a.id);
    const rb = await runsOf(b.id);
    expect(ra.filter((r) => r.status === 'SUCCEEDED').map((r) => r.depth).sort()).toEqual([0, 2]);
    expect(rb.filter((r) => r.status === 'SUCCEEDED').map((r) => r.depth)).toEqual([1]);
    const skipped = rb.find((r) => r.status === 'SKIPPED')!;
    expect(skipped).toMatchObject({ depth: 3 });
    expect(skipped.skipReason).toMatch(/^LOOP_DEPTH:/);
    expect(ra.length + rb.length).toBe(4);

    // Moving to the same status that triggers it: the automation's own change does not start it again.
    await api(app, owner).post(`/automations/${a.id}/pause`).expect(200);
    await api(app, owner).post(`/automations/${b.id}/pause`).expect(200);
    const self = await live(owner, 'Self', [N('t', 'trigger', 'lead.status_changed', {}), N('s', 'action', 'set_lead_status', { status: 'QUALIFIED' })], [E('t', 's')]);
    const l2 = await newLead(owner);
    await api(app, owner).patch(`/crm/leads/${l2.id}`, { status: 'LOST' }).expect(200);
    await waitRuns(self.id, 2, ['SUCCEEDED', 'SKIPPED']);
    expect((await runsOf(self.id)).map((r) => r.status).sort()).toEqual(['SKIPPED', 'SUCCEEDED']);
    expect((await runsOf(self.id)).find((r) => r.status === 'SKIPPED')!.skipReason).toMatch(/^LOOP_SELF:/);
  });

  it('applies a cooldown per record and an hourly limit per workflow', async () => {
    const cool = await live(owner, 'Cooldown', [N('t', 'trigger', 'lead.status_changed', { to: ['QUALIFIED'] }), N('a', 'action', 'add_tag', { tag: 'cool' })], [E('t', 'a')], { reentryCooldownMinutes: 30 });
    const lead = await newLead(owner);
    await api(app, owner).patch(`/crm/leads/${lead.id}`, { status: 'QUALIFIED' }).expect(200);
    await waitRuns(cool.id, 1);
    for (const s of ['CONTACTED', 'QUALIFIED']) await api(app, owner).patch(`/crm/leads/${lead.id}`, { status: s }).expect(200);
    await waitRuns(cool.id, 2);
    expect((await runsOf(cool.id)).map((r) => r.status).sort()).toEqual(['SKIPPED', 'SUCCEEDED']);
    expect((await runsOf(cool.id)).find((r) => r.status === 'SKIPPED')!.skipReason).toMatch(/^COOLDOWN:/);

    const rate = await live(owner, 'Rate limited', [N('t', 'trigger', 'lead.created', { sources: ['event'] }), N('a', 'action', 'add_tag', { tag: 'rate' })], [E('t', 'a')], { maxRunsPerHour: 2 });
    for (let i = 0; i < 4; i++) {
      await newLead(owner, { source: 'event' });
      await waitRuns(rate.id, Math.min(i + 1, 3));
    }
    await sleep(300);
    const rr = await runsOf(rate.id);
    expect(rr.filter((r) => r.status === 'SUCCEEDED')).toHaveLength(2);
    // The skip is logged once an hour, not once per event.
    expect(rr.filter((r) => r.status === 'SKIPPED')).toHaveLength(1);
    expect(rr.find((r) => r.status === 'SKIPPED')!.skipReason).toMatch(/^RATE_LIMIT:/);
  });

  it('runs with the owner permissions: demoting them fails the run and pauses the automation', async () => {
    const w = await live(admin, 'Admin tagging', [N('t', 'trigger', 'lead.created', { sources: ['walk_in'] }), N('a', 'action', 'add_tag', { tag: 'admin-made' })], [E('t', 'a')]);
    expect((await api(app, owner).get(`/automations/${w.id}`).expect(200)).body.owner).toMatchObject({ id: admin.userId });
    await newLead(owner, { source: 'walk_in' });
    await waitRuns(w.id, 1, ['SUCCEEDED']);
    await prisma.system.member.updateMany({ where: { organizationId: orgId, userId: admin.userId }, data: { role: 'viewer' } });
    await newLead(owner, { source: 'walk_in' });
    const [failed] = await waitRuns(w.id, 1, ['FAILED']);
    const detail = (await api(app, owner).get(`/automations/runs/${failed!.id}`).expect(200)).body;
    expect(detail.error).toContain('OWNER_PERMISSION_LOST');
    const after = (await api(app, owner).get(`/automations/${w.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'PAUSED' });
    expect(after.pausedReason).toContain('OWNER_PERMISSION_LOST');
    await prisma.system.member.updateMany({ where: { organizationId: orgId, userId: admin.userId }, data: { role: 'admin' } });
    // Editing a running automation re-checks the editor's permissions.
    const live2 = await live(owner, 'Owner only', [N('t', 'trigger', 'lead.created', { sources: ['email'] }), N('a', 'action', 'add_tag', { tag: 'x' })], [E('t', 'a')]);
    const graph = { nodes: [N('t', 'trigger', 'lead.created', { sources: ['email'] }), N('a', 'action', 'add_tag', { tag: 'y' })], edges: [E('t', 'a')] };
    expect((await api(app, manager).patch(`/automations/${live2.id}`, { graph }).expect(403)).body.code).toBe('AUTOMATION_PERMISSION_MISSING');
    const edited = (await api(app, owner).patch(`/automations/${live2.id}`, { graph }).expect(200)).body;
    expect(edited).toMatchObject({ status: 'ACTIVE', version: 2 });
    // Pausing stops new runs.
    await api(app, owner).post(`/automations/${live2.id}/pause`).expect(200);
    await newLead(owner, { source: 'email' });
    await sleep(600);
    expect(await runsOf(live2.id)).toHaveLength(0);
  });

  it('keeps organizations apart and lists the runs for a record', async () => {
    const other = await signUp(app, 'Other Owner');
    await createOrg(app, other, 'Other Org');
    const first = (await api(app, owner).get('/automations?pageSize=1').expect(200)).body.data[0];
    await api(app, other).get(`/automations/${first.id}`).expect(404);
    await api(app, other).post(`/automations/${first.id}/activate`).expect(404);
    expect((await api(app, other).get('/automations').expect(200)).body.data).toEqual([]);
    expect((await api(app, other).get('/automations/runs').expect(200)).body.data).toEqual([]);
    const lead = await newLead(owner, { source: 'website' });
    const r = (await api(app, owner).get(`/automations/runs?entityId=${lead.id}`).expect(200)).body;
    expect(r.meta.total).toBeGreaterThanOrEqual(0);
    await api(app, other).get(`/automations/runs/${(await runsOf(first.id))[0]?.id ?? '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'}`).expect(404);
  });

  it('skips runs when the monthly plan quota is used up, and tells the admins once', async () => {
    const q = await signUp(app, 'Quota Owner');
    const qOrg = await createOrg(app, q, 'Quota Org');
    await prisma.system.subscription.deleteMany({ where: { organizationId: qOrg } }); // falls back to the Free plan
    const limit = (await api(app, q).get('/billing/usage').expect(200)).body.metrics.find((m: { metric: string }) => m.metric === 'automationRuns').limit as number;
    expect(limit).toBe(100);
    const w = await live(q, 'Quota test', [N('t', 'trigger', 'lead.created', {}), N('a', 'action', 'add_tag', { tag: 'x' })], [E('t', 'a')]);
    await prisma.system.automationRun.createMany({
      data: Array.from({ length: limit }, (_, i) => ({ organizationId: qOrg, workflowId: w.id, version: 1, graphSnapshot: {}, triggerKind: 'lead.created', entityType: 'lead', entityId: `x${i}`, dedupeKey: `seed-${i}`, status: 'SUCCEEDED' as const, finishedAt: new Date() })),
    });
    await api(app, q).post('/crm/leads', { firstName: 'Over', phone: '9847800001' }).expect(201);
    let skipped = null as { skipReason: string | null } | null;
    for (let i = 0; i < 80 && !skipped; i++) {
      skipped = await prisma.system.automationRun.findFirst({ where: { workflowId: w.id, status: 'SKIPPED' } });
      if (!skipped) await sleep(100);
    }
    expect(skipped?.skipReason).toMatch(/^QUOTA:/);
    expect((await waitForEmail(app, q.email, 'automation-notice')).subject).toBe('Automations paused by your plan limit');
    await api(app, q).post('/crm/leads', { firstName: 'Over2', phone: '9847800002' }).expect(201);
    await sleep(500);
    expect(await prisma.system.automationRun.count({ where: { workflowId: w.id, status: 'SKIPPED' } })).toBe(1); // logged once an hour
  });
});
