import type { BillingInterval } from '../generated/prisma/client.js';

export interface ProviderSubscriptionState {
  id: string;
  /** Provider's plan id (mapped to our Plan via razorpayPlanIdMonthly/Yearly). */
  planId: string | null;
  status: string;
  currentStart: Date | null;
  currentEnd: Date | null;
  customerId: string | null;
  notes: Record<string, string>;
}

export interface ProviderPayment {
  id: string;
  /** Amount in major currency units as a decimal string, e.g. "1499.00". */
  amount: string;
  currency: string;
  status: string;
  method: string | null;
  invoiceId: string | null;
  error: string | null;
}

export interface PaymentWebhookEvent {
  eventId: string;
  type: string;
  occurredAt: Date;
  subscription: ProviderSubscriptionState | null;
  payment: ProviderPayment | null;
  raw: unknown;
}

/** Implemented by Razorpay (now) and Stripe (later). Webhooks are the source of truth for subscription state. */
export interface PaymentProvider {
  readonly id: 'razorpay' | 'stripe';
  /** False when credentials are missing: every mutating call throws BILLING_NOT_CONFIGURED. */
  readonly configured: boolean;
  /** Public key the browser checkout needs (never a secret). */
  readonly publicKey: string | null;
  createCustomer(input: { organizationId: string; name: string; email: string }): Promise<{ customerId: string }>;
  createSubscription(input: {
    organizationId: string;
    externalPlanId: string;
    interval: BillingInterval;
    customerId: string;
  }): Promise<{ subscriptionId: string; shortUrl: string | null }>;
  changePlan(input: { subscriptionId: string; externalPlanId: string; when: 'now' | 'cycle_end' }): Promise<void>;
  cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  /** Verifies the signature and parses the event. Throws InvalidWebhookSignatureError on mismatch. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined, eventIdHeader: string | undefined): PaymentWebhookEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super('Invalid webhook signature');
    this.name = 'InvalidWebhookSignatureError';
  }
}
