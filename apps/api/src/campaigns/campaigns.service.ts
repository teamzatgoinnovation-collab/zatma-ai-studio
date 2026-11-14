import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Paginated } from '@zatma/types';
import {
  CAMPAIGN_TYPE_INFO,
  campaignAudienceSchema,
  deriveStatus,
  fromCents,
  readinessIssues,
  slugifyUtm,
  toCents,
  type CampaignAttachInput,
  type CampaignAudience,
  type CampaignChannel,
  type CampaignContentDto,
  type CampaignStopInput,
  type ChannelPlanInput,
  type ContentPlanItem,
  type CreateMarketingCampaignInput,
  type ListMarketingCampaignsQuery,
  type ManualStatus,
  type MarketingCampaignDto,
  type MarketingCampaignStatus,
  type MarketingCampaignType,
  type MarketingObjective,
  type MoneyByCurrency,
  type UpdateMarketingCampaignInput,
} from '@zatma/validation';
import { AdsService } from '../ads/ads.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { campaignCode, ownerScope } from '../crm/crm-common.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PublishingService } from '../publishing/publishing.service.js';

const INCLUDE = {
  owner: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  plans: true,
  _count: {
    select: {
      posts: { where: { deletedAt: null } },
      adCampaigns: { where: { deletedAt: null } },
      assets: true,
      links: { where: { deletedAt: null } },
      leads: { where: { deletedAt: null } },
      tasks: true,
    },
  },
} satisfies Prisma.CampaignInclude;
type Row = Prisma.CampaignGetPayload<{ include: typeof INCLUDE }>;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
export const sumByCurrency = (rows: { currency: string; cents: bigint }[]): MoneyByCurrency[] => {
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? 0n) + r.cents);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, cents]) => ({ currency, amount: fromCents(cents) }));
};

export interface StopResult {
  campaign: MarketingCampaignDto;
  ads: { id: string; name: string; ok: boolean; error?: string }[];
  posts: { id: string; caption: string; ok: boolean; error?: string }[];
}

