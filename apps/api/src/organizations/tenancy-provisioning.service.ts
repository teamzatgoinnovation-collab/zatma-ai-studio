import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';

/** Creates the default records every new organization needs. Idempotent. */
@Injectable()
export class TenancyProvisioningService {
  private readonly logger = new Logger(TenancyProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async provisionOrganization(organizationId: string, userId: string): Promise<void> {
    const db = this.prisma.system;
    await db.$transaction(async (tx) => {
      const freePlan = await tx.plan.findUnique({ where: { code: 'FREE' } });
      if (!freePlan) throw new Error('FREE plan missing: run `pnpm db:seed`');

      await tx.subscription.upsert({
        where: { organizationId },
        update: {},
        create: { organizationId, planId: freePlan.id, status: 'ACTIVE', interval: 'MONTHLY' },
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
