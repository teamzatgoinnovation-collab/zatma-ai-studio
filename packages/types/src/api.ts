import type { OrgRole } from './roles.js';
import type { Permission } from './permissions.js';

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details: unknown;
  path: string;
  timestamp: string;
  requestId?: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrgRole | null;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  locale: string;
  timezone: string;
  activeOrganizationId: string | null;
  memberships: MembershipSummary[];
}

export interface PlanLimits {
  aiCredits: number;
  storageMb: number;
  members: number;
  socialAccounts: number;
  workspaces: number;
}

export interface PlanSummary {
  code: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'BUSINESS' | 'AGENCY';
  name: string;
  priceMonthly: string | null;
  priceYearly: string | null;
  currency: string;
  limits: PlanLimits;
}

export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  website: string | null;
  industry: string | null;
  timezone: string;
  defaultLanguage: string;
  currency: string;
  createdAt: string;
  role: OrgRole;
  permissions: Permission[];
  subscription: { status: string; plan: PlanSummary } | null;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole | null;
  joinedAt: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorId: string | null;
  actorName: string | null;
  ip: string | null;
  createdAt: string;
}

export interface PresignedUpload {
  fileId: string;
  key: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export type AICapability = 'TEXT' | 'IMAGE' | 'VIDEO' | 'EMBEDDING';

export interface AIProviderInfo {
  id: string;
  name: string;
  capabilities: AICapability[];
  /** API key present in the server environment. */
  configured: boolean;
  /** Adapter implemented and registered (Phase 4). */
  implemented: boolean;
}
