import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { toAuthRole, type Paginated } from '@zatma/types';
import {
  AD_PLATFORM_LABELS,
  formatMoney,
  fromCents,
  maxSpend,
  maxSpendThisMonth,
  monthWindow,
  OBJECTIVES_BY_PLATFORM,
  toCents,
  validateCampaign,
  type AdCampaignDto,
  type AdInsights,
  type AdPlatform,
  type AiCampaignRequest,
  type CampaignDraftInput,
  type CampaignDraftRequest,
  type GoogleRsa,
  type ListCampaignsQuery,
  type MetaCreative,
  type MetaTargeting,
  type UpdateCampaignInput,
  aiCampaignOutputSchema,
} from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CopyService } from '../copy/copy.service.js';
import { EmailService } from '../email/email.service.js';
import { emailTemplates } from '../email/templates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderAuthError } from '../social/providers/provider.js';
import { StorageService } from '../storage/storage.service.js';
import { AdsAccountsService } from './ads-accounts.service.js';
import type { CampaignIds } from './providers/ads-provider.js';

export const ADS_SYNC_QUEUE = 'ads-sync';
export type AdsJob = { kind: 'create'; organizationId: string; campaignId: string } | { kind: 'sync'; organizationId?: string; days?: number };

const CAMPAIGN_INCLUDE = {
  adAccount: true,
  adGroups: { orderBy: { position: 'asc' }, include: { ads: { orderBy: { position: 'asc' } } } },
  createdBy: { select: { id: true, name: true } },
  activatedBy: { select: { id: true, name: true } },
  approvals: { orderBy: { createdAt: 'desc' }, include: { approvedBy: { select: { name: true } } } },
} satisfies Prisma.AdCampaignInclude;
type CampaignRow = Prisma.AdCampaignGetPayload<{ include: typeof CAMPAIGN_INCLUDE }>;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly accounts: AdsAccountsService,
    private readonly storage: StorageService,
    private readonly copy: CopyService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @InjectQueue(ADS_SYNC_QUEUE) private readonly queue: Queue<AdsJob>,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  private perms() {
    return TenantContext.get()?.permissions ?? [];
  }

  // ───────────── Reading ─────────────

  private async row(id: string): Promise<CampaignRow> {
    const r = await this.db.adCampaign.findFirst({ where: { id, deletedAt: null }, include: CAMPAIGN_INCLUDE });
    if (!r) throw notFound('Campaign');
    return r;
  }

  private async spendCents(ids: string[]): Promise<Record<string, bigint>> {
    if (!ids.length) return {};
    const rows = await this.db.adInsightDaily.groupBy({ by: ['campaignId'], where: { campaignId: { in: ids } }, _sum: { spend: true } });
    return Object.fromEntries(rows.map((r) => [r.campaignId, toCents((r._sum.spend ?? 0).toFixed(2))]));
  }

  private async toDto(r: CampaignRow, spend?: bigint): Promise<AdCampaignDto> {
    const imageIds = r.adGroups.flatMap((g) => g.ads.map((a) => (a.creative as Partial<MetaCreative>).imageFileId).filter((x): x is string => !!x));
    const files = imageIds.length ? await this.db.storedFile.findMany({ where: { id: { in: imageIds } }, select: { id: true, key: true } }) : [];
    const urls = Object.fromEntries(await Promise.all(files.map(async (f) => [f.id, await this.storage.signedUrlForKey(f.key)] as const)));
    const budget = { budgetType: r.budgetType, budgetAmount: r.budgetAmount.toFixed(2), startAt: iso(r.startAt), endAt: iso(r.endAt) };
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      platform: r.platform as AdPlatform,
      adAccount: { id: r.adAccount.id, name: r.adAccount.name, currency: r.adAccount.currency, timezone: r.adAccount.timezone, monthlySpendCap: r.adAccount.monthlySpendCap?.toFixed(2) ?? null },
      name: r.name,
      objective: r.objective as AdCampaignDto['objective'],
      status: r.status,
      source: r.source as AdCampaignDto['source'],
      marketingCampaignId: r.marketingCampaignId,
      budgetType: r.budgetType,
      budgetAmount: budget.budgetAmount,
      currency: r.currency,
      startAt: budget.startAt,
      endAt: budget.endAt,
      externalId: r.externalId,
      maxSpend: maxSpend(budget),
      spend: fromCents(spend ?? (await this.spendCents([r.id]))[r.id] ?? 0n),
      error: r.error,
      createdBy: r.createdBy,
      activatedBy: r.activatedBy,
      activatedAt: iso(r.activatedAt),
      lastSyncedAt: iso(r.lastSyncedAt),
      adGroups: r.adGroups.map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        externalId: g.externalId,
        targeting: g.targeting as AdCampaignDto['adGroups'][number]['targeting'],
        ads: g.ads.map((a) => {
          const fileId = (a.creative as Partial<MetaCreative>).imageFileId;
          return { id: a.id, name: a.name, status: a.status, externalId: a.externalId, creative: a.creative as MetaCreative | GoogleRsa, imageUrl: fileId ? (urls[fileId] ?? null) : null };
        }),
      })),
      approvals: r.approvals.map((p) => ({ id: p.id, action: p.action, maxSpend: p.maxSpend.toFixed(2), currency: p.currency, by: p.approvedBy?.name ?? 'Former member', at: p.createdAt.toISOString() })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async get(id: string) {
    return this.toDto(await this.row(id));
  }

  async list(q: ListCampaignsQuery): Promise<Paginated<AdCampaignDto>> {
    const where: Prisma.AdCampaignWhereInput = {
      deletedAt: null,
      ...(q.platform ? { platform: q.platform } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.adAccountId ? { adAccountId: q.adAccountId } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.adCampaign.findMany({ where, include: CAMPAIGN_INCLUDE, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.adCampaign.count({ where }),
    ]);
    const spend = await this.spendCents(rows.map((r) => r.id));
    return { data: await Promise.all(rows.map((r) => this.toDto(r, spend[r.id] ?? 0n))), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
  }

  async insights(id: string, from: string, to: string): Promise<AdInsights> {
    const r = await this.row(id);
    const rows = await this.db.adInsightDaily.findMany({ where: { campaignId: id, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, orderBy: { date: 'asc' } });
    const sum = (k: 'impressions' | 'reach' | 'clicks' | 'leads' | 'conversions') => rows.reduce((n, x) => n + x[k], 0);
    const spend = rows.reduce((n, x) => n + toCents(x.spend.toFixed(2)), 0n);
    const impressions = sum('impressions');
    const clicks = sum('clicks');
    return {
      currency: r.currency,
      totals: {
        impressions,
        reach: sum('reach'),
        clicks,
        spend: fromCents(spend),
        leads: sum('leads'),
        conversions: sum('conversions'),
        ctr: impressions ? Math.round((clicks / impressions) * 10_000) / 100 : 0,
        cpc: clicks ? fromCents(spend / BigInt(clicks)) : null,
        cpm: impressions ? fromCents((spend * 1000n) / BigInt(impressions)) : null,
      },
      daily: rows.map((x) => ({ date: x.date.toISOString().slice(0, 10), impressions: x.impressions, reach: x.reach, clicks: x.clicks, spend: x.spend.toFixed(2), conversions: x.conversions, leads: x.leads })),
    };
  }

  // ───────────── Drafts ─────────────

  private async assertDraft(input: CampaignDraftInput | (UpdateCampaignInput & Pick<CampaignDraftInput, 'workspaceId' | 'adAccountId'>), platform: AdPlatform, account: { workspaceIds: string[] }) {
    if (account.workspaceIds.length && !account.workspaceIds.includes(input.workspaceId)) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'ACCOUNT_NOT_IN_WORKSPACE', 'This ad account is not available in the workspace');
    if (input.objective && !OBJECTIVES_BY_PLATFORM[platform].includes(input.objective)) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'OBJECTIVE_UNSUPPORTED', `This objective is not available on ${AD_PLATFORM_LABELS[platform]}`);
    for (const g of input.adGroups ?? []) {
      for (const ad of g.ads) {
        const isMeta = 'primaryText' in ad.creative;
        if (isMeta !== (platform === 'META')) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'CREATIVE_INVALID', `${AD_PLATFORM_LABELS[platform]} ads need ${platform === 'META' ? 'text and an image' : 'headlines and descriptions'}`);
        if (isMeta) {
          const c = ad.creative as MetaCreative;
          const file = await this.db.storedFile.findFirst({ where: { id: c.imageFileId, status: 'UPLOADED' }, select: { mimeType: true } });
          if (!file || !file.mimeType.startsWith('image/')) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'MEDIA_NOT_FOUND', 'Choose an uploaded image for the ad');
          const page = await this.db.socialAccount.findFirst({ where: { platform: 'FACEBOOK_PAGE', externalId: c.pageId, status: { not: 'DISCONNECTED' } }, select: { id: true } });
          if (!page) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'PAGE_NOT_CONNECTED', 'Connect the Facebook Page on the Social Accounts page first');
        }
      }
    }
  }

  private groupsCreate(organizationId: string, groups: CampaignDraftInput['adGroups']) {
    return groups.map((g, gi) => ({
      organizationId,
      name: g.name,
      position: gi,
      targeting: g.targeting as Prisma.InputJsonValue,
      ads: { create: g.ads.map((a, ai) => ({ organizationId, name: a.name, position: ai, creative: a.creative as unknown as Prisma.InputJsonValue })) },
    }));
  }

  async create(input: CampaignDraftInput): Promise<AdCampaignDto> {
    const account = await this.accounts.row(input.adAccountId);
    const platform = account.platform as AdPlatform;
    if (!(await this.db.workspace.findFirst({ where: { id: input.workspaceId }, select: { id: true } }))) throw notFound('Workspace');
    await this.assertDraft(input, platform, account);
    const organizationId = TenantContext.requireOrganizationId();
    const c = await this.db.adCampaign.create({
      data: {
        organizationId,
        workspaceId: input.workspaceId,
        adAccountId: account.id,
        platform,
        name: input.name,
        objective: input.objective,
        budgetType: input.budgetType,
        budgetAmount: input.budgetAmount,
        currency: account.currency,
        startAt: input.startAt ? new Date(input.startAt) : null,
        endAt: input.endAt ? new Date(input.endAt) : null,
        marketingCampaignId: await this.assertMarketingCampaign(input.marketingCampaignId),
        createdById: TenantContext.get()?.userId ?? null,
        adGroups: { create: this.groupsCreate(organizationId, input.adGroups) },
      },
    });
    await this.audit.record('ads.campaign_created', 'ad_campaign', c.id, { platform, name: input.name });
    return this.get(c.id);
  }

  private async assertMarketingCampaign(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    if (!(await this.db.campaign.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw notFound('Campaign');
    return id;
  }

  async update(id: string, input: UpdateCampaignInput): Promise<AdCampaignDto> {
    const r = await this.row(id);
    if (r.externalId || !['DRAFT', 'ERROR'].includes(r.status)) throw new AppException(HttpStatus.CONFLICT, 'CAMPAIGN_LOCKED', 'This campaign already exists on the platform; change its budget or pause it instead');
    await this.assertDraft({ ...input, workspaceId: r.workspaceId, adAccountId: r.adAccountId }, r.platform as AdPlatform, r.adAccount);
    await this.prisma.tenant.$transaction(async (tx) => {
      await tx.adCampaign.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.objective !== undefined ? { objective: input.objective } : {}),
          ...(input.budgetType !== undefined ? { budgetType: input.budgetType } : {}),
          ...(input.budgetAmount !== undefined ? { budgetAmount: input.budgetAmount } : {}),
          ...(input.startAt !== undefined ? { startAt: input.startAt ? new Date(input.startAt) : null } : {}),
          ...(input.endAt !== undefined ? { endAt: input.endAt ? new Date(input.endAt) : null } : {}),
          ...(input.marketingCampaignId !== undefined ? { marketingCampaignId: await this.assertMarketingCampaign(input.marketingCampaignId) } : {}),
          ...(r.status === 'ERROR' ? { status: 'DRAFT' as const, error: null, syncState: {} } : {}),
        },
      });
      if (input.adGroups) {
        await tx.adGroup.deleteMany({ where: { campaignId: id } });
        for (const g of this.groupsCreate(r.organizationId, input.adGroups)) await tx.adGroup.create({ data: { ...g, campaignId: id } });
      }
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const r = await this.row(id);
    if (r.externalId && r.status === 'ACTIVE') throw new AppException(HttpStatus.CONFLICT, 'CAMPAIGN_ACTIVE', 'Pause the campaign before removing it');
    await this.db.adCampaign.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record('ads.campaign_deleted', 'ad_campaign', id, { name: r.name, onPlatform: !!r.externalId });
  }

  private draftOf(r: CampaignRow) {
    return {
      objective: r.objective as CampaignDraftInput['objective'],
      budgetType: r.budgetType,
      budgetAmount: r.budgetAmount.toFixed(2),
      startAt: iso(r.startAt),
      endAt: iso(r.endAt),
      adGroups: r.adGroups.map((g) => ({ name: g.name, targeting: g.targeting as MetaTargeting, ads: g.ads.map((a) => ({ name: a.name, creative: a.creative as MetaCreative })) })),
    };
  }

  validateRow(r: CampaignRow) {
    return validateCampaign(this.draftOf(r), r.platform as AdPlatform);
  }

  async validateDraft(input: CampaignDraftInput) {
    const account = await this.accounts.row(input.adAccountId);
    return { issues: validateCampaign(input, account.platform as AdPlatform), maxSpend: maxSpend(input) };
  }

  // ───────────── Platform actions ─────────────

  /** Creates the campaign on the platform (always PAUSED) through the queue. */
  async publish(id: string): Promise<AdCampaignDto> {
    const r = await this.row(id);
    if (!['DRAFT', 'ERROR'].includes(r.status)) throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'This campaign was already created on the platform');
    const errors = this.validateRow(r).filter((i) => i.level === 'error');
    if (errors.length) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'CAMPAIGN_INVALID', errors[0]!.message, { issues: errors });
    if (r.adAccount.status !== 'ACTIVE') throw new AppException(HttpStatus.CONFLICT, 'ACCOUNT_NEEDS_ATTENTION', `${r.adAccount.name} is ${r.adAccount.status === 'NEEDS_REAUTH' ? 'disconnected; reconnect it' : 'not active on the platform'}`);
    this.accounts.require(this.accounts.providerFor(r.platform as AdPlatform));
    await this.db.adCampaign.update({ where: { id }, data: { status: 'PUBLISHING', error: null } });
    await this.queue.add('create', { kind: 'create', organizationId: r.organizationId, campaignId: id }, { jobId: `create-${id}-${Date.now()}`, attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: 100 });
    await this.audit.record('ads.campaign_published_paused', 'ad_campaign', id, { platform: r.platform });
    return this.get(id);
  }

  idsOf(r: CampaignRow): CampaignIds {
    return { campaignId: r.externalId!, budgetId: r.budgetExternalId, groupIds: r.adGroups.map((g) => g.externalId!).filter(Boolean), adIds: r.adGroups.flatMap((g) => g.ads.map((a) => a.externalId!)).filter(Boolean) };
  }

  private async platformCall<T>(r: CampaignRow, fn: (a: Awaited<ReturnType<AdsAccountsService['ctx']>>) => Promise<T>): Promise<T> {
    const c = await this.accounts.ctx(r.adAccountId);
    try {
      return await fn(c);
    } catch (e) {
      if (e instanceof ProviderAuthError) {
        await this.accounts.flagReauth(c.account.connectionId, e.message);
        throw new AppException(HttpStatus.CONFLICT, 'ADS_REAUTH_REQUIRED', 'The ad platform connection must be reconnected');
      }
      if (e instanceof AppException) throw e;
      throw new AppException(HttpStatus.BAD_GATEWAY, 'ADS_PROVIDER_ERROR', (e as Error).message);
    }
  }

  /** Stops spending. Allowed for anyone who manages ads. */
  async pause(id: string): Promise<AdCampaignDto> {
    const r = await this.row(id);
    if (r.status !== 'ACTIVE') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'Only active campaigns can be paused');
    await this.platformCall(r, ({ adapter, ctx }) => adapter.setStatus(ctx, this.idsOf(r), 'PAUSED'));
    await this.db.adCampaign.update({ where: { id }, data: { status: 'PAUSED' } });
    await this.audit.record('ads.campaign_paused', 'ad_campaign', id, { name: r.name });
    return this.get(id);
  }

  /**
   * The only way a campaign starts spending. Requires `ads:approve`, an explicit confirmation, the maximum spend the
   * approver saw (the server's own figure must not be higher), and room under the account's monthly cap.
   */
  async activate(id: string, shown: string): Promise<AdCampaignDto> {
    this.assertApprover();
    const r = await this.row(id);
    if (r.status !== 'PAUSED' || !r.externalId) throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', r.externalId ? 'Only paused campaigns can be activated' : 'Create the campaign on the platform first');
    if (r.endAt && r.endAt.getTime() <= Date.now()) throw new AppException(HttpStatus.CONFLICT, 'CAMPAIGN_ENDED', 'The campaign end date has passed');
    if (r.adAccount.status !== 'ACTIVE') throw new AppException(HttpStatus.CONFLICT, 'ACCOUNT_NEEDS_ATTENTION', `${r.adAccount.name} is not active`);
    const budget = { budgetType: r.budgetType, budgetAmount: r.budgetAmount.toFixed(2), startAt: iso(r.startAt), endAt: iso(r.endAt) };
    const max = maxSpend(budget);
    this.assertShown(max.amount, shown, r.currency);
    await this.assertCap(r, maxSpendThisMonth(budget));
    await this.platformCall(r, ({ adapter, ctx }) => adapter.setStatus(ctx, this.idsOf(r), 'ACTIVE'));
    const userId = TenantContext.get()?.userId ?? null;
    await this.db.adCampaign.update({ where: { id }, data: { status: 'ACTIVE', activatedById: userId, activatedAt: new Date() } });
    await this.recordApproval(r, 'ACTIVATE', max.amount, budget.budgetAmount);
    return this.get(id);
  }

  /** Budget changes: decreases (or changes while paused) need `ads:manage`; increases on a running campaign need approval. */
  async changeBudget(id: string, input: { budgetAmount: string; confirm?: true; maxSpend?: string }): Promise<AdCampaignDto> {
    const r = await this.row(id);
    if (!r.externalId) return this.update(id, { budgetAmount: input.budgetAmount });
    if (!['ACTIVE', 'PAUSED'].includes(r.status)) throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'This campaign can no longer be changed');
    const increase = toCents(input.budgetAmount) > toCents(r.budgetAmount.toFixed(2));
    const budget = { budgetType: r.budgetType, budgetAmount: input.budgetAmount, startAt: iso(r.startAt), endAt: iso(r.endAt) };
    const errors = validateCampaign({ ...this.draftOf(r), budgetAmount: input.budgetAmount }, r.platform as AdPlatform).filter((i) => i.code.startsWith('BUDGET'));
    if (errors.length) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'CAMPAIGN_INVALID', errors[0]!.message, { issues: errors });
    if (increase && r.status === 'ACTIVE') {
      this.assertApprover();
      if (!input.confirm || !input.maxSpend) throw new AppException(HttpStatus.BAD_REQUEST, 'CONFIRMATION_REQUIRED', 'Confirm the new maximum spend');
      this.assertShown(maxSpend(budget).amount, input.maxSpend, r.currency);
      await this.assertCap(r, maxSpendThisMonth(budget));
    }
    await this.platformCall(r, ({ adapter, ctx }) => adapter.updateBudget(ctx, this.idsOf(r), r.budgetType, input.budgetAmount));
    await this.db.adCampaign.update({ where: { id }, data: { budgetAmount: input.budgetAmount } });
    if (increase && r.status === 'ACTIVE') await this.recordApproval(r, 'BUDGET_INCREASE', maxSpend(budget).amount, input.budgetAmount);
    else await this.audit.record('ads.budget_changed', 'ad_campaign', id, { from: r.budgetAmount.toFixed(2), to: input.budgetAmount });
    return this.get(id);
  }

  private assertApprover() {
    if (!this.perms().includes('ads:approve')) throw new AppException(HttpStatus.FORBIDDEN, 'SPEND_APPROVAL_REQUIRED', 'Only an Owner or Admin can start spending or raise a running budget');
  }

  /** The approver must have seen at least the amount the server computes now. */
  private assertShown(serverMax: string, shown: string, currency: string) {
    if (toCents(serverMax) > toCents(shown)) {
      throw new AppException(HttpStatus.CONFLICT, 'SPEND_CHANGED', `The maximum spend is now ${formatMoney(serverMax, currency)}. Review and confirm again.`, { maxSpend: serverMax });
    }
  }

  /** spent this month + remaining max of other active campaigns + this campaign's max this month ≤ cap. */
  private async assertCap(r: CampaignRow, thisMonth: string) {
    const cap = r.adAccount.monthlySpendCap;
    if (!cap) return;
    const month = monthWindow(new Date());
    const spent = await this.db.adInsightDaily.aggregate({ where: { date: { gte: month.start, lt: month.end }, campaign: { adAccountId: r.adAccountId } }, _sum: { spend: true } });
    const others = await this.db.adCampaign.findMany({ where: { adAccountId: r.adAccountId, deletedAt: null }, select: { id: true, status: true, budgetType: true, budgetAmount: true, startAt: true, endAt: true } });
    const total = toCents((spent._sum.spend ?? 0).toFixed(2)) + this.accounts.committedCents(others, r.id) + toCents(thisMonth);
    if (total > toCents(cap.toFixed(2))) {
      throw new AppException(HttpStatus.CONFLICT, 'SPEND_CAP_EXCEEDED', `This would allow up to ${formatMoney(fromCents(total), r.currency)} this month, above the ${formatMoney(cap.toFixed(2), r.currency)} cap for ${r.adAccount.name}.`, {
        cap: cap.toFixed(2),
        projected: fromCents(total),
      });
    }
  }

  private async recordApproval(r: CampaignRow, action: 'ACTIVATE' | 'BUDGET_INCREASE', max: string, budgetAmount: string) {
    const userId = TenantContext.get()?.userId ?? null;
    await this.db.adApproval.create({ data: { organizationId: r.organizationId, campaignId: r.id, action, maxSpend: max, currency: r.currency, budgetAmount, approvedById: userId } });
    await this.audit.record(action === 'ACTIVATE' ? 'ads.campaign_activated' : 'ads.budget_increased', 'ad_campaign', r.id, { name: r.name, maxSpend: max, currency: r.currency });
    // Tell the other Owners/Admins that money is now committed.
    const members = await this.prisma.system.member.findMany({ where: { organizationId: r.organizationId, role: { in: [toAuthRole('ORGANIZATION_OWNER'), toAuthRole('ADMIN')] }, ...(userId ? { userId: { not: userId } } : {}) }, include: { user: { select: { email: true, name: true } } } });
    const approver = userId ? await this.prisma.system.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
    for (const m of members) {
      const t = emailTemplates.adSpendApproved({ name: m.user.name, campaign: r.name, platform: AD_PLATFORM_LABELS[r.platform as AdPlatform], amount: formatMoney(max, r.currency), by: approver?.name ?? 'An admin', action, url: `${this.env.WEB_URL}/ads/campaigns/${r.id}` });
      await this.email.send({ to: m.user.email, subject: t.subject, html: t.html, text: t.text, tag: t.tag, organizationId: r.organizationId }).catch((e) => this.logger.warn(`Spend email failed: ${(e as Error).message}`));
    }
  }

  async syncNow(accountId: string): Promise<{ queued: true }> {
    await this.accounts.row(accountId);
    await this.queue.add('sync', { kind: 'sync', organizationId: TenantContext.requireOrganizationId(), days: 30 }, { jobId: `sync-${TenantContext.requireOrganizationId()}-${Date.now()}`, removeOnComplete: true, removeOnFail: 50 });
    return { queued: true };
  }

  async targeting(accountId: string, kind: 'location' | 'interest' | 'language', q: string) {
    const c = await this.accounts.ctx(accountId);
    try {
      return await c.adapter.searchTargeting(c.ctx, kind, q);
    } catch (e) {
      if (e instanceof ProviderAuthError) {
        await this.accounts.flagReauth(c.account.connectionId, e.message);
        throw new AppException(HttpStatus.CONFLICT, 'ADS_REAUTH_REQUIRED', 'The ad platform connection must be reconnected');
      }
      throw new AppException(HttpStatus.BAD_GATEWAY, 'ADS_PROVIDER_ERROR', (e as Error).message);
    }
  }

  // ───────────── AI draft (never saved or published automatically) ─────────────

  async aiDraft(input: AiCampaignRequest): Promise<{ draft: Omit<CampaignDraftRequest, 'workspaceId'>; rationale: string; unresolved: string[] }> {
    const account = await this.accounts.row(input.adAccountId);
    const platform = account.platform as AdPlatform;
    const org = await this.prisma.system.organization.findUnique({ where: { id: account.organizationId }, select: { name: true } });
    const kit = await this.db.brandKit.findFirst({ where: input.brandKitId ? { id: input.brandKitId } : { isDefault: true } });
    const objectives = OBJECTIVES_BY_PLATFORM[platform].join(', ');
    const system = [
      'You plan small-business ad campaigns for India and the Gulf. Be specific, honest and compliant with Meta and Google ad policies.',
      'Never invent prices, discounts, dates, phone numbers or claims that are not in the brief. No ALL-CAPS words, no excessive punctuation.',
      `Platform: ${AD_PLATFORM_LABELS[platform]}. Allowed objectives: ${objectives}.`,
      platform === 'META'
        ? 'Meta limits: headline ≤ 40 characters, description ≤ 30, primary text ideally ≤ 125. Give 3 variants.'
        : 'Google responsive search ad: 8–15 headlines of ≤ 30 characters and 4 descriptions of ≤ 90; 10–20 keywords with match types.',
      `Write ad text in language code "${input.language}". locationQueries and interestQueries must be plain English search terms (e.g. "Kochi", "Small business owners"), never ids.`,
      `The daily budget is in ${account.currency}${input.budgetMax ? ` and must not exceed ${input.budgetMax}` : ''}.`,
      'Reply with JSON only: {"name","objective","dailyBudget","locationQueries":[],"interestQueries":[],"ageMin","ageMax","variants":[{"primaryText","headline","description"}],"keywords":[{"text","matchType"}],"rsa":{"headlines":[],"descriptions":[]},"cta","rationale"}.',
    ].join('\n');
    const user = [`Business: ${org?.name ?? 'Unknown'}`, kit ? `Brand facts: ${[kit.tagline, kit.website, kit.phone].filter(Boolean).join(' · ')}` : '', `Brief: ${input.brief}`, input.objective ? `Preferred objective: ${input.objective}` : '', input.location ? `Target location: ${input.location}` : '', input.link ? `Landing page: ${input.link}` : '']
      .filter(Boolean)
      .join('\n');
    const res = await this.copy.runJson(system, user, aiCampaignOutputSchema, 2000, { organizationId: account.organizationId, userId: TenantContext.get()?.userId ?? null, purpose: 'ads' });
    const out = res.data;
    const objective = OBJECTIVES_BY_PLATFORM[platform].includes(out.objective) ? out.objective : (input.objective ?? OBJECTIVES_BY_PLATFORM[platform][0]!);
    const budget = input.budgetMax && toCents(out.dailyBudget) > toCents(input.budgetMax) ? input.budgetMax : out.dailyBudget;
    // Resolve every location/interest through the platform's own search; unresolved terms are reported, never guessed.
    const unresolved: string[] = [];
    const c = await this.accounts.ctx(account.id);
    const resolve = async (kind: 'location' | 'interest', q: string) => {
      const found = await c.adapter.searchTargeting(c.ctx, kind, q).catch(() => []);
      if (!found[0]) unresolved.push(q);
      return found[0];
    };
    const locs = (await Promise.all(out.locationQueries.map((q) => resolve('location', q)))).filter((x) => !!x);
    let group: CampaignDraftRequest['adGroups'][number];
    if (platform === 'META') {
      const interests = (await Promise.all(out.interestQueries.map((q) => resolve('interest', q)))).filter((x) => !!x);
      const v = out.variants[0]!;
      group = {
        name: 'Audience 1',
        targeting: {
          locations: locs.map((l) => ({ key: l.id, name: l.name, type: (['country', 'region', 'city', 'zip'].includes(l.type) ? l.type : 'city') as 'country' | 'region' | 'city' | 'zip', ...(l.countryCode ? { countryCode: l.countryCode } : {}) })),
          ageMin: out.ageMin,
          ageMax: Math.max(out.ageMin, out.ageMax),
          interests: interests.map((i) => ({ id: i.id, name: i.name })),
        },
        ads: out.variants.map((x, i) => ({ name: `Variant ${i + 1}`, creative: { pageId: '', primaryText: x.primaryText, headline: x.headline.slice(0, 40), description: x.description.slice(0, 30), cta: out.cta, ...(input.link ? { link: input.link } : {}), imageFileId: '', imageWidth: 1080, imageHeight: 1080 } as unknown as MetaCreative })).slice(0, v ? 3 : 0),
      };
    } else {
      group = {
        name: 'Keywords',
        targeting: { locations: locs.map((l) => ({ id: l.id, name: l.name })), languages: [], keywords: out.keywords.slice(0, 50) },
        ads: [{ name: 'Responsive search ad', creative: { headlines: (out.rsa?.headlines ?? []).map((h) => h.slice(0, 30)).slice(0, 15), descriptions: (out.rsa?.descriptions ?? []).map((d) => d.slice(0, 90)).slice(0, 4), finalUrl: input.link ?? 'https://' } as GoogleRsa }],
      };
    }
    return {
      draft: { adAccountId: account.id, name: out.name, objective, budgetType: 'DAILY', budgetAmount: budget, adGroups: [group] },
      rationale: out.rationale,
      unresolved,
    };
  }
}
