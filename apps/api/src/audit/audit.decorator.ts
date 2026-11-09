import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION = 'zatma:audit';

export interface AuditSpec {
  action: string;
  resourceType: string;
  /** Where to read the resource id from: the route param `:id` (default) or the response body's `id`. */
  idFrom?: 'param' | 'response';
}

/** Records an audit log entry after the handler succeeds. */
export const Audit = (action: string, resourceType: string, idFrom: AuditSpec['idFrom'] = 'param') =>
  SetMetadata(AUDIT_ACTION, { action, resourceType, idFrom } satisfies AuditSpec);
