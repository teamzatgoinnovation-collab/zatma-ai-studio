import { Injectable } from '@nestjs/common';
import { fromAuthRole, type CurrentUser } from '@zatma/types';
import type { UpdateProfileInput } from '@zatma/validation';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(userId: string, activeOrganizationId: string | null): Promise<CurrentUser> {
    const user = await this.prisma.system.user.findUnique({
      where: { id: userId },
      include: { members: { include: { organization: { select: { id: true, name: true, slug: true } } }, orderBy: { createdAt: 'asc' } } },
    });
    if (!user) throw notFound('User');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      locale: user.locale,
      timezone: user.timezone,
      activeOrganizationId,
      memberships: user.members.map((m) => ({
        organizationId: m.organization.id,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        role: fromAuthRole(m.role),
      })),
    };
  }

  async update(userId: string, activeOrganizationId: string | null, input: UpdateProfileInput): Promise<CurrentUser> {
    await this.prisma.system.user.update({ where: { id: userId }, data: input });
    return this.getCurrent(userId, activeOrganizationId);
  }
}
