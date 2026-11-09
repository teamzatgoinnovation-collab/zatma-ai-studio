import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, mergeMap, type Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../common/request.js';
import { AUDIT_ACTION, type AuditSpec } from './audit.decorator.js';
import { AuditService } from './audit.service.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<AuditSpec | undefined>(AUDIT_ACTION, context.getHandler());
    if (!spec) return next.handle();
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return next.handle().pipe(
      mergeMap((body: unknown) => {
        const fromResponse = (body as { id?: unknown } | null)?.id;
        const resourceId =
          spec.idFrom === 'response'
            ? typeof fromResponse === 'string'
              ? fromResponse
              : null
            : ((req.params as Record<string, string | undefined>).id ?? null);
        const changedFields = req.body && typeof req.body === 'object' ? Object.keys(req.body as object) : [];
        return from(
          this.audit.record(spec.action, spec.resourceType, resourceId, { method: req.method, changedFields }).then(() => body),
        );
      }),
    );
  }
}
