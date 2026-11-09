import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';

/** Creates the default records every new organization needs. Idempotent. */
@Injectable()
export class TenancyProvisioningService {
  private readonly logger = new Logger(TenancyProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async provisionOrganization(organizationId: string, userId: string): Promise<void> {
    const db = this.prisma.system;
    await db.$transaction(async (tx) => {
      const freePlan = await tx.plan.findUnique({ where: { code: 'FREE' } });
      if (!freePlan) throw new Error('FREE plan missing: run `pnpm db:seed`');
      const trialPlan =
        this.env.TRIAL_PLAN !== 'NONE' && this.env.TRIAL_DAYS > 0 ? await tx.plan.findUnique({ where: { code: this.env.TRIAL_PLAN } }) : null;
      const trialEndsAt = trialPlan ? new Date(Date.now() + this.env.TRIAL_DAYS * 24 * 3600 * 1000) : null;

      await tx.subscription.upsert({
        where: { organizationId },
        update: {},
        create: trialPlan
          ? { organizationId, planId: trialPlan.id, status: 'TRIALING', interval: 'MONTHLY', trialEndsAt, currentPeriodEnd: trialEndsAt }
          : { organizationId, planId: freePlan.id, status: 'ACTIVE', interval: 'MONTHLY' },
      });

      const hasDefault = await tx.workspace.findFirst({ where: { organizationId, isDefault: true } });
      if (!hasDefault) {
        await tx.workspace.create({
          data: { organizationId, name: 'Main workspace', description: 'Default workspace', isDefault: true },
        });
      }

      await tx.auditLog.create({
        data: { organizationId, actorId: userId, action: 'organization.created', resourceType: 'organization', resourceId: organizationId },
      });
    });
    this.logger.log(`Provisioned organization ${organizationId}`);
    await this.notifications
      .enqueue({ type: 'organization.welcome', organizationId, userId, payload: {} })
      .catch((err: Error) => this.logger.warn(`Could not enqueue welcome notification: ${err.message}`));
  }
}
