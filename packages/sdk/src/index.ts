import type {
  AIProviderInfo,
  AISettings,
  AIUsageSummary,
  GenerationJobSummary,
  TextGenerationResponse,
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
  BrandKitDto,
  BrandKitInput,
  CreateDesignInput,
  DesignDetail,
  DesignSummary,
  DesignVersionSummary,
  GenerateDesignInput,
  SaveTemplateInput,
  TemplateSummary,
  UpdateBrandKitInput,
  UpdateDesignInput,
  AISettingsInput,
  ChangePlanInput,
  CreateGenerationJobInput,
  GenerateTextInput,
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

  const id = (v: string) => encodeURIComponent(v);
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
    brandKits: {
      list: () => request<BrandKitDto[]>('GET', '/brand-kits'),
      create: (input: BrandKitInput) => request<BrandKitDto>('POST', '/brand-kits', input),
      update: (kitId: string, input: UpdateBrandKitInput) => request<BrandKitDto>('PATCH', `/brand-kits/${id(kitId)}`, input),
      setDefault: (kitId: string) => request<BrandKitDto>('POST', `/brand-kits/${id(kitId)}/default`),
      remove: (kitId: string) => request<void>('DELETE', `/brand-kits/${id(kitId)}`),
    },
    designs: {
      list: (query?: { page?: number; pageSize?: number; q?: string; workspaceId?: string }) => request<Paginated<DesignSummary>>('GET', '/designs', undefined, query),
      get: (designId: string) => request<DesignDetail>('GET', `/designs/${id(designId)}`),
      create: (input: Partial<CreateDesignInput>) => request<DesignDetail>('POST', '/designs', input),
      generate: (input: Partial<GenerateDesignInput> & Pick<GenerateDesignInput, 'prompt'>) => request<{ design: DesignDetail; jobId: string }>('POST', '/designs/generate', input),
      update: (designId: string, input: UpdateDesignInput) => request<DesignDetail>('PATCH', `/designs/${id(designId)}`, input),
      duplicate: (designId: string) => request<DesignDetail>('POST', `/designs/${id(designId)}/duplicate`),
      remove: (designId: string) => request<void>('DELETE', `/designs/${id(designId)}`),
      setThumbnail: (designId: string, fileId: string) => request<void>('PUT', `/designs/${id(designId)}/thumbnail`, { fileId }),
      versions: (designId: string) => request<DesignVersionSummary[]>('GET', `/designs/${id(designId)}/versions`),
      saveVersion: (designId: string, note?: string) => request<DesignVersionSummary>('POST', `/designs/${id(designId)}/versions`, { note }),
      restoreVersion: (designId: string, versionId: string) => request<DesignDetail>('POST', `/designs/${id(designId)}/versions/${id(versionId)}/restore`),
      saveAsTemplate: (designId: string, input: SaveTemplateInput) => request<TemplateSummary>('POST', `/designs/${id(designId)}/save-as-template`, input),
    },
    templates: {
      list: () => request<TemplateSummary[]>('GET', '/templates'),
      remove: (templateId: string) => request<void>('DELETE', `/templates/${id(templateId)}`),
    },
    ai: {
      providers: () => request<AIProviderInfo[]>('GET', '/ai/providers'),
      settings: () => request<AISettings>('GET', '/ai/settings'),
      updateSettings: (input: AISettingsInput) => request<AISettings>('PATCH', '/ai/settings', input),
      generateText: (input: Partial<GenerateTextInput> & Pick<GenerateTextInput, 'prompt'>) => request<TextGenerationResponse>('POST', '/ai/text', input),
      createJob: (input: CreateGenerationJobInput) => request<GenerationJobSummary>('POST', '/ai/jobs', input),
      job: (id: string) => request<GenerationJobSummary>('GET', `/ai/jobs/${encodeURIComponent(id)}`),
      jobs: (query?: { page?: number; pageSize?: number }) => request<Paginated<GenerationJobSummary>>('GET', '/ai/jobs', undefined, query),
      usage: () => request<AIUsageSummary>('GET', '/ai/usage'),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