/**
 * Multi-channel campaigns (Phase 12). The campaign status is a planning status: nothing in this service activates
 * an ad campaign or raises a budget. Pausing may pause linked ads (that stops spend); resuming only reports which
 * ads are paused so an Owner/Admin can review them through the Phase 11 approval flow.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly ads: AdsService,
    private readonly publishing: PublishingService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  private perms() {
    return TenantContext.get()?.permissions ?? [];
  }

  // ───────────── Reading ─────────────

  async row(id: string): Promise<Row> {
    const r = await this.db.campaign.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!r) throw notFound('Campaign');
    return r;
  }

  /** Spend of linked ad campaigns per campaign, per currency (never mixed). */
  private async spend(ids: string[]): Promise<Map<string, MoneyByCurrency[]>> {
    const out = new Map<string, MoneyByCurrency[]>();
    if (!ids.length) return out;
    const ads = await this.db.adCampaign.findMany({ where: { marketingCampaignId: { in: ids }, deletedAt: null }, select: { id: true, marketingCampaignId: true, currency: true } });
    if (!ads.length) return out;
    const sums = await this.db.adInsightDaily.groupBy({ by: ['campaignId'], where: { campaignId: { in: ads.map((a) => a.id) } }, _sum: { spend: true } });
    const byAd = new Map(sums.map((s) => [s.campaignId, toCents((s._sum.spend ?? 0).toFixed(2))]));
    for (const id of ids) {
      const mine = ads.filter((a) => a.marketingCampaignId === id);
      if (mine.length) out.set(id, sumByCurrency(mine.map((a) => ({ currency: a.currency, cents: byAd.get(a.id) ?? 0n }))));
    }
    return out;
  }

  statusOf(r: { manualStatus: MarketingCampaignStatus | null; readyAt: Date | null; startAt: Date | null; endAt: Date | null; channels: string[] }, now = new Date()): MarketingCampaignStatus {
    return deriveStatus({ manualStatus: r.manualStatus as ManualStatus | null, readyAt: r.readyAt, startAt: r.startAt, endAt: r.endAt, channels: r.channels }, now);
  }

  toDto(r: Row, spend: MoneyByCurrency[] = []): MarketingCampaignDto {
    const plans = new Map(r.plans.map((p) => [p.channel, p]));
    const channels = r.channels as CampaignChannel[];
    return {
      id: r.id,
      code: campaignCode(r.number),
      workspaceId: r.workspaceId,
      name: r.name,
      type: r.type as MarketingCampaignType,
      objective: r.objective as MarketingObjective,
      description: r.description,
      status: this.statusOf(r),
      manualStatus: (r.manualStatus as ManualStatus | null) ?? null,
      readyAt: iso(r.readyAt),
      owner: r.owner,
      startAt: iso(r.startAt),
      endAt: iso(r.endAt),
      timezone: r.timezone,
      budgetAmount: r.budgetAmount?.toFixed(2) ?? null,
      currency: r.currency,
      channels,
      // One plan per selected channel (stored plans for channels no longer selected are kept but not shown).
      channelPlans: channels.map((channel) => {
        const p = plans.get(channel);
        return { channel, plannedBudget: p?.plannedBudget?.toFixed(2) ?? null, notes: p?.notes ?? '', content: (p?.content as ContentPlanItem[] | undefined) ?? [] };
      }),
      audience: campaignAudienceSchema.parse(r.audience ?? {}),
      utmCampaign: r.utmCampaign,
      counts: { posts: r._count.posts, adCampaigns: r._count.adCampaigns, assets: r._count.assets, links: r._count.links, leads: r._count.leads, tasks: r._count.tasks },
      spend,
      readinessIssues: readinessIssues({ startAt: r.startAt, endAt: r.endAt, channels }),
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async get(id: string): Promise<MarketingCampaignDto> {
    const r = await this.row(id);
    return this.toDto(r, (await this.spend([id])).get(id));
  }

  async list(q: ListMarketingCampaignsQuery): Promise<Paginated<MarketingCampaignDto>> {
    const where: Prisma.CampaignWhereInput = {
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channels: { has: q.channel } } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId === 'none' ? null : q.ownerId } : {}),
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { utmCampaign: { contains: q.q.toLowerCase() } }, ...(/^cmp-?\d+$/i.test(q.q) ? [{ number: Number(q.q.replace(/\D/g, '')) }] : [])] } : {}),
      ...(q.from || q.to
        ? { AND: [...(q.to ? [{ OR: [{ startAt: null }, { startAt: { lt: new Date(q.to) } }] }] : []), ...(q.from ? [{ OR: [{ endAt: null }, { endAt: { gte: new Date(q.from) } }] }] : [])] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.campaign.findMany({ where, include: INCLUDE, orderBy: [{ startAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.campaign.count({ where }),
    ]);
    const spend = await this.spend(rows.map((r) => r.id));
    return { data: rows.map((r) => this.toDto(r, spend.get(r.id))), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
  }

  // ───────────── Writing ─────────────

  private async assertOwner(ownerId: string | null | undefined) {
    if (!ownerId) return;
    const m = await this.prisma.system.member.findFirst({ where: { organizationId: TenantContext.requireOrganizationId(), userId: ownerId }, select: { id: true } });
    if (!m) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_OWNER', 'The owner must be a member of this organization');
  }

  private assertPlans(budget: string | null | undefined, plans: ChannelPlanInput[] | undefined) {
    if (!budget || !plans) return;
    const planned = plans.reduce((n, p) => n + (p.plannedBudget ? toCents(p.plannedBudget) : 0n), 0n);
    if (planned > toCents(budget)) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'BUDGET_SPLIT_EXCEEDS_TOTAL', `The channel budgets add up to ${fromCents(planned)}, more than the campaign budget of ${budget}`);
  }

  private planRows(organizationId: string, plans: ChannelPlanInput[]) {
    return plans.map((p) => ({ organizationId, channel: p.channel, plannedBudget: p.plannedBudget, notes: p.notes, content: p.content as unknown as Prisma.InputJsonValue }));
  }

  async create(input: CreateMarketingCampaignInput): Promise<MarketingCampaignDto> {
    const organizationId = TenantContext.requireOrganizationId();
    if (!(await this.db.workspace.findFirst({ where: { id: input.workspaceId }, select: { id: true } }))) throw notFound('Workspace');
    await this.usage.assertWithinLimit(organizationId, 'campaigns', 1);
    await this.assertOwner(input.ownerId);
    const channels = input.channels ?? CAMPAIGN_TYPE_INFO[input.type].channels;
    this.assertPlans(input.budgetAmount, input.channelPlans);
    const org = await this.prisma.system.organization.findUnique({ where: { id: organizationId }, select: { currency: true } });
    const userId = TenantContext.get()?.userId ?? null;
    // Sequence per organization; retry if two campaigns are created at the same moment.
    for (let attempt = 0; ; attempt++) {
      try {
        const id = await this.db.$transaction(async (tx) => {
          const last = await tx.campaign.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
          const c = await tx.campaign.create({
            data: {
              organizationId,
              workspaceId: input.workspaceId,
              number: (last?.number ?? 0) + 1,
              name: input.name,
              type: input.type,
              objective: input.objective,
              description: input.description,
              ownerId: input.ownerId ?? userId,
              startAt: input.startAt ? new Date(input.startAt) : null,
              endAt: input.endAt ? new Date(input.endAt) : null,
              timezone: input.timezone,
              budgetAmount: input.budgetAmount,
              currency: input.currency ?? org?.currency ?? 'INR',
              channels,
              audience: (input.audience ?? campaignAudienceSchema.parse({})) as Prisma.InputJsonValue,
              utmCampaign: input.utmCampaign ?? slugifyUtm(input.name),
              createdById: userId,
              status: 'DRAFT',
              plans: { create: this.planRows(organizationId, input.channelPlans ?? []) },
            },
          });
          return c.id;
        });
        await this.audit.record('campaigns.created', 'campaign', id, { name: input.name, type: input.type });
        return this.get(id);
      } catch (e) {
        if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  async update(id: string, input: UpdateMarketingCampaignInput): Promise<MarketingCampaignDto> {
    const r = await this.row(id);
    if (r.manualStatus === 'CANCELLED') throw new AppException(HttpStatus.CONFLICT, 'CAMPAIGN_CANCELLED', 'A cancelled campaign cannot be edited');
    await this.assertOwner(input.ownerId);
    const startAt = input.startAt !== undefined ? input.startAt : iso(r.startAt);
    const endAt = input.endAt !== undefined ? input.endAt : iso(r.endAt);
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', 'The end date must be after the start date');
    const budget = input.budgetAmount !== undefined ? input.budgetAmount : (r.budgetAmount?.toFixed(2) ?? null);
    const plans = input.channelPlans ?? r.plans.map((p) => ({ channel: p.channel as CampaignChannel, plannedBudget: p.plannedBudget?.toFixed(2) ?? null, notes: p.notes, content: p.content as ContentPlanItem[] }));
    this.assertPlans(budget, plans);
    const channels = input.channels ?? (r.channels as CampaignChannel[]);
    // A ready campaign that loses its dates or channels goes back to Draft.
    const stillReady = r.readyAt && readinessIssues({ startAt, endAt, channels }).length === 0;
    await this.db.$transaction(async (tx) => {
      const data: Prisma.CampaignUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.ownerId !== undefined ? { owner: input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true } } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt ? new Date(input.startAt) : null } : {}),
        ...(input.endAt !== undefined ? { endAt: input.endAt ? new Date(input.endAt) : null } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.budgetAmount !== undefined ? { budgetAmount: input.budgetAmount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.channels !== undefined ? { channels: input.channels } : {}),
        ...(input.audience !== undefined ? { audience: input.audience as Prisma.InputJsonValue } : {}),
        ...(input.utmCampaign !== undefined ? { utmCampaign: input.utmCampaign } : {}),
        ...(!stillReady && r.readyAt ? { readyAt: null } : {}),
      };
      const next = { manualStatus: r.manualStatus, readyAt: stillReady ? r.readyAt : null, startAt: startAt ? new Date(startAt) : null, endAt: endAt ? new Date(endAt) : null, channels };
      await tx.campaign.update({ where: { id }, data: { ...data, status: this.statusOf(next) } });
      if (input.channelPlans) {
        await tx.campaignChannelPlan.deleteMany({ where: { campaignId: id } });
        if (input.channelPlans.length) await tx.campaignChannelPlan.createMany({ data: this.planRows(r.organizationId, input.channelPlans).map((p) => ({ ...p, campaignId: id })) });
      }
    });
    await this.audit.record('campaigns.updated', 'campaign', id, { fields: Object.keys(input) });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const r = await this.row(id);
    // Detach everything so posts, ads and leads stay intact.
    await this.db.$transaction([
      this.db.socialPost.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
      this.db.adCampaign.updateMany({ where: { marketingCampaignId: id }, data: { marketingCampaignId: null } }),
      this.db.design.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
      this.db.copyAsset.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
      this.db.trackedLink.updateMany({ where: { campaignId: id }, data: { deletedAt: new Date() } }),
      this.db.campaign.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    await this.audit.record('campaigns.deleted', 'campaign', id, { name: r.name });
  }

  // ───────────── Status (planning only) ─────────────

  private async setStatus(r: Row, patch: { manualStatus?: MarketingCampaignStatus | null; readyAt?: Date | null }) {
    const next = { ...r, ...patch };
    await this.db.campaign.update({ where: { id: r.id }, data: { ...patch, status: this.statusOf(next) } });
  }

  async ready(id: string, ready: boolean): Promise<MarketingCampaignDto> {
    const r = await this.row(id);
    if (r.manualStatus) throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', `Resume the campaign first`);
    if (ready) {
      const issues = readinessIssues({ startAt: r.startAt, endAt: r.endAt, channels: r.channels });
      if (issues.length) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'CAMPAIGN_NOT_READY', issues.join('. '), { issues });
    }
    await this.setStatus(r, { readyAt: ready ? new Date() : null });
    await this.audit.record(ready ? 'campaigns.marked_ready' : 'campaigns.back_to_draft', 'campaign', id, {});
    return this.get(id);
  }

  /** Pause (or cancel) the campaign; optionally pause its running ads and return its scheduled posts to drafts. */
  async stop(id: string, kind: 'PAUSED' | 'CANCELLED', opts: CampaignStopInput): Promise<StopResult> {
    const r = await this.row(id);
    if (r.manualStatus === 'CANCELLED') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'The campaign is already cancelled');
    if (kind === 'PAUSED' && r.manualStatus === 'PAUSED') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', 'The campaign is already paused');
    await this.setStatus(r, { manualStatus: kind });
    const ads: StopResult['ads'] = [];
    const posts: StopResult['posts'] = [];
    if (opts.pauseAds) {
      const running = await this.db.adCampaign.findMany({ where: { marketingCampaignId: id, deletedAt: null, status: 'ACTIVE' }, select: { id: true, name: true } });
      for (const a of running) {
        if (!this.perms().includes('ads:manage')) {
          ads.push({ id: a.id, name: a.name, ok: false, error: 'You need permission to manage ads' });
          continue;
        }
        try {
          await this.ads.pause(a.id);
          ads.push({ id: a.id, name: a.name, ok: true });
        } catch (e) {
          ads.push({ id: a.id, name: a.name, ok: false, error: e instanceof AppException ? (e.getResponse() as { message: string }).message : (e as Error).message });
        }
      }
    }
    if (opts.unschedulePosts) {
      const scheduled = await this.db.socialPost.findMany({ where: { campaignId: id, deletedAt: null, status: 'SCHEDULED' }, select: { id: true, caption: true } });
      for (const p of scheduled) {
        const caption = p.caption.slice(0, 80) || 'Untitled post';
        if (!this.perms().includes('social:publish')) {
          posts.push({ id: p.id, caption, ok: false, error: 'You need permission to publish posts' });
          continue;
        }
        try {
          await this.publishing.cancel(p.id);
          posts.push({ id: p.id, caption, ok: true });
        } catch (e) {
          posts.push({ id: p.id, caption, ok: false, error: e instanceof AppException ? (e.getResponse() as { message: string }).message : (e as Error).message });
        }
      }
    }
    await this.audit.record(kind === 'PAUSED' ? 'campaigns.paused' : 'campaigns.cancelled', 'campaign', id, { adsPaused: ads.filter((a) => a.ok).length, postsUnscheduled: posts.filter((p) => p.ok).length });
    return { campaign: await this.get(id), ads, posts };
  }

  /**
   * Clears a manual pause. This never activates anything: the response lists the linked ad campaigns that are paused
   * on the platform, so an Owner/Admin can review and activate each one with the explicit spend confirmation.
   */
  async resume(id: string): Promise<{ campaign: MarketingCampaignDto; pausedAds: { id: string; name: string; platform: string }[] }> {
    const r = await this.row(id);
    if (r.manualStatus !== 'PAUSED') throw new AppException(HttpStatus.CONFLICT, 'INVALID_STATUS', r.manualStatus === 'CANCELLED' ? 'A cancelled campaign cannot be resumed' : 'The campaign is not paused');
    await this.setStatus(r, { manualStatus: null });
    await this.audit.record('campaigns.resumed', 'campaign', id, {});
    const pausedAds = await this.db.adCampaign.findMany({ where: { marketingCampaignId: id, deletedAt: null, status: 'PAUSED', externalId: { not: null } }, select: { id: true, name: true, platform: true } });
    return { campaign: await this.get(id), pausedAds };
  }

  /** Hourly: persist the date-driven status so filters and plan usage stay right. Returns the number changed. */
  async sweepStatuses(organizationId?: string): Promise<number> {
    const db = this.prisma.system;
    const rows = await db.campaign.findMany({ where: { deletedAt: null, manualStatus: null, readyAt: { not: null }, ...(organizationId ? { organizationId } : {}), status: { in: ['DRAFT', 'SCHEDULED', 'ACTIVE'] } }, select: { id: true, status: true, manualStatus: true, readyAt: true, startAt: true, endAt: true, channels: true } });
    let n = 0;
    for (const r of rows) {
      const s = this.statusOf(r);
      if (s !== r.status) {
        await db.campaign.update({ where: { id: r.id }, data: { status: s } });
        n++;
      }
    }
    return n;
  }

  // ───────────── Linking ─────────────

  async attach(id: string, input: CampaignAttachInput): Promise<{ updated: number }> {
    const r = await this.row(id);
    const value = input.detach ? null : id;
    const scope = input.detach ? { campaignId: id } : {};
    const ws = { workspaceId: r.workspaceId };
    let updated = 0;
    const check = async (found: number, what: string) => {
      if (found !== input.ids.length) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'LINK_INVALID', `Some ${what} were not found in this campaign's workspace`);
    };
    switch (input.kind) {
      case 'post': {
        const where = { id: { in: input.ids }, deletedAt: null, ...ws, ...scope };
        await check(await this.db.socialPost.count({ where }), 'posts');
        updated = (await this.db.socialPost.updateMany({ where, data: { campaignId: value } })).count;
        break;
      }
      case 'ad_campaign': {
        const where = { id: { in: input.ids }, deletedAt: null, ...ws, ...(input.detach ? { marketingCampaignId: id } : {}) };
        await check(await this.db.adCampaign.count({ where }), 'ad campaigns');
        updated = (await this.db.adCampaign.updateMany({ where, data: { marketingCampaignId: value } })).count;
        break;
      }
      case 'design': {
        const where = { id: { in: input.ids }, deletedAt: null, ...ws, ...scope };
        await check(await this.db.design.count({ where }), 'designs');
        updated = (await this.db.design.updateMany({ where, data: { campaignId: value } })).count;
        break;
      }
      case 'copy': {
        const where = { id: { in: input.ids }, deletedAt: null, ...ws, ...scope };
        await check(await this.db.copyAsset.count({ where }), 'copy items');
        updated = (await this.db.copyAsset.updateMany({ where, data: { campaignId: value } })).count;
        break;
      }
      case 'lead': {
        // Changing a lead needs CRM write access and respects record ownership (Sales Agents: own leads only).
        if (!this.perms().includes('crm:write')) throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You need CRM access to attribute leads');
        const where = { id: { in: input.ids }, deletedAt: null, ...ownerScope(), ...scope };
        await check(await this.db.lead.count({ where }), 'leads');
        updated = (await this.db.lead.updateMany({ where, data: { campaignId: value } })).count;
        break;
      }
      case 'deal': {
        if (!this.perms().includes('crm:write')) throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You need CRM access to attribute deals');
        const where = { id: { in: input.ids }, deletedAt: null, ...ownerScope(), ...scope };
        await check(await this.db.deal.count({ where }), 'deals');
        updated = (await this.db.deal.updateMany({ where, data: { campaignId: value } })).count;
        break;
      }
    }
    await this.audit.record(input.detach ? 'campaigns.detached' : 'campaigns.attached', 'campaign', id, { kind: input.kind, count: updated });
    return { updated };
  }

  async content(id: string): Promise<CampaignContentDto> {
    await this.row(id);
    const [posts, ads] = await Promise.all([
      this.db.socialPost.findMany({ where: { campaignId: id, deletedAt: null }, orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 200, include: { targets: { select: { platform: true } } } }),
      this.db.adCampaign.findMany({ where: { marketingCampaignId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    const spend = ads.length ? await this.db.adInsightDaily.groupBy({ by: ['campaignId'], where: { campaignId: { in: ads.map((a) => a.id) } }, _sum: { spend: true } }) : [];
    const spendOf = new Map(spend.map((s) => [s.campaignId, (s._sum.spend ?? 0).toFixed(2)]));
    return {
      posts: posts.map((p) => ({ id: p.id, caption: p.caption, status: p.status, scheduledAt: iso(p.scheduledAt), publishedAt: iso(p.publishedAt), platforms: [...new Set(p.targets.map((t) => t.platform))] })),
      adCampaigns: ads.map((a) => ({ id: a.id, name: a.name, platform: a.platform, status: a.status, currency: a.currency, budgetType: a.budgetType, budgetAmount: a.budgetAmount.toFixed(2), spend: spendOf.get(a.id) ?? '0.00', startAt: iso(a.startAt), endAt: iso(a.endAt) })),
    };
  }

  audienceOf(r: { audience: Prisma.JsonValue }): CampaignAudience {
    return campaignAudienceSchema.parse(r.audience ?? {});
  }
}
