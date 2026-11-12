import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { GoogleRsa, MetaCreative } from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isRetryable, ProviderAuthError } from '../social/providers/provider.js';
import { StorageService } from '../storage/storage.service.js';
import { AdsAccountsService } from './ads-accounts.service.js';
import { ADS_SYNC_QUEUE, type AdsJob } from './ads.service.js';
import type { CampaignPlan } from './providers/ads-provider.js';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Background work for ads: creating campaigns (always PAUSED) and reading data back.
 * Nothing here ever activates a campaign or raises a budget; those are user decisions in AdsService.
 */
@Injectable()
export class AdsWorkerService {
  private readonly logger = new Logger(AdsWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AdsAccountsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Returns true when the job should be retried by the queue. */
  async create(job: { organizationId: string; campaignId: string }, finalAttempt: boolean): Promise<boolean> {
    return TenantContext.run({ organizationId: job.organizationId }, async () => {
      const db = this.prisma.tenant;
      const c = await db.adCampaign.findFirst({ where: { id: job.campaignId, deletedAt: null }, include: { adGroups: { orderBy: { position: 'asc' }, include: { ads: { orderBy: { position: 'asc' } } } } } });
      if (!c || c.status !== 'PUBLISHING') return false;
      const state = { ...((c.syncState ?? {}) as Record<string, unknown>) };
      const fail = async (message: string) => {
        await db.adCampaign.update({ where: { id: c.id }, data: { status: 'ERROR', error: message.slice(0, 500) } });
        await this.audit.record('ads.campaign_failed', 'ad_campaign', c.id, { error: message.slice(0, 200) });
        return false;
      };
      try {
        const { adapter, ctx } = await this.accounts.ctx(c.adAccountId, state, async (patch) => {
          Object.assign(state, patch);
          await db.adCampaign.update({ where: { id: c.id }, data: { syncState: state as Prisma.InputJsonValue } });
        });
        const plan: CampaignPlan = {
          name: c.name,
          objective: c.objective as CampaignPlan['objective'],
          budgetType: c.budgetType,
          budgetAmount: c.budgetAmount.toFixed(2),
          currency: c.currency,
          startAt: c.startAt?.toISOString() ?? null,
          endAt: c.endAt?.toISOString() ?? null,
          groups: c.adGroups.map((g) => ({
            localId: g.id,
            name: g.name,
            targeting: g.targeting as CampaignPlan['groups'][number]['targeting'],
            ads: g.ads.map((a) => ({
              localId: a.id,
              name: a.name,
              creative: a.creative as MetaCreative | GoogleRsa,
              image: async () => {
                const fileId = (a.creative as Partial<MetaCreative>).imageFileId;
                const f = fileId ? await db.storedFile.findFirst({ where: { id: fileId, status: 'UPLOADED' } }) : null;
                if (!f) throw new AppException(422, 'MEDIA_NOT_FOUND', 'The ad image was deleted');
                return { bytes: await this.storage.readRange(f.key, 0, f.sizeBytes - 1), fileName: f.fileName };
              },
            })),
          })),
        };
        const res = await adapter.createCampaign(plan, ctx);
        await db.$transaction([
          db.adCampaign.update({ where: { id: c.id }, data: { status: 'PAUSED', externalId: res.campaignId, budgetExternalId: res.budgetId ?? null, error: null, lastSyncedAt: new Date() } }),
          ...c.adGroups.map((g) => db.adGroup.update({ where: { id: g.id }, data: { externalId: res.groups[g.id] ?? null, status: 'PAUSED' } })),
          ...c.adGroups.flatMap((g) => g.ads.map((a) => db.ad.update({ where: { id: a.id }, data: { externalId: res.ads[a.id] ?? null, status: 'PAUSED' } }))),
        ]);
        await this.audit.record('ads.campaign_created_paused', 'ad_campaign', c.id, { externalId: res.campaignId });
        return false;
      } catch (e) {
        if (e instanceof ProviderAuthError) {
          const acct = await db.adAccount.findFirst({ where: { id: c.adAccountId }, select: { connectionId: true } });
          if (acct) await this.accounts.flagReauth(acct.connectionId, e.message);
          return fail(`Reconnect the ad account and try again: ${e.message}`);
        }
        if (e instanceof AppException) return fail((e.getResponse() as { message?: string }).message ?? e.message);
        if (isRetryable(e) && !finalAttempt) {
          await db.adCampaign.update({ where: { id: c.id }, data: { error: `Retrying: ${(e as Error).message}`.slice(0, 500) } });
          return true;
        }
        return fail((e as Error).message);
      }
    });
  }

  /** Imports campaigns made elsewhere, mirrors platform status changes, and stores daily insights. */
  async sync(organizationId: string | undefined, days: number): Promise<{ accounts: number }> {
    const orgs = organizationId ? [organizationId] : (await this.prisma.system.adAccount.groupBy({ by: ['organizationId'], where: { status: 'ACTIVE' } })).map((o) => o.organizationId);
    let n = 0;
    for (const org of orgs) {
      await TenantContext.run({ organizationId: org }, async () => {
        const accounts = await this.prisma.tenant.adAccount.findMany({ where: { status: 'ACTIVE' } });
        for (const a of accounts) {
          n++;
          await this.syncAccount(a.id, days).catch((e) => this.logger.warn(`Ads sync for ${a.id} failed: ${(e as Error).message}`));
        }
      });
    }
    return { accounts: n };
  }

  async syncAccount(accountId: string, days: number): Promise<void> {
    const db = this.prisma.tenant;
    const account = await db.adAccount.findFirstOrThrow({ where: { id: accountId } });
    try {
      const { adapter, ctx } = await this.accounts.ctx(accountId);
      const remote = await adapter.listCampaigns(ctx);
      const local = await db.adCampaign.findMany({ where: { adAccountId: accountId, externalId: { not: null } } });
      const workspace = await db.workspace.findFirst({ where: account.workspaceIds.length ? { id: account.workspaceIds[0] } : { isDefault: true } });
      for (const r of remote) {
        const mine = local.find((l) => l.externalId === r.externalId);
        if (!mine) {
          if (!workspace || r.status === 'ARCHIVED') continue;
          await db.adCampaign.create({
            data: {
              organizationId: account.organizationId,
              workspaceId: workspace.id,
              adAccountId: accountId,
              platform: account.platform,
              name: r.name,
              objective: r.objective,
              status: r.status,
              source: 'IMPORTED',
              budgetType: r.budgetType,
              budgetAmount: r.budgetAmount ?? '0',
              currency: account.currency,
              startAt: r.startAt ? new Date(r.startAt) : null,
              endAt: r.endAt ? new Date(r.endAt) : null,
              externalId: r.externalId,
              lastSyncedAt: new Date(),
            },
          });
          continue;
        }
        // Mirror what happened on the platform (someone paused or activated it in Ads Manager); never push changes.
        if (mine.status !== r.status && ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'].includes(mine.status)) {
          await db.adCampaign.update({ where: { id: mine.id }, data: { status: r.status, lastSyncedAt: new Date() } });
          await this.audit.record('ads.status_changed_on_platform', 'ad_campaign', mine.id, { from: mine.status, to: r.status });
        }
      }
      const tracked = await db.adCampaign.findMany({ where: { adAccountId: accountId, externalId: { not: null }, deletedAt: null }, select: { id: true, externalId: true } });
      const to = new Date();
      const from = new Date(to.getTime() - (days - 1) * 86_400_000);
      const rows = await adapter.insights(ctx, tracked.map((t) => t.externalId!), day(from), day(to));
      for (const row of rows) {
        const campaign = tracked.find((t) => t.externalId === row.campaignId);
        if (!campaign) continue;
        const data = { impressions: row.impressions, reach: row.reach, clicks: row.clicks, spend: row.spend, conversions: row.conversions, leads: row.leads };
        await db.adInsightDaily.upsert({ where: { campaignId_date: { campaignId: campaign.id, date: new Date(`${row.date}T00:00:00Z`) } }, create: { organizationId: account.organizationId, campaignId: campaign.id, date: new Date(`${row.date}T00:00:00Z`), ...data }, update: data });
      }
      await db.adCampaign.updateMany({ where: { adAccountId: accountId, externalId: { not: null } }, data: { lastSyncedAt: new Date() } });
      await db.adAccount.update({ where: { id: accountId }, data: { lastSyncedAt: new Date(), lastError: null } });
    } catch (e) {
      if (e instanceof ProviderAuthError) await this.accounts.flagReauth(account.connectionId, e.message);
      else await db.adAccount.update({ where: { id: accountId }, data: { lastError: (e as Error).message.slice(0, 500) } });
      throw e;
    }
  }
}

@Injectable()
export class AdsScheduler implements OnModuleInit {
  private readonly logger = new Logger(AdsScheduler.name);
  constructor(@InjectQueue(ADS_SYNC_QUEUE) private readonly queue: Queue<AdsJob>) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.queue.upsertJobScheduler('ads-hourly', { every: 3_600_000 }, { name: 'sync', data: { kind: 'sync', days: 3 } });
      await this.queue.upsertJobScheduler('ads-nightly', { pattern: '45 21 * * *' }, { name: 'sync', data: { kind: 'sync', days: 30 } });
    } catch (err) {
      this.logger.warn(`Could not register ads sync jobs: ${(err as Error).message}`);
    }
  }
}

@Processor(ADS_SYNC_QUEUE, { concurrency: 2 })
export class AdsProcessor extends WorkerHost {
  constructor(private readonly ads: AdsWorkerService) {
    super();
  }

  async process(job: Job<AdsJob>): Promise<void> {
    const d = job.data;
    if (d.kind === 'create') {
      const retry = await this.ads.create(d, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
      if (retry) throw new Error('Retrying ad campaign creation');
      return;
    }
    await this.ads.sync(d.organizationId, d.days ?? 3);
  }
}
