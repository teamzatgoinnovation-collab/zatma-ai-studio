import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { CheckoutSession, InvoiceSummary, Paginated, PlanLimits, PlanSummary, SubscriptionDetail, UsageSummary } from '@zatma/types';
import type { PaginationInput } from '@zatma/validation';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AppException } from '../common/errors.js';
import { paginate, toSkipTake } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import { EmailService } from '../email/email.service.js';
import { emailTemplates } from '../email/templates.js';
import { Prisma, type BillingInterval, type Plan, type PlanCode } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvalidWebhookSignatureError, PAYMENT_PROVIDER, type PaymentProvider, type PaymentWebhookEvent } from './payment-provider.interface.js';
import { toPlanSummary } from './plan.mapper.js';
import { UsageService } from './usage.service.js';

const PAID_SELF_SERVE: PlanCode[] = ['STARTER', 'PROFESSIONAL', 'BUSINESS'];
const OWNER_ROLE = 'organization_owner';
const DAY = 24 * 3600 * 1000;

const priceOf = (plan: Plan, interval: BillingInterval) => Number((interval === 'YEARLY' ? plan.priceYearly : plan.priceMonthly) ?? 0);
const externalPlanId = (plan: Plan, interval: BillingInterval) => (interval === 'YEARLY' ? plan.razorpayPlanIdYearly : plan.razorpayPlanIdMonthly);

export interface WebhookResult {
  received: true;
  duplicate: boolean;
  type: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly email: EmailService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────────────────────── Reads ─────────────────────────────

