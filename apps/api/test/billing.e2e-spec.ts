import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service.js';
import { RazorpayProvider } from '../src/billing/razorpay.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, waitForEmail, type TestUser } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_secret';

/** Fake Razorpay REST API recording every call. */
function fakeRazorpay() {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/v1', '');
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ method: init.method ?? 'GET', path, body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/customers') return json({ id: `cust_${++n}` });
    if (path === '/subscriptions') return json({ id: `sub_${++n}`, status: 'created', short_url: 'https://rzp.io/i/x' });
    if (/^\/subscriptions\/[^/]+\/cancel$/.test(path)) return json({ status: 'active' });
    if (/^\/subscriptions\/[^/]+$/.test(path)) return json({ status: 'active' });
    return json({ error: { description: 'not found' } }, 404);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('Billing (e2e)', () => {
  let app: NestExpressApplication;
  let disabledApp: NestExpressApplication;
  let owner: TestUser;
  let orgId: string;
  const rz = fakeRazorpay();

  const sendWebhook = (event: string, payload: object, eventId: string, secret = WEBHOOK_SECRET) => {
    const body = JSON.stringify({ entity: 'event', event, payload, created_at: Math.floor(Date.now() / 1000) });
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    return request(app.getHttpServer() as Server)
      .post('/api/v1/billing/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .set('X-Razorpay-Event-Id', eventId)
      .send(body);
  };
  const now = () => Math.floor(Date.now() / 1000);
  const subEntity = (id: string, planId: string, status = 'active') => ({
    subscription: { entity: { id, plan_id: planId, status, current_start: now(), current_end: now() + 30 * 86400, customer_id: 'cust_1', notes: { organizationId: orgId } } },
  });

  beforeAll(async () => {
    app = await createTestApp({
      paymentProvider: new RazorpayProvider({ keyId: 'rzp_test_key', keySecret: 'secret', webhookSecret: WEBHOOK_SECRET }, rz.fetchImpl),
    });
    disabledApp = await createTestApp();
    const prisma = app.get(PrismaService);
    await prisma.system.plan.update({ where: { code: 'STARTER' }, data: { razorpayPlanIdMonthly: 'plan_starter_m', razorpayPlanIdYearly: 'plan_starter_y' } });
    await prisma.system.plan.update({ where: { code: 'PROFESSIONAL' }, data: { razorpayPlanIdMonthly: 'plan_pro_m', razorpayPlanIdYearly: 'plan_pro_y' } });
    await prisma.system.plan.update({ where: { code: 'BUSINESS' }, data: { razorpayPlanIdMonthly: 'plan_biz_m', razorpayPlanIdYearly: null } });
    owner = await signUp(app, 'Billing Owner');
    orgId = await createOrg(app, owner, 'Billing Org');
  });

  afterAll(async () => {
    await app.close();
    await disabledApp.close();
  });

  it('starts new organizations on a 14-day Professional trial', async () => {
    const res = await api(app, owner).get('/billing/subscription').expect(200);
    expect(res.body).toMatchObject({ status: 'TRIALING', plan: { code: 'PROFESSIONAL' }, effectivePlan: { code: 'PROFESSIONAL' }, billingEnabled: true });
    const days = (new Date(res.body.trialEndsAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  it('reports BILLING_NOT_CONFIGURED when Razorpay keys are absent', async () => {
    const u = await signUp(disabledApp, 'No Billing');
    await createOrg(disabledApp, u, 'No Billing Org');
    const sub = await api(disabledApp, u).get('/billing/subscription').expect(200);
    expect(sub.body.billingEnabled).toBe(false);
    const res = await api(disabledApp, u).post('/billing/checkout', { plan: 'STARTER' }).expect(503);
    expect(res.body.code).toBe('BILLING_NOT_CONFIGURED');
    await request(disabledApp.getHttpServer() as Server).post('/api/v1/billing/webhooks/razorpay').send({}).expect(503);
  });

  it('validates checkout input and plan availability', async () => {
    await api(app, owner).post('/billing/checkout', { plan: 'AGENCY' }).expect(400);
    await api(app, owner).post('/billing/checkout', { plan: 'FREE' }).expect(400);
    const res = await api(app, owner).post('/billing/checkout', { plan: 'BUSINESS', interval: 'YEARLY' }).expect(503);
    expect(res.body.code).toBe('PLAN_NOT_CONFIGURED');
  });

  it('restricts billing management to the owner', async () => {
    const admin = await signUp(app, 'Admin');
    await inviteAndAccept(app, owner, admin, orgId, 'admin');
    await api(app, admin).get('/billing/subscription').expect(200);
    await api(app, admin).post('/billing/checkout', { plan: 'STARTER' }).expect(403);
    await api(app, admin).post('/billing/cancel').expect(403);
  });

  it('creates a Razorpay customer and subscription at checkout without switching plan yet', async () => {
    const res = await api(app, owner).post('/billing/checkout', { plan: 'PROFESSIONAL', interval: 'MONTHLY' }).expect(201);
    expect(res.body).toMatchObject({ provider: 'razorpay', keyId: 'rzp_test_key', plan: { code: 'PROFESSIONAL' }, interval: 'MONTHLY', prefill: { email: owner.email } });
    expect(res.body.subscriptionId).toMatch(/^sub_/);
    const sub = rz.calls.find((c) => c.path === '/subscriptions');
    expect(sub?.body).toMatchObject({ plan_id: 'plan_pro_m', total_count: 120, notes: { organizationId: orgId } });
    const status = await api(app, owner).get('/billing/subscription').expect(200);
    expect(status.body.status).toBe('TRIALING');
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await sendWebhook('subscription.activated', subEntity('sub_x', 'plan_pro_m'), 'evt_bad', 'wrong-secret').expect(400);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
  });

  it('activates on webhook, records the charge as an invoice, and is idempotent', async () => {
    const { externalId } = await app.get(PrismaService).system.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    await sendWebhook('subscription.activated', subEntity(externalId!, 'plan_pro_m'), 'evt_act_1').expect(200);
    const charged = {
      ...subEntity(externalId!, 'plan_pro_m'),
      payment: { entity: { id: 'pay_1', amount: 149900, currency: 'INR', status: 'captured', method: 'upi', invoice_id: 'inv_1' } },
    };
    const first = await sendWebhook('subscription.charged', charged, 'evt_chg_1').expect(200);
    expect(first.body.duplicate).toBe(false);
    const again = await sendWebhook('subscription.charged', charged, 'evt_chg_1').expect(200);
    expect(again.body.duplicate).toBe(true);

    const sub = await api(app, owner).get('/billing/subscription').expect(200);
    expect(sub.body).toMatchObject({ status: 'ACTIVE', plan: { code: 'PROFESSIONAL' }, provider: 'razorpay', trialEndsAt: null });
    const invoices = await api(app, owner).get('/billing/invoices').expect(200);
    expect(invoices.body.data).toHaveLength(1);
    expect(invoices.body.data[0]).toMatchObject({ amount: '1499.00', currency: 'INR', status: 'paid', number: 'inv_1' });

    await api(app, owner).post('/billing/checkout', { plan: 'STARTER' }).expect(409);
  });

  it('upgrades immediately and schedules downgrades for period end', async () => {
    const up = await api(app, owner).post('/billing/change-plan', { plan: 'BUSINESS', interval: 'MONTHLY' }).expect(200);
    expect(up.body.plan.code).toBe('BUSINESS');
    expect(rz.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { plan_id: 'plan_biz_m', schedule_change_at: 'now' } });

    const down = await api(app, owner).post('/billing/change-plan', { plan: 'STARTER', interval: 'MONTHLY' }).expect(200);
    expect(down.body).toMatchObject({ plan: { code: 'BUSINESS' }, pendingPlan: { code: 'STARTER' } });
    expect(rz.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { plan_id: 'plan_starter_m', schedule_change_at: 'cycle_end' } });
  });

  it('blocks downgrades when usage exceeds the target plan', async () => {
    const prisma = app.get(PrismaService);
    for (let i = 0; i < 2; i++) {
      await prisma.system.workspace.create({ data: { organizationId: orgId, name: `Extra ${i}` } });
    }
    const res = await api(app, owner).post('/billing/change-plan', { plan: 'FREE' }).expect(409);
    expect(res.body.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.details.exceeded.map((e: { metric: string }) => e.metric)).toEqual(expect.arrayContaining(['workspaces', 'members']));
  });

  it('moves to PAST_DUE with a grace period and emails the owner when a charge fails', async () => {
    const { externalId } = await app.get(PrismaService).system.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    await sendWebhook('payment.failed', { ...subEntity(externalId!, 'plan_biz_m'), payment: { entity: { id: 'pay_2', amount: 399900, currency: 'INR', status: 'failed', error_description: 'Card declined' } } }, 'evt_pf_1').expect(200);
    await sendWebhook('subscription.halted', subEntity(externalId!, 'plan_biz_m', 'halted'), 'evt_halt_1').expect(200);
    const sub = await api(app, owner).get('/billing/subscription').expect(200);
    expect(sub.body.status).toBe('PAST_DUE');
    expect(sub.body.effectivePlan.code).toBe('BUSINESS'); // still entitled during grace
    expect(new Date(sub.body.graceUntil).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    await waitForEmail(app, owner.email, 'payment-failed');
  });

  it('falls back to Free on cancellation', async () => {
    const { externalId } = await app.get(PrismaService).system.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    await sendWebhook('subscription.cancelled', subEntity(externalId!, 'plan_biz_m', 'cancelled'), 'evt_cancel_1').expect(200);
    const sub = await api(app, owner).get('/billing/subscription').expect(200);
    expect(sub.body).toMatchObject({ status: 'ACTIVE', plan: { code: 'FREE' }, provider: null });
  });

  it('expires trials, sends reminders and ends grace periods in the maintenance job', async () => {
    const u = await signUp(app, 'Trial User');
    const trialOrg = await createOrg(app, u, 'Trial Org');
    const prisma = app.get(PrismaService);
    const billing = app.get(BillingService);

    await prisma.system.subscription.update({ where: { organizationId: trialOrg }, data: { trialEndsAt: new Date(Date.now() + 2 * 86400000) } });
    const r1 = await billing.runMaintenance();
    expect(r1.remindersSent).toBeGreaterThanOrEqual(1);
    await waitForEmail(app, u.email, 'trial-ending');
    const r2 = await billing.runMaintenance();
    expect(r2.remindersSent).toBe(0); // only once

    await prisma.system.subscription.update({ where: { organizationId: trialOrg }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    await billing.runMaintenance();
    const sub = await api(app, u).get('/billing/subscription').expect(200);
    expect(sub.body).toMatchObject({ status: 'ACTIVE', plan: { code: 'FREE' } });
  });

  it('ends a trial immediately when cancelled', async () => {
    const u = await signUp(app, 'Canceller');
    await createOrg(app, u, 'Cancel Org');
    const res = await api(app, u).post('/billing/cancel').expect(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', plan: { code: 'FREE' } });
    await api(app, u).post('/billing/cancel').expect(409);
  });
});
