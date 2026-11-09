import type { Request } from 'express';
import type { OrgRole, Permission } from '@zatma/types';

export interface RequestAuth {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  activeOrganizationId: string | null;
  /** Set only on organization-scoped routes. */
  organizationId?: string;
  role?: OrgRole;
  permissions?: readonly Permission[];
}

export interface AuthenticatedRequest extends Request {
  auth?: RequestAuth;
}
