import { HttpStatus, Injectable } from '@nestjs/common';
import type { CurrentOrganization, InvitationSummary, OrganizationMember, OrgRole, Permission, PublicInvitation } from '@zatma/types';
import { fromAuthRole } from '@zatma/types';
import type { UpdateOrganizationInput } from '@zatma/validation';
import { AppException, notFound } from '../common/errors.js';
import { StorageService } from '../storage/storage.service.js';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPlanSummary } from '../billing/plan.mapper.js';

/**
 * Organization rows are the tenant root, so they are read with the system client but ALWAYS
 * keyed by the organizationId from TenantContext (never from client input).
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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
      logoUrl: await this.logoUrl(org.logo),
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

  /** `organization.logo` holds a StoredFile id; resolve it to a short-lived signed URL. */
  private async logoUrl(fileId: string | null): Promise<string | null> {
    if (!fileId) return null;
    const file = await this.prisma.system.storedFile.findUnique({ where: { id: fileId } });
    return file && file.status === 'UPLOADED' ? this.storage.signedUrlForKey(file.key) : null;
  }

  async setLogo(fileId: string | null): Promise<CurrentOrganization> {
    const organizationId = TenantContext.requireOrganizationId();
    if (fileId) {
      const file = await this.storage.getUploaded(fileId); // tenant-scoped: other orgs' files → 404
      if (file.purpose !== 'LOGO' || !file.mimeType.startsWith('image/')) {
        throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_LOGO', 'Upload an image with purpose LOGO');
      }
    }
    await this.prisma.system.organization.update({ where: { id: organizationId }, data: { logo: fileId } });
    return this.current();
  }

  async invitations(): Promise<InvitationSummary[]> {
    const organizationId = TenantContext.requireOrganizationId();
    const rows = await this.prisma.system.invitation.findMany({
      where: { organizationId, status: 'pending', expiresAt: { gt: new Date() } },
      include: { inviter: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: fromAuthRole(i.role),
      status: i.status,
      expiresAt: i.expiresAt.toISOString(),
      inviterName: i.inviter?.name ?? null,
    }));
  }

  /** Minimal, non-sensitive invitation details for the accept page (the id is an unguessable UUID). */
  async publicInvitation(id: string): Promise<PublicInvitation> {
    const inv = await this.prisma.system.invitation.findUnique({
      where: { id },
      include: { organization: { select: { name: true } }, inviter: { select: { name: true } } },
    });
    if (!inv) throw notFound('Invitation');
    const expired = inv.status === 'pending' && inv.expiresAt <= new Date();
    return {
      id: inv.id,
      email: inv.email,
      role: fromAuthRole(inv.role),
      status: expired ? 'expired' : inv.status,
      expiresAt: inv.expiresAt.toISOString(),
      organizationName: inv.organization.name,
      inviterName: inv.inviter?.name ?? null,
    };
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
