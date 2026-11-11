import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, MemoryObjectStorage } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, type TestUser } from './helpers.js';

describe('CRM core (e2e)', () => {
  let app: NestExpressApplication;
  let owner: TestUser;
  let orgId: string;
  let agent: TestUser;
  let agentId: string;
  const storage = new MemoryObjectStorage();

  const uploadCsv = async (user: TestUser, csv: string) => {
    const body = Buffer.from(csv, 'utf8');
    const up = await api(app, user).post('/storage/uploads', { fileName: 'leads.csv', mimeType: 'text/csv', sizeBytes: body.length, purpose: 'IMPORT' }).expect(201);
    storage.put(up.body.key, { sizeBytes: body.length, contentType: 'text/csv' }, body);
    await api(app, user).post(`/storage/uploads/${up.body.fileId}/complete`).expect(201);
    return up.body.fileId as string;
  };

  const waitImport = async (user: TestUser, id: string) => {
    for (let i = 0; i < 100; i++) {
      const r = await api(app, user).get(`/crm/import/${id}`).expect(200);
      if (['SUCCEEDED', 'FAILED'].includes(r.body.status)) return r.body;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('import did not finish');
  };

  beforeAll(async () => {
    app = await createTestApp({ storage });
    owner = await signUp(app, 'CRM Owner');
    orgId = await createOrg(app, owner, 'CRM Org');
    agent = await signUp(app, 'Sales Agent');
    await inviteAndAccept(app, owner, agent, orgId, 'sales_agent');
    agentId = (await api(app, agent).get('/users/me').expect(200)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates, filters, searches and updates leads with normalised duplicate detection', async () => {
    const a = await api(app, owner).post('/crm/leads', { firstName: 'Rahul', lastName: 'Nair', email: 'Rahul@Example.com', phone: '98470 12345', company: 'Nair Traders Pvt Ltd', source: 'facebook', tags: ['onam'] }).expect(201);
    expect(a.body).toMatchObject({ name: 'Rahul Nair', status: 'NEW', source: 'facebook', owner: { name: 'CRM Owner' } });
    await api(app, owner).post('/crm/leads', { firstName: 'Aisha', phone: '+971 50 123 4567', source: 'whatsapp', city: 'Dubai' }).expect(201);

    // Same phone in another format → duplicate
    const dup = await api(app, owner).post('/crm/leads', { firstName: 'R', phone: '+91 9847012345' }).expect(409);
    expect(dup.body).toMatchObject({ code: 'DUPLICATE_RECORD', details: { duplicates: [{ type: 'lead', id: a.body.id, matchedOn: ['phone'] }] } });
    const check = await api(app, owner).get('/crm/leads/duplicates?email=rahul@example.com').expect(200);
    expect(check.body[0]).toMatchObject({ id: a.body.id, matchedOn: ['email'] });
    await api(app, owner).post('/crm/leads', { firstName: 'R', phone: '+91 9847012345', allowDuplicate: true }).expect(201);

    expect((await api(app, owner).get('/crm/leads?source=whatsapp').expect(200)).body.data.map((l: { firstName: string }) => l.firstName)).toEqual(['Aisha']);
    expect((await api(app, owner).get('/crm/leads?q=nair').expect(200)).body.meta.total).toBe(1);
    expect((await api(app, owner).get('/crm/leads?tag=onam').expect(200)).body.meta.total).toBe(1);
    const upd = await api(app, owner).patch(`/crm/leads/${a.body.id}`, { status: 'QUALIFIED', jobTitle: 'Owner' }).expect(200);
    expect(upd.body).toMatchObject({ status: 'QUALIFIED', jobTitle: 'Owner' });
    await api(app, owner).post('/crm/leads', { firstName: '' }).expect(400);
  });

  it('partial updates leave omitted fields untouched', async () => {
    const lead = (await api(app, owner).post('/crm/leads', { firstName: 'Patch', status: 'QUALIFIED', source: 'referral', tags: ['vip'], customFields: { budget: '5L' } }).expect(201)).body;
    const updated = (await api(app, owner).patch(`/crm/leads/${lead.id}`, { firstName: 'Patched' }).expect(200)).body;
    expect(updated).toMatchObject({ firstName: 'Patched', status: 'QUALIFIED', source: 'referral', tags: ['vip'], customFields: { budget: '5L' } });
    const pipeline = (await api(app, owner).get('/crm/pipelines').expect(200)).body[0];
    const won = pipeline.stages.find((st: { kind: string }) => st.kind === 'WON');
    const renamed = (await api(app, owner).patch(`/crm/pipelines/${pipeline.id}/stages/${won.id}`, { name: 'Closed won' }).expect(200)).body;
    expect(renamed.stages.find((st: { id: string }) => st.id === won.id)).toMatchObject({ name: 'Closed won', kind: 'WON' });
    await api(app, owner).patch(`/crm/pipelines/${pipeline.id}/stages/${won.id}`, { name: won.name }).expect(200);
  });

  it('logs activities, tracks follow-ups and converts a lead into contact, company and deal', async () => {
    const lead = (await api(app, owner).post('/crm/leads', { firstName: 'Fathima', email: 'fathima@kochibakes.in', company: 'Kochi Bakes LLP', phone: '0484 2345678' }).expect(201)).body;
    await api(app, owner).post('/crm/activities', { type: 'WHATSAPP', subject: 'Sent brochure', leadId: lead.id }).expect(201);
    const due = new Date(Date.now() + 2 * 3600_000).toISOString();
    const fu = await api(app, owner).post('/crm/activities', { type: 'FOLLOW_UP', subject: 'Call about pricing', leadId: lead.id, dueAt: due, priority: 'HIGH' }).expect(201);
    expect(fu.body.completedAt).toBeNull();
    const after = (await api(app, owner).get(`/crm/leads/${lead.id}`).expect(200)).body;
    expect(after.status).toBe('CONTACTED'); // first contact moved NEW → CONTACTED
    expect(after.lastContactedAt).not.toBeNull();
    expect(new Date(after.nextFollowUpAt).toISOString()).toBe(new Date(due).toISOString());
    expect((await api(app, owner).get('/crm/follow-ups?range=week').expect(200)).body.map((x: { id: string }) => x.id)).toContain(fu.body.id);
    expect((await api(app, owner).get('/crm/follow-ups?range=overdue').expect(200)).body.map((x: { id: string }) => x.id)).not.toContain(fu.body.id);
    await api(app, owner).post('/crm/activities', { type: 'TASK', subject: 'No due date', leadId: lead.id }).expect(400);

    const conv = await api(app, owner).post(`/crm/leads/${lead.id}/convert`, { dealValue: 150000 }).expect(201);
    expect(conv.body.lead).toMatchObject({ status: 'CONVERTED', convertedContactId: conv.body.contact.id });
    expect(conv.body.contact).toMatchObject({ name: 'Fathima', companyName: 'Kochi Bakes LLP', lifecycle: 'PROSPECT' });
    expect(conv.body.deal).toMatchObject({ value: 150000, currency: 'INR', stageName: 'New Lead', status: 'OPEN', contact: { id: conv.body.contact.id } });
    const tl = await api(app, owner).get(`/crm/contacts/${conv.body.contact.id}/timeline`).expect(200);
    expect(tl.body.activities).toHaveLength(2); // moved from the lead
    expect(tl.body.deals).toHaveLength(1);
    await api(app, owner).post(`/crm/leads/${lead.id}/convert`, {}).expect(409);
    // A second lead with the same company re-uses it
    const lead2 = (await api(app, owner).post('/crm/leads', { firstName: 'Joseph', company: 'Kochi Bakes', email: 'joseph@kochibakes.in' }).expect(201)).body;
    const conv2 = await api(app, owner).post(`/crm/leads/${lead2.id}/convert`, { createDeal: false }).expect(201);
    expect(conv2.body.contact.companyId).toBe(conv.body.contact.companyId);
    expect(conv2.body.deal).toBeNull();
  });

  it('runs a Kanban pipeline: move, reorder, win (customer) and lose (reason required)', async () => {
    const [pipeline] = (await api(app, owner).get('/crm/pipelines').expect(200)).body;
    expect(pipeline.stages.map((s: { name: string }) => s.name)).toEqual(['New Lead', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
    const stage = (n: string) => pipeline.stages.find((s: { name: string }) => s.name === n).id as string;
    const contact = (await api(app, owner).post('/crm/contacts', { firstName: 'Meera', email: 'meera@example.com' }).expect(201)).body;
    const d1 = (await api(app, owner).post('/crm/deals', { name: 'ERP for Meera', value: 50000, contactId: contact.id }).expect(201)).body;
    const d2 = (await api(app, owner).post('/crm/deals', { name: 'Second deal', value: 25000.5, stageId: stage('Proposal') }).expect(201)).body;
    expect(d1).toMatchObject({ stageName: 'New Lead', probability: 10, status: 'OPEN' });

    await api(app, owner).post(`/crm/deals/${d1.id}/move`, { stageId: stage('Proposal'), beforeId: d2.id }).expect(200);
    let board = (await api(app, owner).get(`/crm/pipelines/${pipeline.id}/board`).expect(200)).body;
    const proposal = board.columns.find((c: { stage: { name: string } }) => c.stage.name === 'Proposal');
    expect(proposal.deals.map((d: { id: string }) => d.id)).toEqual([d1.id, d2.id]);
    expect(proposal).toMatchObject({ count: 2, total: 75000.5 });

    expect((await api(app, owner).post(`/crm/deals/${d2.id}/move`, { stageId: stage('Lost') }).expect(422)).body.code).toBe('LOST_REASON_REQUIRED');
    const lost = await api(app, owner).post(`/crm/deals/${d2.id}/move`, { stageId: stage('Lost'), lostReason: 'Went with a competitor' }).expect(200);
    expect(lost.body).toMatchObject({ status: 'LOST', probability: 0, lostReason: 'Went with a competitor' });
    const won = await api(app, owner).post(`/crm/deals/${d1.id}/move`, { stageId: stage('Won') }).expect(200);
    expect(won.body).toMatchObject({ status: 'WON', probability: 100 });
    expect(won.body.closedAt).not.toBeNull();
    expect((await api(app, owner).get(`/crm/contacts/${contact.id}`).expect(200)).body).toMatchObject({ lifecycle: 'CUSTOMER', wonValue: 50000 });
    expect((await api(app, owner).get('/crm/customers').expect(200)).body.data.map((c: { id: string }) => c.id)).toContain(contact.id);

    // Stage rules
    expect((await api(app, owner).delete(`/crm/pipelines/${pipeline.id}/stages/${stage('Won')}`).expect(409)).body.code).toBe('STAGE_NOT_EMPTY');
    const added = await api(app, owner).post(`/crm/pipelines/${pipeline.id}/stages`, { name: 'Demo', probability: 50 }).expect(201);
    expect(added.body.stages.map((s: { name: string }) => s.name)).toEqual(['New Lead', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Demo', 'Won', 'Lost']);
    const demo = added.body.stages.find((s: { name: string }) => s.name === 'Demo').id;
    await api(app, owner).delete(`/crm/pipelines/${pipeline.id}/stages/${demo}`).expect(200);
    board = (await api(app, owner).get(`/crm/pipelines/${pipeline.id}/board`).expect(200)).body;
    expect(board.columns).toHaveLength(7);

    const summary = (await api(app, owner).get('/crm/summary').expect(200)).body;
    expect(summary).toMatchObject({ wonThisMonth: { count: 1, value: 50000 }, currency: 'INR' });
    expect(summary.openDeals).toBeGreaterThanOrEqual(1);
  });

  it('imports a CSV with mapping, de-duplication and per-row errors, and exports safely', async () => {
    const csv = [
      'Full Name,Mobile Number,E-mail,Company Name,Source,Tags',
      'Anil Kumar,98950 11111,anil@example.com,Anil Stores,Google Ads,kochi;retail',
      '"Sara, Al Mansoori",+971 55 222 3333,,Mansoori Trading LLC,Walk-in,dubai',
      'Rahul Duplicate,98470 12345,,,,',
      ',12345,bad,,,',
      '=HYPERLINK("http://evil"),98950 44444,,,,',
    ].join('\n');
    const fileId = await uploadCsv(owner, csv);
    const preview = await api(app, owner).post('/crm/import/preview', { fileId, entity: 'leads' }).expect(200);
    expect(preview.body).toMatchObject({ rowCount: 5, mapping: { 'Full Name': 'firstName', 'Mobile Number': 'phone', 'E-mail': 'email', 'Company Name': 'company', Source: 'source', Tags: 'tags' } });
    await api(app, owner).post('/crm/import', { fileId, entity: 'leads', mapping: { 'Mobile Number': 'phone' } }).expect(422);

    const started = await api(app, owner).post('/crm/import', { fileId, entity: 'leads', mapping: preview.body.mapping, dedupe: 'skip', tag: 'imported' }).expect(202);
    const done = await waitImport(owner, started.body.id);
    expect(done).toMatchObject({ status: 'SUCCEEDED', total: 5, processed: 5, created: 3, skipped: 2 });
    expect(done.errors).toEqual([{ row: 5, message: expect.stringContaining('firstName') }]);
    const anil = (await api(app, owner).get('/crm/leads?q=anil').expect(200)).body.data[0];
    expect(anil).toMatchObject({ source: 'google_ads', tags: ['kochi', 'retail', 'imported'], phone: '98950 11111' });
    const sara = (await api(app, owner).get('/crm/leads?q=mansoori').expect(200)).body.data[0];
    expect(sara).toMatchObject({ firstName: 'Sara, Al Mansoori', source: 'walk_in' });

    const exported = await api(app, owner).get('/crm/leads/export.csv?q=hyperlink').expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain(`"'=HYPERLINK(""http://evil"")"`);

    await api(app, owner).post('/crm/import/preview', { fileId: await uploadCsv(owner, 'a,b\n"1,2'), entity: 'leads' }).expect(422);
  });

  it('enforces the plan CRM record limit on create and import', async () => {
    const u = await signUp(app, 'Small CRM');
    const org2 = await createOrg(app, u, 'Small CRM Org');
    await api(app, u).post('/billing/change-plan', { plan: 'FREE' }).expect(200);
    const prisma = app.get(PrismaService);
    const free = await prisma.system.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    const limits = free.limits as Record<string, number>;
    expect(limits.crmRecords).toBe(500);
    await prisma.system.plan.update({ where: { code: 'FREE' }, data: { limits: { ...limits, crmRecords: 2 } } });
    try {
      await api(app, u).post('/crm/leads', { firstName: 'One' }).expect(201);
      await api(app, u).post('/crm/contacts', { firstName: 'Two' }).expect(201);
      expect((await api(app, u).post('/crm/leads', { firstName: 'Three' }).expect(402)).body.code).toBe('PLAN_LIMIT_REACHED');
      const usage = (await api(app, u).get('/billing/usage').expect(200)).body.metrics.find((m: { metric: string }) => m.metric === 'crmRecords');
      expect(usage).toEqual({ metric: 'crmRecords', used: 2, limit: 2 });
      await api(app, u).post('/crm/import', { fileId: await uploadCsv(u, 'Name\nA\nB'), entity: 'leads', mapping: { Name: 'firstName' } }).expect(402);
    } finally {
      await prisma.system.plan.update({ where: { code: 'FREE' }, data: { limits } });
    }
    expect(org2).toBeTruthy();
  });

  it('limits Sales Agents to their own records', async () => {
    const mine = (await api(app, agent).post('/crm/leads', { firstName: 'Agent Lead', ownerId: agentId }).expect(201)).body;
    expect(mine.owner.id).toBe(agentId);
    const others = (await api(app, owner).post('/crm/leads', { firstName: 'Owner Lead' }).expect(201)).body;
    const list = (await api(app, agent).get('/crm/leads').expect(200)).body;
    expect(list.data.map((l: { id: string }) => l.id)).toEqual([mine.id]);
    await api(app, agent).get(`/crm/leads/${others.id}`).expect(404);
    await api(app, agent).patch(`/crm/leads/${others.id}`, { status: 'LOST' }).expect(404);
    await api(app, agent).post('/crm/activities', { type: 'CALL', subject: 'x', leadId: others.id }).expect(404);
    expect((await api(app, agent).post('/crm/leads', { firstName: 'X', ownerId: (await api(app, owner).get('/users/me')).body.id }).expect(403)).body.code).toBe('CANNOT_ASSIGN');
    await api(app, agent).delete(`/crm/leads/${mine.id}`).expect(403); // no crm:delete
    // Managers can assign to the agent; the agent then sees it
    await api(app, owner).patch(`/crm/leads/${others.id}`, { ownerId: agentId }).expect(200);
    expect((await api(app, agent).get('/crm/leads').expect(200)).body.meta.total).toBe(2);
    await api(app, owner).patch(`/crm/leads/${others.id}`, { ownerId: 'not-a-member' }).expect(422);
    const summary = (await api(app, agent).get('/crm/summary').expect(200)).body;
    expect(summary.leadsByStatus.NEW).toBe(2);
  });

  it('keeps viewers read-only, lets CRM managers delete, and isolates tenants', async () => {
    const lead = (await api(app, owner).post('/crm/leads', { firstName: 'Isolated' }).expect(201)).body;
    const viewer = await signUp(app, 'CRM Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    await api(app, viewer).get(`/crm/leads/${lead.id}`).expect(200);
    await api(app, viewer).post('/crm/leads', { firstName: 'Nope' }).expect(403);
    await api(app, viewer).patch(`/crm/leads/${lead.id}`, { status: 'LOST' }).expect(403);

    const manager = await signUp(app, 'CRM Manager');
    await inviteAndAccept(app, owner, manager, orgId, 'crm_manager');
    await api(app, manager).delete(`/crm/leads/${lead.id}`).expect(204);
    await api(app, owner).get(`/crm/leads/${lead.id}`).expect(404);

    const outsider = await signUp(app, 'CRM Outsider');
    await createOrg(app, outsider, 'Other CRM');
    const theirs = (await api(app, owner).get('/crm/leads').expect(200)).body.data[0];
    await api(app, outsider).get(`/crm/leads/${theirs.id}`).expect(404);
    expect((await api(app, outsider).get('/crm/leads').expect(200)).body.meta.total).toBe(0);
    expect((await api(app, outsider).get('/crm/contacts').expect(200)).body.meta.total).toBe(0);
    expect((await api(app, outsider).get('/crm/companies').expect(200)).body.meta.total).toBe(0);
    expect((await api(app, outsider).get('/crm/deals').expect(200)).body.meta.total).toBe(0);
    const [pipeline] = (await api(app, owner).get('/crm/pipelines').expect(200)).body;
    await api(app, outsider).get(`/crm/pipelines/${pipeline.id}/board`).expect(404);
    expect((await api(app, outsider).get('/crm/leads/duplicates?email=rahul@example.com').expect(200)).body).toEqual([]);
  });
});
