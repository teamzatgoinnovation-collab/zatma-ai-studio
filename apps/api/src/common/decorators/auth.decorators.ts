import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@zatma/types';
import type { AuthenticatedRequest } from '../request.js';

export const IS_PUBLIC = 'zatma:isPublic';
export const SESSION_ONLY = 'zatma:sessionOnly';
export const REQUIRED_PERMISSIONS = 'zatma:permissions';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires a signed-in user but not an active organization (e.g. profile endpoints). */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

/** Requires an active organization membership granting every listed permission. */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.auth;
});
