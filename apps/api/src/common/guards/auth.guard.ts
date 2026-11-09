import { HttpStatus, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { fromAuthRole, hasPermissions, permissionsForRole, type Permission } from '@zatma/types';
import { AUTH } from '../../auth/auth.module.js';
import type { Auth } from '../../auth/auth.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IS_PUBLIC, REQUIRED_PERMISSIONS, SESSION_ONLY } from '../decorators/auth.decorators.js';
import { AppException } from '../errors.js';
import type { AuthenticatedRequest } from '../request.js';
import { TenantContext } from '../tenant-context.js';

/**
 * Global guard: authentication → organization membership → permissions.
 * Deny by default: a route must be @Public(), @SessionOnly() or declare @RequirePermissions().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!result) throw new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue');

    const activeOrganizationId = (result.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
    req.auth = {
      userId: result.user.id,
      sessionId: result.session.id,
      email: result.user.email,
      name: result.user.name,
      activeOrganizationId,
    };
    TenantContext.set({ userId: result.user.id });

    if (this.reflector.getAllAndOverride<boolean>(SESSION_ONLY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (!required?.length) {
      throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This endpoint has no access policy');
    }

    if (!activeOrganizationId) {
      throw new AppException(HttpStatus.FORBIDDEN, 'NO_ACTIVE_ORGANIZATION', 'Select or create an organization first');
    }

    const member = await this.prisma.system.member.findUnique({
      where: { organizationId_userId: { organizationId: activeOrganizationId, userId: result.user.id } },
      select: { role: true },
    });
    if (!member) {
      throw new AppException(HttpStatus.FORBIDDEN, 'NOT_A_MEMBER', 'You are not a member of the active organization');
    }

    const role = fromAuthRole(member.role);
    const permissions = permissionsForRole(role);
    if (!role || !hasPermissions(role, required)) {
      throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have permission to perform this action', { required });
    }

    req.auth = { ...req.auth, organizationId: activeOrganizationId, role, permissions };
    TenantContext.set({ organizationId: activeOrganizationId, role, permissions });
    return true;
  }
}
