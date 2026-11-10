import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AIProviderRegistry } from '../src/ai/ai-provider.registry.js';
import type { AITextProvider } from '../src/ai/ai-provider.interfaces.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, type TestUser } from './helpers.js';

function textProvider(replies: string[]): AITextProvider & { prompts: string[] } {
  const p = {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-opus-5-5',
    prompts: [] as string[],
    async generateText(input: { prompt: string }) {
      p.prompts.push(input.prompt);
      const text = replies[Math.min(p.prompts.length - 1, replies.length - 1)]!;
      return { text, model: 'claude-opus-5-5', usage: { inputTokens: 700, outputTokens: 300, costMicroUsd: 9_000 }, finishReason: 'stop' as const };
    },
  };
  return p;
}

const INSIGHTS = {
  summary: 'Rahul is a qualified decision maker who replied on WhatsApp yesterday.',
  nextBestAction: { action: 'CALL', reason: 'He asked for pricing for three vans.', when: 'tomorrow' },
  talkingPoints: ['Three-van rollout', 'WhatsApp ordering'],
  followUpMessage: { channel: 'whatsapp', text: 'നമസ്കാരം രാഹുൽ, നാളെ ഒരു ചെറിയ കോൾ ചെയ്യാമോ? – ZatGo' },
};

describe('Lead scoring & AI insights (e2e)', () => {
  let app: NestExpressApplication;
  let registry: AIProviderRegistry;
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    app = await createTestApp();
    registry = app.get(AIProviderRegistry);
    owner = await signUp(app, 'Scoring Owner');
    orgId = await createOrg(app, owner, 'Scoring Org');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => registry.reset());

  it('scores leads on create and explains the score', async () => {
    const bare = (await api(app, owner).post('/crm/leads', { firstName: 'Bare', source: 'import' }).expect(201)).body;
    expect(bare).toMatchObject({ score: 3, scoreGrade: 'COLD', scoreReason: 'Source: import' });
    const strong = (
      await api(app, owner)
        .post('/crm/leads', { firstName: 'Rahul', email: 'rahul@nair.in', phone: '98470 12345', whatsapp: '98470 12345', company: 'Nair Traders', jobTitle: 'Managing Director', source: 'referral', status: 'QUALIFIED' })
        .expect(201)
    ).body;
    expect(strong.score).toBe(57); // 15 + 8 + 10 + 12 + 12
    expect(strong.scoreGrade).toBe('WARM');
    const breakdown = (await api(app, owner).get(`/crm/leads/${strong.id}/score`).expect(200)).body;
    expect(breakdown.signals.map((s: { key: string }) => s.key)).toEqual(['contactChannels', 'source', 'status', 'decisionMaker', 'company']);
    expect(breakdown.signals[0]).toMatchObject({ label: 'Reachability', points: 15, detail: 'Reachable by phone, WhatsApp, email' });
  });

  it('rises with activity, falls with overdue follow-ups and status changes', async () => {
    const lead = (await api(app, owner).post('/crm/leads', { firstName: 'Meera', phone: '98950 11111', source: 'website' }).expect(201)).body;
    expect(lead.score).toBe(15); // 6 + 9
    await api(app, owner).post('/crm/activities', { type: 'CALL', subject: 'Intro call', leadId: lead.id }).expect(201);
    const afterCall = (await api(app, owner).get(`/crm/leads/${lead.id}`).expect(200)).body;
    expect(afterCall.score).toBe(15 + 15 + 3 + 4); // recency, engagement, CONTACTED status
    expect(afterCall.scoreGrade).toBe('COLD');

    // An overdue follow-up costs points
    const prisma = app.get(PrismaService);
    const fu = (await api(app, owner).post('/crm/activities', { type: 'FOLLOW_UP', subject: 'Send quote', leadId: lead.id, dueAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201)).body;
    expect((await api(app, owner).get(`/crm/leads/${lead.id}`).expect(200)).body.score).toBe(37 + 6);
    await prisma.system.activity.update({ where: { id: fu.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    expect((await api(app, owner).get(`/crm/leads/${lead.id}/score`).expect(200)).body.score).toBe(37 - 8);

    await api(app, owner).patch(`/crm/leads/${lead.id}`, { status: 'LOST' }).expect(200);
    const lost = (await api(app, owner).get(`/crm/leads/${lead.id}`).expect(200)).body;
    expect(lost).toMatchObject({ score: 0, scoreGrade: 'COLD' });
  });

  it('sorts and filters by score and grade, and lists hot leads first in the summary', async () => {
    const sorted = (await api(app, owner).get('/crm/leads?sort=score&order=desc').expect(200)).body.data.map((l: { firstName: string }) => l.firstName);
    expect(sorted[0]).toBe('Rahul');
    expect((await api(app, owner).get('/crm/leads?grade=WARM').expect(200)).body.data.map((l: { firstName: string }) => l.firstName)).toEqual(['Rahul']);
    const summary = (await api(app, owner).get('/crm/summary').expect(200)).body;
    expect(summary.leadsByGrade).toMatchObject({ WARM: 1 });
    expect(summary.callFirst[0]).toMatchObject({ name: 'Rahul', score: 57, grade: 'WARM' });
    expect(summary.callFirst.map((l: { name: string }) => l.name)).not.toContain('Meera'); // lost leads excluded
  });

  it('applies organization scoring settings after recalculation', async () => {
    expect((await api(app, owner).get('/crm/scoring/settings').expect(200)).body).toMatchObject({ hotThreshold: 70, warmThreshold: 40 });
    await api(app, owner).patch('/crm/scoring/settings', { hotThreshold: 30, warmThreshold: 40 }).expect(400);
    await api(app, owner).patch('/crm/scoring/settings', { weights: { company: 3, source: 0 }, hotThreshold: 50, warmThreshold: 20, targetIndustries: ['Retail'] }).expect(200);
    await api(app, owner).post('/crm/scoring/recalculate').expect(202);
    let rahul;
    for (let i = 0; i < 50; i++) {
      rahul = (await api(app, owner).get('/crm/leads?q=Rahul').expect(200)).body.data[0];
      if (rahul.score === 61) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(rahul).toMatchObject({ score: 61, scoreGrade: 'HOT' }); // channels 15 + company 8×3 + decision maker 10 + qualified 12; source weight 0
  });

  it('generates, caches and meters AI insights; schedules the suggested follow-up', async () => {
    const rahul = (await api(app, owner).get('/crm/leads?q=Rahul').expect(200)).body.data[0];
    expect((await api(app, owner).get(`/crm/leads/${rahul.id}/insights`).expect(200)).body).toEqual({ insights: null });
    expect((await api(app, owner).post(`/crm/leads/${rahul.id}/insights`, {}).expect(503)).body.code).toBe('AI_PROVIDER_UNAVAILABLE');

    const t = textProvider(['not json', JSON.stringify(INSIGHTS)]);
    registry.register('TEXT', t);
    const res = await api(app, owner).post(`/crm/leads/${rahul.id}/insights`, { language: 'ml' }).expect(201);
    expect(res.body).toMatchObject({ summary: INSIGHTS.summary, nextBestAction: { action: 'CALL', when: 'tomorrow' }, language: 'ml', provider: 'anthropic' });
    expect(t.prompts[0]).toContain('Lead: Rahul, Managing Director at Nair Traders');
    expect(t.prompts[0]).toContain('Malayalam');
    expect(t.prompts[0]).toContain('Decision maker +10');
    expect(t.prompts[1]).toContain('could not be used'); // repair retry
    expect((await api(app, owner).get(`/crm/leads/${rahul.id}/insights`).expect(200)).body.insights.summary).toBe(INSIGHTS.summary);
    const usage = await app.get(PrismaService).system.aiUsage.findMany({ where: { organizationId: orgId, purpose: 'crm' } });
    expect(usage).toHaveLength(2);

    registry.reset();
    registry.register('TEXT', textProvider(['nope']));
    expect((await api(app, owner).post(`/crm/leads/${rahul.id}/insights`, {}).expect(422)).body.code).toBe('AI_OUTPUT_INVALID');
  });

  it('drafts a message for a contact without inventing facts', async () => {
    const contact = (await api(app, owner).post('/crm/contacts', { firstName: 'Aisha', email: 'aisha@mansoori.ae', lifecycle: 'CUSTOMER' }).expect(201)).body;
    const t = textProvider([JSON.stringify({ subject: 'Thank you', text: 'Dear Aisha, thank you for your business.' })]);
    registry.register('TEXT', t);
    const res = await api(app, owner).post(`/crm/contacts/${contact.id}/draft-message`, { channel: 'email', goal: 'thank_you', language: 'en' }).expect(200);
    expect(res.body).toMatchObject({ channel: 'email', subject: 'Thank you', text: 'Dear Aisha, thank you for your business.' });
    expect(t.prompts[0]).toContain('thank them for their business');
    await api(app, owner).post(`/crm/contacts/${contact.id}/draft-message`, { channel: 'fax' }).expect(400);
  });

  it('keeps scoring and insights within roles and tenants', async () => {
    registry.register('TEXT', textProvider([JSON.stringify(INSIGHTS)]));
    const rahul = (await api(app, owner).get('/crm/leads?q=Rahul').expect(200)).body.data[0];
    const agent = await signUp(app, 'Score Agent');
    await inviteAndAccept(app, owner, agent, orgId, 'sales_agent');
    await api(app, agent).get(`/crm/leads/${rahul.id}/score`).expect(404);
    await api(app, agent).post(`/crm/leads/${rahul.id}/insights`, {}).expect(404);
    await api(app, agent).patch('/crm/scoring/settings', { hotThreshold: 60, warmThreshold: 30 }).expect(403);
    await api(app, agent).post('/crm/scoring/recalculate').expect(403);
    const viewer = await signUp(app, 'Score Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    await api(app, viewer).get(`/crm/leads/${rahul.id}/score`).expect(200);
    await api(app, viewer).post(`/crm/leads/${rahul.id}/insights`, {}).expect(403);

    const outsider = await signUp(app, 'Score Outsider');
    await createOrg(app, outsider, 'Other Scoring Org');
    await api(app, outsider).get(`/crm/leads/${rahul.id}/score`).expect(404);
    await api(app, outsider).get(`/crm/leads/${rahul.id}/insights`).expect(404);
    expect((await api(app, outsider).get('/crm/scoring/settings').expect(200)).body.hotThreshold).toBe(70); // own defaults
  });
});
