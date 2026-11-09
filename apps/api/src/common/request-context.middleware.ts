import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './request.js';
import { TenantContext } from './tenant-context.js';

/** Wraps each request in a fresh TenantContext so guards can populate it safely. */
export function requestContextMiddleware(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  TenantContext.run(
    {
      requestId: typeof req.id === 'string' ? req.id : undefined,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    },
    () => next(),
  );
}
