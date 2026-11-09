import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidWebhookSignatureError } from './payment-provider.interface.js';
import { RazorpayProvider, verifyRazorpaySignature } from './razorpay.provider.js';

const SECRET = 'whsec';
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');

describe('Razorpay webhook verification', () => {
  const body = JSON.stringify({ event: 'subscription.charged', created_at: 1_790_000_000, payload: {
    subscription: { entity: { id: 'sub_1', plan_id: 'plan_x', status: 'active', current_start: 1_790_000_000, current_end: 1_792_592_000, notes: { organizationId: 'org_1' } } },
    payment: { entity: { id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured', method: 'upi', invoice_id: 'inv_1' } },
  } });
  const provider = new RazorpayProvider({ keyId: 'k', keySecret: 's', webhookSecret: SECRET });

  it('accepts a valid signature and parses the event', () => {
    const e = provider.verifyWebhook(Buffer.from(body), sign(body), 'evt_1');
    expect(e).toMatchObject({ eventId: 'evt_1', type: 'subscription.charged', subscription: { id: 'sub_1', planId: 'plan_x', notes: { organizationId: 'org_1' } }, payment: { amount: '499.00', invoiceId: 'inv_1' } });
    expect(e.subscription?.currentEnd?.toISOString()).toBe(new Date(1_792_592_000_000).toISOString());
  });

  it('rejects tampered bodies, wrong secrets and malformed signatures', () => {
    expect(() => provider.verifyWebhook(Buffer.from(body.replace('49900', '1')), sign(body), 'e')).toThrow(InvalidWebhookSignatureError);
    expect(() => provider.verifyWebhook(Buffer.from(body), sign(body, 'other'), 'e')).toThrow(InvalidWebhookSignatureError);
    expect(verifyRazorpaySignature(Buffer.from(body), undefined, SECRET)).toBe(false);
    expect(verifyRazorpaySignature(Buffer.from(body), 'zz', SECRET)).toBe(false);
  });

  it('derives a stable event id from the body when the header is missing', () => {
    const a = provider.verifyWebhook(Buffer.from(body), sign(body), undefined);
    const b = provider.verifyWebhook(Buffer.from(body), sign(body), undefined);
    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends basic auth and surfaces provider errors', async () => {
    let auth = '';
    const p = new RazorpayProvider({ keyId: 'rzp_k', keySecret: 'rzp_s', webhookSecret: SECRET }, (async (_u: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization ?? '';
      return new Response(JSON.stringify({ error: { description: 'Bad plan', code: 'BAD_REQUEST_ERROR' } }), { status: 400 });
    }) as typeof fetch);
    await expect(p.createSubscription({ organizationId: 'o', externalPlanId: 'x', interval: 'MONTHLY', customerId: 'c' })).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_ERROR' });
    expect(auth).toBe(`Basic ${Buffer.from('rzp_k:rzp_s').toString('base64')}`);
  });
});
