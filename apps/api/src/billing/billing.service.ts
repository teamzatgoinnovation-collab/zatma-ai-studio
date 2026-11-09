import { Injectable } from '@nestjs/common';
import type { PlanSummary } from '@zatma/types';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPlanSummary } from './plan.mapper.js';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async plans(): Promise<PlanSummary[]> {
    const plans = await this.prisma.system.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: 'asc' } });
    return plans.map(toPlanSummary);
  }

  async subscription(): Promise<{ status: string; plan: PlanSummary } | null> {
    const organizationId = TenantContext.requireOrganizationId();
    const sub = await this.prisma.system.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
    return sub ? { status: sub.status, plan: toPlanSummary(sub.plan) } : null;
  }
}