  async plans(): Promise<PlanSummary[]> {
    const plans = await this.prisma.system.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: 'asc' } });
    return plans.map(toPlanSummary);
  }

  async subscription(): Promise<SubscriptionDetail | null> {
    const organizationId = TenantContext.requireOrganizationId();
    const sub = await this.prisma.system.subscription.findUnique({ where: { organizationId }, include: { plan: true, pendingPlan: true } });
    if (!sub) return null;
    const { plan: effective } = await this.usage.effectivePlan(organizationId);
    return {
      status: sub.status,
      interval: sub.interval,
      plan: toPlanSummary(sub.plan),
      effectivePlan: toPlanSummary(effective),
      pendingPlan: sub.pendingPlan ? toPlanSummary(sub.pendingPlan) : null,
      provider: sub.provider,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      graceUntil: sub.graceUntil?.toISOString() ?? null,
      billingEnabled: this.provider.configured,
    };
  }

  usageSummary(): Promise<UsageSummary> {
    return this.usage.summary(TenantContext.requireOrganizationId());
  }

  async invoices(pagination: PaginationInput): Promise<Paginated<InvoiceSummary>> {
    const [rows, total] = await Promise.all([
      this.prisma.tenant.invoice.findMany({ orderBy: { issuedAt: 'desc' }, ...toSkipTake(pagination) }),
      this.prisma.tenant.invoice.count(),
    ]);
    return paginate(
      rows.map((i) => ({
        id: i.id,
        number: i.number,
        amount: i.amount.toFixed(2),
        currency: i.currency,
        status: i.status,
        periodStart: i.periodStart?.toISOString() ?? null,
        periodEnd: i.periodEnd?.toISOString() ?? null,
        invoiceUrl: i.invoiceUrl,
        issuedAt: i.issuedAt.toISOString(),
      })),
      total,
      pagination,
    );
  }

  // ───────────────────────────── Mutations ─────────────────────────────

  private async loadPlan(code: PlanCode): Promise<Plan> {
    const plan = await this.prisma.system.plan.findUnique({ where: { code } });
    if (!plan) throw new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Plan not found');
    return plan;
  }

  private async currentSubscription(organizationId: string) {
    const sub = await this.prisma.system.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
    if (!sub) throw new AppException(HttpStatus.CONFLICT, 'NO_SUBSCRIPTION', 'This organization has no subscription record');
    return sub;
  }

  private hasLivePaidSubscription(sub: { externalId: string | null; status: string; provider: string | null }) {
    return Boolean(sub.externalId && sub.provider && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE'));
  }

  private async assertFitsPlan(organizationId: string, target: Plan) {
    const exceeded = this.usage.exceeded(await this.usage.usage(organizationId), target.limits as unknown as PlanLimits);
    if (exceeded.length) {
      throw new AppException(HttpStatus.CONFLICT, 'PLAN_LIMIT_EXCEEDED', `Your current usage exceeds the ${target.name} plan's limits.`, { exceeded });
    }
  }

  /** Starts a provider subscription; the plan switches only when the provider confirms activation (webhook). */
  async checkout(code: PlanCode, interval: BillingInterval): Promise<CheckoutSession> {
    const ctx = TenantContext.get();
    const organizationId = TenantContext.requireOrganizationId();
    if (!PAID_SELF_SERVE.includes(code)) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'PLAN_NOT_PURCHASABLE', 'This plan cannot be purchased online. Contact sales for Agency.');
    }
    if (!this.provider.configured || !this.provider.publicKey) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'BILLING_NOT_CONFIGURED', 'Online payments are not enabled yet. Please contact support.');
    }
    const plan = await this.loadPlan(code);
    const providerPlanId = externalPlanId(plan, interval);
    if (!providerPlanId) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'PLAN_NOT_CONFIGURED', `The ${plan.name} ${interval.toLowerCase()} plan is not set up for payments yet.`);
    }
    const sub = await this.currentSubscription(organizationId);
    if (this.hasLivePaidSubscription(sub)) {
      throw new AppException(HttpStatus.CONFLICT, 'SUBSCRIPTION_EXISTS', 'You already have a paid subscription. Change plan instead.');
    }
    await this.assertFitsPlan(organizationId, plan);

    const [org, user] = await Promise.all([
      this.prisma.system.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      this.prisma.system.user.findUniqueOrThrow({ where: { id: ctx?.userId ?? '' } }),
    ]);
    const customerId = sub.providerCustomerId ?? (await this.provider.createCustomer({ organizationId, name: org.name, email: user.email })).customerId;
    const created = await this.provider.createSubscription({ organizationId, externalPlanId: providerPlanId, interval, customerId });

    await this.prisma.system.subscription.update({
      where: { organizationId },
      data: { provider: this.provider.id, providerCustomerId: customerId, externalId: created.subscriptionId },
    });

    return {
      provider: 'razorpay',
      keyId: this.provider.publicKey,
      subscriptionId: created.subscriptionId,
      plan: toPlanSummary(plan),
      interval,
      prefill: { name: user.name, email: user.email },
    };
  }

  /**
   * Upgrades apply immediately (prorated by the provider); downgrades apply at period end.
   * Downgrades are refused while usage exceeds the target plan's limits.
   */
  async changePlan(code: PlanCode, interval: BillingInterval): Promise<SubscriptionDetail | null> {
    const organizationId = TenantContext.requireOrganizationId();
    const sub = await this.currentSubscription(organizationId);
    const target = await this.loadPlan(code);
    if (code === 'AGENCY') throw new AppException(HttpStatus.BAD_REQUEST, 'PLAN_NOT_PURCHASABLE', 'Contact sales for the Agency plan.');
    await this.assertFitsPlan(organizationId, target);

    if (!this.hasLivePaidSubscription(sub)) {
      if (code !== 'FREE') {
        throw new AppException(HttpStatus.CONFLICT, 'CHECKOUT_REQUIRED', 'Start a paid subscription through checkout first.');
      }
      // Leaving a trial (or an expired plan) for Free takes effect immediately.
      await this.prisma.system.subscription.update({
        where: { organizationId },
        data: { planId: target.id, status: 'ACTIVE', interval: 'MONTHLY', trialEndsAt: null, currentPeriodEnd: null, pendingPlanId: null, pendingInterval: null },
      });
      return this.subscription();
    }

    if (code === 'FREE') {
      // Paid → Free: cancel at period end; the cancellation webhook moves the org to Free.
      return this.cancel();
    }
    const providerPlanId = externalPlanId(target, interval);
    if (!providerPlanId) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'PLAN_NOT_CONFIGURED', `The ${target.name} ${interval.toLowerCase()} plan is not set up for payments yet.`);
    }
    const isUpgrade = priceOf(target, interval) > priceOf(sub.plan, sub.interval);
    await this.provider.changePlan({ subscriptionId: sub.externalId as string, externalPlanId: providerPlanId, when: isUpgrade ? 'now' : 'cycle_end' });
    await this.prisma.system.subscription.update({
      where: { organizationId },
      data: isUpgrade
        ? { planId: target.id, interval, pendingPlanId: null, pendingInterval: null, cancelAtPeriodEnd: false }
        : { pendingPlanId: target.id, pendingInterval: interval },
    });
    return this.subscription();
  }

  /** Cancels at the end of the current period (paid) or ends a trial immediately. */
  async cancel(): Promise<SubscriptionDetail | null> {
    const organizationId = TenantContext.requireOrganizationId();
    const sub = await this.currentSubscription(organizationId);
    if (this.hasLivePaidSubscription(sub)) {
      await this.provider.cancelSubscription(sub.externalId as string, true);
      await this.prisma.system.subscription.update({ where: { organizationId }, data: { cancelAtPeriodEnd: true, pendingPlanId: null, pendingInterval: null } });
    } else if (sub.status === 'TRIALING') {
      await this.moveToFree(organizationId);
    } else {
      throw new AppException(HttpStatus.CONFLICT, 'NOTHING_TO_CANCEL', 'There is no paid subscription or trial to cancel.');
    }
    return this.subscription();
  }

  private async moveToFree(organizationId: string) {
    const free = await this.loadPlan('FREE');
    await this.prisma.system.subscription.update({
      where: { organizationId },
      data: {
        planId: free.id,
        status: 'ACTIVE',
        interval: 'MONTHLY',
        provider: null,
        externalId: null,
        trialEndsAt: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        pendingPlanId: null,
        pendingInterval: null,
        graceUntil: null,
      },
    });
  }

  // ───────────────────────────── Webhooks ─────────────────────────────

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined): Promise<WebhookResult> {
    if (!rawBody) throw new AppException(HttpStatus.BAD_REQUEST, 'INVALID_WEBHOOK', 'Missing request body');
    let event: PaymentWebhookEvent;
    try {
      event = this.provider.verifyWebhook(rawBody, signature, eventIdHeader);
    } catch (err) {
      if (err instanceof InvalidWebhookSignatureError) {
        throw new AppException(HttpStatus.BAD_REQUEST, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
      }
      throw err;
    }

    const organizationId = await this.resolveOrganization(event);
    try {
      await this.prisma.system.billingEvent.create({
        data: { provider: this.provider.id, eventId: event.eventId, type: event.type, organizationId, payload: event.raw as Prisma.InputJsonValue },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.system.billingEvent.findUnique({ where: { provider_eventId: { provider: this.provider.id, eventId: event.eventId } } });
        if (existing?.processedAt) return { received: true, duplicate: true, type: event.type };
      } else {
        throw err;
      }
    }

    try {
      if (organizationId) await this.apply(organizationId, event);
      else this.logger.warn(`Webhook ${event.type} (${event.eventId}) does not match any organization`);
      await this.prisma.system.billingEvent.update({
        where: { provider_eventId: { provider: this.provider.id, eventId: event.eventId } },
        data: { processedAt: new Date(), error: null },
      });
    } catch (err) {
      await this.prisma.system.billingEvent.update({
        where: { provider_eventId: { provider: this.provider.id, eventId: event.eventId } },
        data: { error: (err as Error).message.slice(0, 1000) },
      });
      throw err; // non-2xx → provider retries
    }
    return { received: true, duplicate: false, type: event.type };
  }

  private async resolveOrganization(event: PaymentWebhookEvent): Promise<string | null> {
    if (event.subscription) {
      const sub = await this.prisma.system.subscription.findUnique({ where: { externalId: event.subscription.id }, select: { organizationId: true } });
      if (sub) return sub.organizationId;
      const fromNotes = event.subscription.notes.organizationId;
      if (fromNotes && (await this.prisma.system.organization.findUnique({ where: { id: fromNotes }, select: { id: true } }))) return fromNotes;
    }
    return null;
  }

  private async planForProviderPlanId(providerPlanId: string | null): Promise<{ plan: Plan; interval: BillingInterval } | null> {
    if (!providerPlanId) return null;
    const plan = await this.prisma.system.plan.findFirst({
      where: { OR: [{ razorpayPlanIdMonthly: providerPlanId }, { razorpayPlanIdYearly: providerPlanId }] },
    });
    if (!plan) return null;
    return { plan, interval: plan.razorpayPlanIdYearly === providerPlanId ? 'YEARLY' : 'MONTHLY' };
  }

  private async apply(organizationId: string, event: PaymentWebhookEvent): Promise<void> {
    const db = this.prisma.system;
    const s = event.subscription;

    switch (event.type) {
      case 'subscription.authenticated':
        return; // mandate set up; activation follows
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed':
      case 'subscription.updated': {
        if (!s) return;
        const mapped = await this.planForProviderPlanId(s.planId);
        const current = await db.subscription.findUniqueOrThrow({ where: { organizationId } });
        const reachedPending = mapped && current.pendingPlanId === mapped.plan.id;
        await db.subscription.update({
          where: { organizationId },
          data: {
            ...(mapped ? { planId: mapped.plan.id, interval: mapped.interval } : {}),
            status: 'ACTIVE',
            provider: this.provider.id,
            externalId: s.id,
            providerCustomerId: s.customerId ?? undefined,
            trialEndsAt: null,
            graceUntil: null,
            ...(s.currentStart ? { currentPeriodStart: s.currentStart } : {}),
            ...(s.currentEnd ? { currentPeriodEnd: s.currentEnd } : {}),
            ...(reachedPending ? { pendingPlanId: null, pendingInterval: null } : {}),
          },
        });
        if (event.type === 'subscription.charged' && event.payment) await this.recordPayment(organizationId, event, 'paid');
        return;
      }
      case 'subscription.pending':
      case 'subscription.halted': {
        const current = await db.subscription.findUniqueOrThrow({ where: { organizationId }, include: { plan: true } });
        await db.subscription.update({
          where: { organizationId },
          data: { status: 'PAST_DUE', graceUntil: current.graceUntil ?? new Date(Date.now() + this.env.BILLING_GRACE_DAYS * DAY) },
        });
        if (current.status !== 'PAST_DUE') await this.notifyOwners(organizationId, (org) => emailTemplates.paymentFailed({ organizationName: org, planName: current.plan.name, url: this.email.webUrl('/billing') }));
        return;
      }
      case 'payment.failed': {
        if (event.payment) await this.recordPayment(organizationId, event, 'failed');
        return;
      }
      case 'subscription.cancelled':
      case 'subscription.completed':
        await this.moveToFree(organizationId);
        return;
      default:
        this.logger.log(`Ignoring unhandled webhook type ${event.type}`);
    }
  }

  private async recordPayment(organizationId: string, event: PaymentWebhookEvent, outcome: 'paid' | 'failed') {
    const p = event.payment;
    if (!p) return;
    const db = this.prisma.system;
    const sub = await db.subscription.findUnique({ where: { organizationId } });
    let invoiceId: string | null = null;
    if (outcome === 'paid') {
      const invoice = await db.invoice.upsert({
        where: { externalId: p.invoiceId ?? p.id },
        update: { status: 'paid', amount: p.amount, currency: p.currency },
        create: {
          organizationId,
          subscriptionId: sub?.id ?? null,
          provider: this.provider.id,
          externalId: p.invoiceId ?? p.id,
          number: p.invoiceId,
          amount: p.amount,
          currency: p.currency,
          status: 'paid',
          periodStart: event.subscription?.currentStart ?? null,
          periodEnd: event.subscription?.currentEnd ?? null,
          issuedAt: event.occurredAt,
        },
      });
      invoiceId = invoice.id;
    }
    await db.payment.upsert({
      where: { externalId: p.id },
      update: { status: p.status, errorReason: p.error, invoiceId: invoiceId ?? undefined },
      create: {
        organizationId,
        invoiceId,
        provider: this.provider.id,
        externalId: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        method: p.method,
        errorReason: p.error,
      },
    });
  }

  // ───────────────────────────── Maintenance (scheduled) ─────────────────────────────

  /** Idempotent housekeeping: trial reminders, trial expiry, grace-period expiry. */
  async runMaintenance(now = new Date()): Promise<{ trialsExpired: number; remindersSent: number; graceExpired: number }> {
    const db = this.prisma.system;

    const reminders = await db.subscription.findMany({
      where: { status: 'TRIALING', trialReminderSentAt: null, trialEndsAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY) } },
      include: { plan: true },
    });
    for (const sub of reminders) {
      const daysLeft = Math.max(1, Math.ceil(((sub.trialEndsAt as Date).getTime() - now.getTime()) / DAY));
      await this.notifyOwners(sub.organizationId, (org) =>
        emailTemplates.trialEnding({ organizationName: org, planName: sub.plan.name, daysLeft, url: this.email.webUrl('/billing') }),
      );
      await db.subscription.update({ where: { id: sub.id }, data: { trialReminderSentAt: now } });
    }

    const expiredTrials = await db.subscription.findMany({ where: { status: 'TRIALING', trialEndsAt: { lte: now } }, select: { organizationId: true } });
    for (const { organizationId } of expiredTrials) await this.moveToFree(organizationId);

    const expiredGrace = await db.subscription.findMany({ where: { status: 'PAST_DUE', graceUntil: { lte: now } }, select: { organizationId: true } });
    for (const { organizationId } of expiredGrace) await this.moveToFree(organizationId);

    return { trialsExpired: expiredTrials.length, remindersSent: reminders.length, graceExpired: expiredGrace.length };
  }

  private async notifyOwners(organizationId: string, build: (orgName: string) => Omit<Parameters<EmailService['send']>[0], 'to'>) {
    const org = await this.prisma.system.organization.findUnique({
      where: { id: organizationId },
      include: { members: { where: { role: OWNER_ROLE }, include: { user: { select: { email: true } } } } },
    });
    if (!org) return;
    for (const m of org.members) await this.email.send({ to: m.user.email, organizationId, ...build(org.name) });
  }
}
