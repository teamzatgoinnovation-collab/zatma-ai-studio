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
  /** Signed URL for the organization logo (short-lived), if one is set. */
  logoUrl: string | null;
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
  /** Adapter registered and available for at least one capability. */
  implemented: boolean;
  /** Default models per capability, e.g. { TEXT: 'claude-opus-5-5' }. */
  models: Partial<Record<AICapability, string>>;
}

export type UsageMetric = keyof PlanLimits;

export interface UsageSummary {
  metrics: Array<{ metric: UsageMetric; used: number; limit: number }>;
}

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
export type BillingInterval = 'MONTHLY' | 'YEARLY';

export interface SubscriptionDetail {
  status: SubscriptionStatus;
  interval: BillingInterval;
  plan: PlanSummary;
  /** Plan whose limits currently apply (FREE when canceled/expired). */
  effectivePlan: PlanSummary;
  pendingPlan: PlanSummary | null;
  provider: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: string | null;
  billingEnabled: boolean;
}

export interface CheckoutSession {
  provider: 'razorpay';
  keyId: string;
  subscriptionId: string;
  plan: PlanSummary;
  interval: BillingInterval;
  prefill: { name: string; email: string };
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  amount: string;
  currency: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  invoiceUrl: string | null;
  issuedAt: string;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: OrgRole | null;
  status: string;
  expiresAt: string;
  inviterName: string | null;
}

export interface PublicInvitation {
  id: string;
  email: string;
  role: OrgRole | null;
  status: string;
  expiresAt: string;
  organizationName: string;
  inviterName: string | null;
}

export interface AuthProviders {
  emailPassword: true;
  google: boolean;
  requireEmailVerification: boolean;
}

export interface StoredFileSummary {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: string;
  status: string;
}

export interface AISettings {
  textProvider: string | null;
  imageProvider: string | null;
  /** Effective fallback order after applying the organization's preference. */
  textOrder: string[];
  imageOrder: string[];
}

export interface TextGenerationResponse {
  text: string;
  provider: string;
  model: string;
  credits: number;
  finishReason: 'stop' | 'length' | 'other';
  /** Providers that failed before this one succeeded (fallback). */
  fallbackFrom: string[];
}

export type GenerationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface GenerationJobSummary {
  id: string;
  type: AICapability;
  status: GenerationStatus;
  purpose: string;
  provider: string | null;
  model: string | null;
  credits: number;
  output: { text?: string; files?: Array<{ id: string; url: string; mimeType: string }> } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AIUsageSummary {
  periodStart: string;
  credits: { used: number; limit: number };
  byProvider: Array<{ provider: string; capability: AICapability; requests: number; failures: number; credits: number }>;
  recent: Array<{ id: string; provider: string; model: string; capability: AICapability; status: 'SUCCEEDED' | 'FAILED'; credits: number; purpose: string | null; errorKind: string | null; createdAt: string }>;
}
