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
  DraftMessageInput,
  DraftMessageResult,
  LeadInsights,
  LeadScoreDto,
  ScoringSettings,
  ScoringSettingsInput,
  ActivityDto,
  BoardDto,
  BulkLeadsInput,
  CompanyDto,
  ContactDto,
  ConvertLeadInput,
  CreateActivityRequest,
  CreateCompanyInput,
  CreateContactInput,
  CreateDealInput,
  CreateLeadInput,
  CreatePipelineInput,
  CrmSummary,
  DealDto,
  DuplicateMatch,
  FollowUpsQuery,
  ImportInput,
  ImportJobStatus,
  ImportPreview,
  LeadDto,
  MoveDealInput,
  PipelineDto,
  TimelineDto,
  UpdateActivityRequest,
  UpdateCompanyInput,
  UpdateContactInput,
  UpdateDealInput,
  UpdateLeadInput,
  CopyAssetDto,
  CopyGenerationResult,
  CopyRewriteResult,
  CopyTranslationResult,
  GenerateCopyInput,
  RewriteCopyInput,
  SaveCopyAssetInput,
  TranslateCopyInput,
  UpdateCopyAssetInput,
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
      translate: (designId: string, language: string) => request<DesignDetail>('POST', `/designs/${id(designId)}/translate`, { language }),
    },
    copy: {
      generate: (input: Partial<GenerateCopyInput> & Pick<GenerateCopyInput, 'kind' | 'brief'>) => request<CopyGenerationResult>('POST', '/copy/generate', input),
      translate: (input: Partial<TranslateCopyInput> & Pick<TranslateCopyInput, 'text' | 'targetLanguages'>) => request<CopyTranslationResult>('POST', '/copy/translate', input),
      rewrite: (input: Partial<RewriteCopyInput> & Pick<RewriteCopyInput, 'text' | 'action'>) => request<CopyRewriteResult>('POST', '/copy/rewrite', input),
    },
    crm: {
      summary: () => request<CrmSummary>('GET', '/crm/summary'),
      leads: {
        list: (query?: Query) => request<Paginated<LeadDto>>('GET', '/crm/leads', undefined, query),
        get: (leadId: string) => request<LeadDto>('GET', `/crm/leads/${id(leadId)}`),
        create: (input: Partial<CreateLeadInput> & Pick<CreateLeadInput, 'firstName'>) => request<LeadDto>('POST', '/crm/leads', input),
        update: (leadId: string, input: UpdateLeadInput) => request<LeadDto>('PATCH', `/crm/leads/${id(leadId)}`, input),
        remove: (leadId: string) => request<void>('DELETE', `/crm/leads/${id(leadId)}`),
        bulk: (input: BulkLeadsInput) => request<{ updated: number }>('POST', '/crm/leads/bulk', input),
        duplicates: (query: { email?: string; phone?: string; excludeLeadId?: string; excludeContactId?: string }) => request<DuplicateMatch[]>('GET', '/crm/leads/duplicates', undefined, query),
        convert: (leadId: string, input: Partial<ConvertLeadInput>) => request<{ lead: LeadDto; contact: ContactDto; deal: DealDto | null }>('POST', `/crm/leads/${id(leadId)}/convert`, input),
        timeline: (leadId: string) => request<TimelineDto>('GET', `/crm/leads/${id(leadId)}/timeline`),
        score: (leadId: string) => request<LeadScoreDto>('GET', `/crm/leads/${id(leadId)}/score`),
        insights: (leadId: string) => request<{ insights: LeadInsights | null }>('GET', `/crm/leads/${id(leadId)}/insights`),
        generateInsights: (leadId: string, language?: string) => request<LeadInsights>('POST', `/crm/leads/${id(leadId)}/insights`, language ? { language } : {}),
      },
      contacts: {
        list: (query?: Query) => request<Paginated<ContactDto>>('GET', '/crm/contacts', undefined, query),
        customers: (query?: Query) => request<Paginated<ContactDto>>('GET', '/crm/customers', undefined, query),
        get: (contactId: string) => request<ContactDto>('GET', `/crm/contacts/${id(contactId)}`),
        create: (input: Partial<CreateContactInput> & Pick<CreateContactInput, 'firstName'>) => request<ContactDto>('POST', '/crm/contacts', input),
        update: (contactId: string, input: UpdateContactInput) => request<ContactDto>('PATCH', `/crm/contacts/${id(contactId)}`, input),
        remove: (contactId: string) => request<void>('DELETE', `/crm/contacts/${id(contactId)}`),
        timeline: (contactId: string) => request<TimelineDto>('GET', `/crm/contacts/${id(contactId)}/timeline`),
        draftMessage: (contactId: string, input: Partial<DraftMessageInput>) => request<DraftMessageResult>('POST', `/crm/contacts/${id(contactId)}/draft-message`, input),
      },
      scoring: {
        settings: () => request<ScoringSettings>('GET', '/crm/scoring/settings'),
        updateSettings: (input: ScoringSettingsInput) => request<ScoringSettings>('PATCH', '/crm/scoring/settings', input),
        recalculate: () => request<{ queued: boolean }>('POST', '/crm/scoring/recalculate'),
      },
      companies: {
        list: (query?: Query) => request<Paginated<CompanyDto>>('GET', '/crm/companies', undefined, query),
        get: (companyId: string) => request<CompanyDto>('GET', `/crm/companies/${id(companyId)}`),
        create: (input: Partial<CreateCompanyInput> & Pick<CreateCompanyInput, 'name'>) => request<CompanyDto>('POST', '/crm/companies', input),
        update: (companyId: string, input: UpdateCompanyInput) => request<CompanyDto>('PATCH', `/crm/companies/${id(companyId)}`, input),
        remove: (companyId: string) => request<void>('DELETE', `/crm/companies/${id(companyId)}`),
        timeline: (companyId: string) => request<TimelineDto & { contacts: ContactDto[] }>('GET', `/crm/companies/${id(companyId)}/timeline`),
      },
      pipelines: {
        list: () => request<PipelineDto[]>('GET', '/crm/pipelines'),
        create: (input: CreatePipelineInput) => request<PipelineDto>('POST', '/crm/pipelines', input),
        board: (pipelineId: string, query?: { ownerId?: string; q?: string }) => request<BoardDto>('GET', `/crm/pipelines/${id(pipelineId)}/board`, undefined, query),
        addStage: (pipelineId: string, input: { name: string; probability: number; kind?: 'OPEN' | 'WON' | 'LOST' }) => request<PipelineDto>('POST', `/crm/pipelines/${id(pipelineId)}/stages`, input),
        updateStage: (pipelineId: string, stageId: string, input: { name?: string; probability?: number }) => request<PipelineDto>('PATCH', `/crm/pipelines/${id(pipelineId)}/stages/${id(stageId)}`, input),
        removeStage: (pipelineId: string, stageId: string, moveDealsTo?: string) => request<PipelineDto>('DELETE', `/crm/pipelines/${id(pipelineId)}/stages/${id(stageId)}`, undefined, moveDealsTo ? { moveDealsTo } : undefined),
      },
      deals: {
        list: (query?: Query) => request<Paginated<DealDto>>('GET', '/crm/deals', undefined, query),
        get: (dealId: string) => request<DealDto>('GET', `/crm/deals/${id(dealId)}`),
        create: (input: Partial<CreateDealInput> & Pick<CreateDealInput, 'name'>) => request<DealDto>('POST', '/crm/deals', input),
        update: (dealId: string, input: UpdateDealInput) => request<DealDto>('PATCH', `/crm/deals/${id(dealId)}`, input),
        move: (dealId: string, input: MoveDealInput) => request<DealDto>('POST', `/crm/deals/${id(dealId)}/move`, input),
        remove: (dealId: string) => request<void>('DELETE', `/crm/deals/${id(dealId)}`),
        timeline: (dealId: string) => request<TimelineDto>('GET', `/crm/deals/${id(dealId)}/timeline`),
      },
      activities: {
        list: (query?: Query) => request<Paginated<ActivityDto>>('GET', '/crm/activities', undefined, query),
        create: (input: CreateActivityRequest) => request<ActivityDto>('POST', '/crm/activities', input),
        update: (activityId: string, input: UpdateActivityRequest) => request<ActivityDto>('PATCH', `/crm/activities/${id(activityId)}`, input),
        remove: (activityId: string) => request<void>('DELETE', `/crm/activities/${id(activityId)}`),
        followUps: (query?: Partial<FollowUpsQuery>) => request<ActivityDto[]>('GET', '/crm/follow-ups', undefined, query),
      },
      imports: {
        preview: (fileId: string, entity: ImportInput['entity']) => request<ImportPreview>('POST', '/crm/import/preview', { fileId, entity }),
        start: (input: Partial<ImportInput> & Pick<ImportInput, 'fileId' | 'entity' | 'mapping'>) => request<ImportJobStatus>('POST', '/crm/import', input),
        status: (importId: string) => request<ImportJobStatus>('GET', `/crm/import/${id(importId)}`),
      },
    },
    copyAssets: {
      list: (query?: { page?: number; pageSize?: number; q?: string; kind?: string; language?: string; favorite?: 'true' | 'false' }) =>
        request<Paginated<CopyAssetDto>>('GET', '/copy-assets', undefined, query),
      get: (assetId: string) => request<CopyAssetDto>('GET', `/copy-assets/${id(assetId)}`),
      save: (input: Partial<SaveCopyAssetInput> & Pick<SaveCopyAssetInput, 'kind' | 'content'>) => request<CopyAssetDto>('POST', '/copy-assets', input),
      update: (assetId: string, input: UpdateCopyAssetInput) => request<CopyAssetDto>('PATCH', `/copy-assets/${id(assetId)}`, input),
      remove: (assetId: string) => request<void>('DELETE', `/copy-assets/${id(assetId)}`),
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
