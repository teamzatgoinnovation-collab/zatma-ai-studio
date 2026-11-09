import type {
  AIProviderInfo,
  AuthProviders,
  CheckoutSession,
  InvitationSummary,
  InvoiceSummary,
  PublicInvitation,
  StoredFileSummary,
  SubscriptionDetail,
  UsageSummary,
  ApiErrorBody,
  AuditLogEntry,
  CurrentOrganization,
  CurrentUser,
  HealthStatus,
  OrganizationMember,
  Paginated,
  PlanSummary,
  PresignedUpload,
  Workspace,
} from '@zatma/types';
import type {
  ChangePlanInput,
  CheckoutInput,
  CreateWorkspaceInput,
  PresignUploadInput,
  UpdateOrganizationInput,
  UpdateProfileInput,
  UpdateWorkspaceInput,
} from '@zatma/validation';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(body: Partial<ApiErrorBody> & { statusCode: number }) {
    super(body.message ?? `Request failed with status ${body.statusCode}`);
    this.name = 'ApiError';
    this.status = body.statusCode;
    this.code = body.code ?? 'UNKNOWN_ERROR';
    this.details = body.details ?? null;
  }
}

export interface ApiClientOptions {
  /** Base URL of the API *including* `/api/v1`, e.g. `/api/v1` (same-origin) or `http://localhost:4000/api/v1`. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Extra headers (e.g. forwarded cookies when called from a Next.js server component). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
}

type Query = Record<string, string | number | undefined>;

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl.replace(/\/$/, '');

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const qs = query
      ? '?' +
        new URLSearchParams(
          Object.entries(query)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    const extra = options.headers ? await options.headers() : {};
    const res = await doFetch(`${base}${path}${qs}`, {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new ApiError({ statusCode: res.status, ...(json && typeof json === 'object' ? json : {}) });
    }
    return json as T;
  }

  return {
    health: () => request<HealthStatus>('GET', '/health'),
    auth: {
      providers: () => request<AuthProviders>('GET', '/auth/providers'),
    },
    users: {
      me: () => request<CurrentUser>('GET', '/users/me'),
      updateMe: (input: UpdateProfileInput) => request<CurrentUser>('PATCH', '/users/me', input),
      deletionEligibility: () =>
        request<{ canDelete: boolean; blockingOrganizations: Array<{ id: string; name: string }> }>('GET', '/users/me/deletion-eligibility'),
    },
    organizations: {
      current: () => request<CurrentOrganization>('GET', '/organizations/current'),
      update: (input: UpdateOrganizationInput) => request<CurrentOrganization>('PATCH', '/organizations/current', input),
      members: () => request<OrganizationMember[]>('GET', '/organizations/current/members'),
      invitations: () => request<InvitationSummary[]>('GET', '/organizations/current/invitations'),
      publicInvitation: (id: string) => request<PublicInvitation>('GET', `/organizations/invitations/${encodeURIComponent(id)}`),
      setLogo: (fileId: string) => request<CurrentOrganization>('PUT', '/organizations/current/logo', { fileId }),
      removeLogo: () => request<CurrentOrganization>('DELETE', '/organizations/current/logo'),
    },
    workspaces: {
      list: (query?: { page?: number; pageSize?: number }) => request<Paginated<Workspace>>('GET', '/workspaces', undefined, query),
      get: (id: string) => request<Workspace>('GET', `/workspaces/${encodeURIComponent(id)}`),
      create: (input: CreateWorkspaceInput) => request<Workspace>('POST', '/workspaces', input),
      update: (id: string, input: UpdateWorkspaceInput) => request<Workspace>('PATCH', `/workspaces/${encodeURIComponent(id)}`, input),
      remove: (id: string) => request<void>('DELETE', `/workspaces/${encodeURIComponent(id)}`),
    },
    auditLogs: {
      list: (query?: { page?: number; pageSize?: number }) => request<Paginated<AuditLogEntry>>('GET', '/audit-logs', undefined, query),
    },
    storage: {
      presignUpload: (input: PresignUploadInput) => request<PresignedUpload>('POST', '/storage/uploads', input),
      completeUpload: (fileId: string) => request<StoredFileSummary>('POST', `/storage/uploads/${encodeURIComponent(fileId)}/complete`),
      fileUrl: (fileId: string) => request<{ url: string; expiresInSeconds: number }>('GET', `/files/${encodeURIComponent(fileId)}/url`),
    },
    billing: {
      plans: () => request<PlanSummary[]>('GET', '/billing/plans'),
      subscription: () => request<SubscriptionDetail | null>('GET', '/billing/subscription'),
      usage: () => request<UsageSummary>('GET', '/billing/usage'),
      invoices: (query?: { page?: number; pageSize?: number }) => request<Paginated<InvoiceSummary>>('GET', '/billing/invoices', undefined, query),
      checkout: (input: CheckoutInput) => request<CheckoutSession>('POST', '/billing/checkout', input),
      changePlan: (input: ChangePlanInput) => request<SubscriptionDetail | null>('POST', '/billing/change-plan', input),
      cancel: () => request<SubscriptionDetail | null>('POST', '/billing/cancel'),
    },
    ai: {
      providers: () => request<AIProviderInfo[]>('GET', '/ai/providers'),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
