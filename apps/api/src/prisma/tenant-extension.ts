import { Prisma } from '../generated/prisma/client.js';
import { MissingTenantError, TenantContext, TenantMismatchError } from '../common/tenant-context.js';

/** Models whose rows belong to exactly one organization. Every new tenant model must be added here. */
export const TENANT_MODELS = new Set<string>(['Workspace', 'StoredFile', 'AiUsage', 'AuditLog', 'Invoice', 'Payment', 'GenerationJob', 'BrandKit', 'Design', 'DesignVersion', 'Template', 'CopyAsset', 'Company', 'Contact', 'Lead', 'Pipeline', 'PipelineStage', 'Deal', 'Activity', 'CrmImport', 'SocialConnection', 'SocialAccount', 'SocialPost', 'SocialPostTarget', 'AdAccount', 'AdCampaign', 'AdGroup', 'Ad', 'AdInsightDaily', 'AdApproval', 'Campaign', 'CampaignChannelPlan', 'CampaignAsset', 'CampaignTask', 'TrackedLink', 'TrackedLinkClickDaily']);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

type Data = Record<string, unknown>;

function withTenantData(model: string, data: Data, organizationId: string): Data {
  const given = data.organizationId;
  if (given !== undefined && given !== organizationId) throw new TenantMismatchError(model);
  // Relation-style connect is also rejected unless it points at the active org.
  const connectId = (data.organization as { connect?: { id?: string } } | undefined)?.connect?.id;
  if (connectId !== undefined && connectId !== organizationId) throw new TenantMismatchError(model);
  if (connectId !== undefined) return data;
  return { ...data, organizationId };
}

/**
 * Pure function that rewrites query args so they are confined to `organizationId`.
 * Exported for unit testing.
 */
export function scopeArgs(model: string, operation: string, args: Data, organizationId: string): Data {
  const next: Data = { ...args };
  if (WHERE_OPERATIONS.has(operation)) {
    next.where = { ...((args.where as Data | undefined) ?? {}), organizationId };
  }
  if (operation === 'create') {
    next.data = withTenantData(model, (args.data as Data | undefined) ?? {}, organizationId);
  }
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = args.data as Data | Data[];
    next.data = Array.isArray(data) ? data.map((d) => withTenantData(model, d, organizationId)) : withTenantData(model, data, organizationId);
  }
  if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
    const data = (args.data as Data | undefined) ?? {};
    if (data.organizationId !== undefined && data.organizationId !== organizationId) throw new TenantMismatchError(model);
  }
  if (operation === 'upsert') {
    next.where = { ...((args.where as Data | undefined) ?? {}), organizationId };
    next.create = withTenantData(model, (args.create as Data | undefined) ?? {}, organizationId);
  }
  return next;
}

/**
 * Prisma client extension enforcing tenant isolation for TENANT_MODELS.
 * - Queries without an active tenant context throw (fail closed).
 * - Reads/updates/deletes are filtered by organizationId.
 * - Creates get organizationId injected; a mismatching organizationId throws.
 */
export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const organizationId = TenantContext.organizationId();
        if (!organizationId) throw new MissingTenantError(model);
        return query(scopeArgs(model, operation, args as Data, organizationId) as typeof args);
      },
    },
  },
});
