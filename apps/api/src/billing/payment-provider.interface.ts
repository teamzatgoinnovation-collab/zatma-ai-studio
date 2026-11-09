import type { BillingInterval, PlanCode } from '../generated/prisma/client.js';

export interface ExternalCustomer {
  externalId: string;
}

export interface CheckoutSession {
  provider: 'razorpay' | 'stripe';
  externalSubscriptionId: string;
  /** Data the web app needs to open the provider's checkout (e.g. Razorpay key id + subscription id). */
  clientPayload: Record<string, string>;
}

export type PaymentWebhookEvent =
  | { type: 'subscription.activated' | 'subscription.charged' | 'subscription.cancelled' | 'subscription.halted'; externalSubscriptionId: string; occurredAt: Date }
  | { type: 'payment.failed'; externalSubscriptionId: string; reason: string; occurredAt: Date };

/** Implemented by Razorpay (Phase 2) and Stripe (later). Webhooks are the source of truth. */
export interface PaymentProvider {
  readonly id: 'razorpay' | 'stripe';
  createCustomer(input: { organizationId: string; name: string; email: string }): Promise<ExternalCustomer>;
  createSubscription(input: { organizationId: string; plan: PlanCode; interval: BillingInterval; customerId: string }): Promise<CheckoutSession>;
  cancelSubscription(externalSubscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  verifyWebhook(rawBody: Buffer, signature: string): PaymentWebhookEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
