import { HttpStatus, Injectable } from '@nestjs/common';
import type { PlanLimits, UsageMetric, UsageSummary } from '@zatma/types';
import { monthWindow } from '@zatma/validation';
import { AppException } from '../common/errors.js';
import type { Plan, Subscription } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const UNLIMITED = -1;

/** Statuses in which the subscribed plan's limits apply; anything else falls back to FREE. */
const ENTITLED = new Set(['TRIALING', 'ACTIVE', 'PAST_DUE']);

/**
 * Computes plan entitlements and current usage per organization.
 * Takes organizationId explicitly so it can be used from Better Auth hooks and jobs (no request context).
 */
@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** The plan whose limits currently apply to the organization. */
  async effectivePlan(organizationId: string): Promise<{ plan: Plan; subscription: (Subscription & { plan: Plan }) | null }> {
    const subscription = await this.prisma.system.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
    if (subscription && ENTITLED.has(subscription.status)) return { plan: subscription.plan, subscription };
    const free = await this.prisma.system.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    return { plan: free, subscription };
  }

  async limits(organizationId: string): Promise<PlanLimits> {
    return (await this.effectivePlan(organizationId)).plan.limits as unknown as PlanLimits;
  }

  async usage(organizationId: string): Promise<Record<UsageMetric, number>> {
    const db = this.prisma.system;
    const { subscription } = await this.effectivePlan(organizationId);
    const periodStart = subscription?.currentPeriodStart ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const month = monthWindow(new Date());
    const inMonth = { gte: month.start, lt: month.end };
    const [members, pendingInvitations, workspaces, storage, credits, leads, contacts, socialAccounts, posts] = await Promise.all([
      db.member.count({ where: { organizationId } }),
      db.invitation.count({ where: { organizationId, status: 'pending', expiresAt: { gt: new Date() } } }),
      db.workspace.count({ where: { organizationId } }),
      db.storedFile.aggregate({ where: { organizationId, status: 'UPLOADED' }, _sum: { sizeBytes: true } }),
      db.aiUsage.aggregate({ where: { organizationId, createdAt: { gte: periodStart } }, _sum: { credits: true } }),
      db.lead.count({ where: { organizationId, deletedAt: null } }),
      db.contact.count({ where: { organizationId, deletedAt: null } }),
      db.socialAccount.count({ where: { organizationId, status: { not: 'DISCONNECTED' } } }),
      // One "post" per account: published this month, or scheduled/publishing for this month.
      db.socialPostTarget.count({
        where: {
          organizationId,
          OR: [
            { status: 'PUBLISHED', publishedAt: inMonth },
            { status: { in: ['PENDING', 'PUBLISHING'] }, post: { status: { in: ['SCHEDULED', 'PUBLISHING'] }, deletedAt: null, scheduledAt: inMonth } },
          ],
        },
      }),
    ]);
    return {
      members: members + pendingInvitations,
      workspaces,
      storageMb: Math.ceil((storage._sum.sizeBytes ?? 0) / (1024 * 1024)),
      aiCredits: credits._sum.credits ?? 0,
      socialAccounts,
      crmRecords: leads + contacts,
      postsPerMonth: posts,
    };
  }

  async summary(organizationId: string): Promise<UsageSummary> {
    const [limits, used] = await Promise.all([this.limits(organizationId), this.usage(organizationId)]);
    const metrics = (Object.keys(used) as UsageMetric[]).map((metric) => ({ metric, used: used[metric], limit: limits[metric] ?? 0 }));
    return { metrics };
  }

  /** Throws 402-style PLAN_LIMIT_REACHED when adding `increment` would exceed the plan limit. */
  async assertWithinLimit(organizationId: string, metric: UsageMetric, increment = 1): Promise<void> {
    const [limits, used] = await Promise.all([this.limits(organizationId), this.usage(organizationId)]);
    const limit = limits[metric];
    if (limit === undefined || limit === UNLIMITED) return;
    if (used[metric] + increment > limit) {
      throw new AppException(HttpStatus.PAYMENT_REQUIRED, 'PLAN_LIMIT_REACHED', `Your plan allows ${limit} ${METRIC_LABELS[metric]}. Upgrade to add more.`, {
        metric,
        limit,
        used: used[metric],
      });
    }
  }

  /** Metrics where current usage exceeds `limits` (used to block downgrades). */
  exceeded(used: Record<UsageMetric, number>, limits: PlanLimits): Array<{ metric: UsageMetric; used: number; limit: number }> {
    return (Object.keys(used) as UsageMetric[])
      .filter((m) => m !== 'aiCredits' && m !== 'postsPerMonth')
      .map((metric) => ({ metric, used: used[metric], limit: limits[metric] }))
      .filter((x) => x.limit !== UNLIMITED && x.used > x.limit);
  }
}

export const METRIC_LABELS: Record<UsageMetric, string> = {
  members: 'team members',
  workspaces: 'workspaces',
  storageMb: 'MB of storage',
  aiCredits: 'AI credits',
  socialAccounts: 'social accounts',
  crmRecords: 'CRM contacts and leads',
  postsPerMonth: 'social posts per month',
};
