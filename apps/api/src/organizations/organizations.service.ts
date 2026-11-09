import { Injectable } from '@nestjs/common';
import type { CurrentOrganization, OrganizationMember, OrgRole, Permission } from '@zatma/types';
import { fromAuthRole } from '@zatma/types';
import type { UpdateOrganizationInput } from '@zatma/validation';
import { notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPlanSummary } from '../billing/plan.mapper.js';

/**
 * Organization rows are the tenant root, so they are read with the system client but ALWAYS
 * keyed by the organizationId from TenantContext (never from client input).
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<CurrentOrganization> {
    const ctx = TenantContext.get();
    const organizationId = TenantContext.requireOrganizationId();
    const org = await this.prisma.system.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!org) throw notFound('Organization');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      website: org.website,
      industry: org.industry,
      timezone: org.timezone,
      defaultLanguage: org.defaultLanguage,
      currency: org.currency,
      createdAt: org.createdAt.toISOString(),
      role: ctx?.role as OrgRole,
      permissions: [...((ctx?.permissions ?? []) as Permission[])],
      subscription: org.subscription ? { status: org.subscription.status, plan: toPlanSummary(org.subscription.plan) } : null,
    };
  }

  async update(input: UpdateOrganizationInput): Promise<CurrentOrganization> {
    const organizationId = TenantContext.requireOrganizationId();
    await this.prisma.system.organization.update({ where: { id: organizationId }, data: input });
    return this.current();
  }

  async members(): Promise<OrganizationMember[]> {
    const organizationId = TenantContext.requireOrganizationId();
    const members = await this.prisma.system.member.findMany({
      where: { organizationId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: fromAuthRole(m.role),
      joinedAt: m.createdAt.toISOString(),
    }));
  }
}
