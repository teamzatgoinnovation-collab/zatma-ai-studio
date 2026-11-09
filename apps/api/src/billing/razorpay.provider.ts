import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors.js';
import type { BillingInterval } from '../generated/prisma/client.js';
import {
  InvalidWebhookSignatureError,
  type PaymentProvider,
  type PaymentWebhookEvent,
  type ProviderPayment,
  type ProviderSubscriptionState,
} from './payment-provider.interface.js';

const API = 'https://api.razorpay.com/v1';

/** Billing cycles to authorise up-front (Razorpay requires a finite total_count). ~10 years. */
const TOTAL_COUNT: Record<BillingInterval, number> = { MONTHLY: 120, YEARLY: 10 };

const notConfigured = () =>
  new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'BILLING_NOT_CONFIGURED', 'Online payments are not enabled yet. Please contact support.');

/** Verifies `X-Razorpay-Signature`: hex HMAC-SHA256 of the raw request body with the webhook secret. */
export function verifyRazorpaySignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const toDate = (unix: unknown): Date | null => (typeof unix === 'number' && unix > 0 ? new Date(unix * 1000) : null);
const paiseToMajor = (amount: unknown): string => (typeof amount === 'number' ? (amount / 100).toFixed(2) : '0.00');

interface RzSubscriptionEntity {
  id: string;
  plan_id?: string;
  status?: string;
  current_start?: number;
  current_end?: number;
  customer_id?: string;
  notes?: Record<string, string> | unknown[];
}

interface RzPaymentEntity {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  invoice_id?: string | null;
  error_description?: string | null;
}

export function parseRazorpayEvent(body: unknown, eventIdHeader: string | undefined, rawBody: Buffer): PaymentWebhookEvent {
  const event = body as {
    event?: string;
    created_at?: number;
    payload?: { subscription?: { entity?: RzSubscriptionEntity }; payment?: { entity?: RzPaymentEntity } };
  };
  if (!event?.event) throw new InvalidWebhookSignatureError();
  const sub = event.payload?.subscription?.entity;
  const pay = event.payload?.payment?.entity;

  const subscription: ProviderSubscriptionState | null = sub?.id
    ? {
        id: sub.id,
        planId: sub.plan_id ?? null,
        status: sub.status ?? 'unknown',
        currentStart: toDate(sub.current_start),
        currentEnd: toDate(sub.current_end),
        customerId: sub.customer_id ?? null,
        notes: Array.isArray(sub.notes) ? {} : ((sub.notes as Record<string, string> | undefined) ?? {}),
      }
    : null;
  const payment: ProviderPayment | null = pay?.id
    ? {
        id: pay.id,
        amount: paiseToMajor(pay.amount),
        currency: pay.currency ?? 'INR',
        status: pay.status ?? 'unknown',
        method: pay.method ?? null,
        invoiceId: pay.invoice_id ?? null,
        error: pay.error_description ?? null,
      }
    : null;

  return {
    // Razorpay sends a unique x-razorpay-event-id; fall back to a body hash so retries stay idempotent.
    eventId: eventIdHeader || createHash('sha256').update(rawBody).digest('hex'),
    type: event.event,
    occurredAt: toDate(event.created_at) ?? new Date(),
    subscription,
    payment,
    raw: body,
  };
}

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Razorpay Subscriptions via the REST API (https://razorpay.com/docs/api/payments/subscriptions/). */
export class RazorpayProvider implements PaymentProvider {
  readonly id = 'razorpay' as const;
  readonly configured = true;
  readonly publicKey: string;

  constructor(
    private readonly creds: RazorpayCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.publicKey = creds.keyId;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.creds.keyId}:${this.creds.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string; code?: string } };
    if (!res.ok) {
      throw new AppException(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_ERROR', json.error?.description ?? `Razorpay responded ${res.status}`, {
        providerCode: json.error?.code ?? null,
      });
    }
    return json;
  }

  async createCustomer(input: { organizationId: string; name: string; email: string }) {
    const c = await this.call<{ id: string }>('POST', '/customers', {
      name: input.name.slice(0, 50),
      email: input.email,
      fail_existing: '0', // return the existing customer for this email instead of failing
      notes: { organizationId: input.organizationId },
    });
    return { customerId: c.id };
  }

  async createSubscription(input: { organizationId: string; externalPlanId: string; interval: BillingInterval; customerId: string }) {
    const s = await this.call<{ id: string; short_url?: string }>('POST', '/subscriptions', {
      plan_id: input.externalPlanId,
      customer_id: input.customerId,
      total_count: TOTAL_COUNT[input.interval],
      customer_notify: 1,
      notes: { organizationId: input.organizationId },
    });
    return { subscriptionId: s.id, shortUrl: s.short_url ?? null };
  }

  async changePlan(input: { subscriptionId: string; externalPlanId: string; when: 'now' | 'cycle_end' }) {
    await this.call('PATCH', `/subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
      plan_id: input.externalPlanId,
      schedule_change_at: input.when,
      customer_notify: 1,
    });
  }

  async cancelSubscription(subscriptionId: string, atPeriodEnd: boolean) {
    await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 });
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined, eventIdHeader: string | undefined): PaymentWebhookEvent {
    if (!verifyRazorpaySignature(rawBody, signature, this.creds.webhookSecret)) throw new InvalidWebhookSignatureError();
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidWebhookSignatureError();
    }
    return parseRazorpayEvent(body, eventIdHeader, rawBody);
  }
}

/** Bound when Razorpay credentials are absent: billing reads work, payment actions fail clearly. */
export class DisabledPaymentProvider implements PaymentProvider {
  readonly id = 'razorpay' as const;
  readonly configured = false;
  readonly publicKey = null;
  createCustomer(): Promise<never> {
    return Promise.reject(notConfigured());
  }
  createSubscription(): Promise<never> {
    return Promise.reject(notConfigured());
  }
  changePlan(): Promise<never> {
    return Promise.reject(notConfigured());
  }
  cancelSubscription(): Promise<never> {
    return Promise.reject(notConfigured());
  }
  verifyWebhook(): PaymentWebhookEvent {
    throw notConfigured();
  }
}
