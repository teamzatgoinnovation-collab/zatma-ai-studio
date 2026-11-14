import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { AdsAccountsService } from '../ads/ads-accounts.service.js';
import type { PlatformLead } from '../ads/providers/ads-provider.js';
import { AuditService } from '../audit/audit.service.js';
import { UsageService } from '../billing/usage.service.js';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { CrmContext } from '../crm/crm-common.js';
import { ScoringService } from '../crm/scoring.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderAuthError } from '../social/providers/provider.js';
import { AutomationEventsService } from '../automation/automation-events.service.js';
import { CampaignsService } from './campaigns.service.js';

export const CAMPAIGNS_QUEUE = 'campaigns';
export type CampaignsJob = { kind: 'sweep' } | { kind: 'leads'; organizationId?: string };

/** Map a Meta lead form answer set onto CRM fields (standard question keys from the Graph API). */
export function mapMetaLead(f: Record<string, string>): { firstName: string; lastName: string | null; email: string | null; phone: string | null; city: string | null; company: string | null; jobTitle: string | null } {
  const full = (f.full_name ?? [f.first_name, f.last_name].filter(Boolean).join(' ')).trim();
  const [first, ...rest] = full.split(/\s+/);
  return {
    firstName: (f.first_name ?? first ?? '').slice(0, 80) || 'Meta lead',
    lastName: (f.last_name ?? (rest.join(' ') || null))?.slice(0, 80) ?? null,
    email: f.email?.trim().toLowerCase().slice(0, 254) || null,
    phone: (f.phone_number ?? f.phone)?.trim().slice(0, 40) || null,
    city: f.city?.slice(0, 80) || null,
    company: f.company_name?.slice(0, 160) || null,
    jobTitle: f.job_title?.slice(0, 120) || null,
  };
}

/**
 * Campaign background work: keep date-driven statuses current, and pull Meta lead-form submissions into the CRM
 * (read-only on the platform). Nothing here activates ads, raises budgets or publishes anything.
 */
@Injectable()
export class CampaignsWorkerService {
  private readonly logger = new Logger(CampaignsWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly accounts: AdsAccountsService,
    private readonly crm: CrmContext,
    private readonly scoring: ScoringService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly events: AutomationEventsService,
  ) {}

  sweep() {
    return this.campaigns.sweepStatuses();
  }

  async pullLeads(organizationId?: string): Promise<{ created: number }> {
    const orgs = organizationId
      ? [organizationId]
      : (await this.prisma.system.adCampaign.groupBy({ by: ['organizationId'], where: { platform: 'META', objective: 'LEADS', externalId: { not: null }, deletedAt: null } })).map((r) => r.organizationId);
    let created = 0;
    for (const org of orgs) {
      created += await TenantContext.run({ organizationId: org }, () => this.pullOrg(org)).catch((e) => {
        this.logger.warn(`Lead pull for ${org} failed: ${(e as Error).message}`);
        return 0;
      });
    }
    return { created };
  }

  private async pullOrg(organizationId: string): Promise<number> {
    const db = this.prisma.tenant;
    const campaigns = await db.adCampaign.findMany({
      where: { platform: 'META', objective: 'LEADS', externalId: { not: null }, deletedAt: null, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] }, adAccount: { status: 'ACTIVE' } },
      include: { adGroups: { include: { ads: { where: { externalId: { not: null } }, select: { externalId: true } } } } },
    });
    let created = 0;
    for (const c of campaigns) {
      const state = (c.syncState ?? {}) as Record<string, unknown>;
      const since = typeof state.leadsSince === 'string' ? new Date(state.leadsSince) : null;
      let watermark = since;
      try {
        const { adapter, ctx } = await this.accounts.ctx(c.adAccountId);
        if (!adapter.listLeads) continue;
        const leads: PlatformLead[] = [];
        for (const ad of c.adGroups.flatMap((g) => g.ads)) leads.push(...(await adapter.listLeads(ctx, ad.externalId!, since)));
        leads.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const l of leads) {
          const ok = await this.ingest(organizationId, c.marketingCampaignId, c.name, l);
          if (ok === 'limit') break; // keep the rest on Meta until the plan allows more records
          if (ok === 'created') created++;
          const at = new Date(l.createdAt);
          if (!watermark || at > watermark) watermark = at;
        }
      } catch (e) {
        if (e instanceof ProviderAuthError) {
          const acct = await db.adAccount.findFirst({ where: { id: c.adAccountId }, select: { connectionId: true } });
          if (acct) await this.accounts.flagReauth(acct.connectionId, e.message);
        }
        this.logger.warn(`Lead pull for ad campaign ${c.id} failed: ${(e as Error).message}`);
      }
      if (watermark && watermark !== since) await db.adCampaign.update({ where: { id: c.id }, data: { syncState: { ...state, leadsSince: watermark.toISOString() } as Prisma.InputJsonValue } });
    }
    return created;
  }

  /** Creates the CRM lead once (idempotent on the platform id); a person already in the CRM is not duplicated. */
  private async ingest(organizationId: string, campaignId: string | null, adName: string, l: PlatformLead): Promise<'created' | 'existing' | 'limit'> {
    const db = this.prisma.tenant;
    const externalRef = `meta:${l.externalId}`;
    if (await db.lead.findFirst({ where: { externalRef }, select: { id: true } })) return 'existing';
    const f = mapMetaLead(l.fields);
    const dups = await this.crm.findDuplicates(f.email, f.phone);
    const existing = dups.find((d) => d.type === 'lead');
    if (existing || dups.length) {
      // Same person submitted again: note it on their record and attribute the campaign if they had none (first touch).
      if (existing) {
        await db.lead.updateMany({ where: { id: existing.id, campaignId: null }, data: { campaignId } });
        await db.activity.create({ data: { organizationId, type: 'NOTE', subject: `Submitted the Meta lead form again (${adName})`, leadId: existing.id } });
      } else {
        await db.activity.create({ data: { organizationId, type: 'NOTE', subject: `Submitted a Meta lead form (${adName})`, contactId: dups[0]!.id } });
      }
      return 'existing';
    }
    try {
      await this.usage.assertWithinLimit(organizationId, 'crmRecords', 1);
    } catch (e) {
      if (e instanceof AppException && e.code === 'PLAN_LIMIT_REACHED') return 'limit';
      throw e;
    }
    const lead = await db.lead.create({
      data: {
        organizationId,
        ...f,
        source: 'meta_ads',
        sourceDetail: `Meta lead form · ${adName}`.slice(0, 200),
        campaignId,
        externalRef,
        customFields: Object.fromEntries(Object.entries(l.fields).filter(([k]) => !['full_name', 'first_name', 'last_name', 'email', 'phone_number', 'phone', 'city', 'company_name', 'job_title'].includes(k)).slice(0, 20)) as Prisma.InputJsonValue,
        createdAt: new Date(l.createdAt),
        ...(await this.crm.keys(f.email, f.phone)),
      },
    });
    await db.activity.create({ data: { organizationId, type: 'NOTE', subject: `Lead from Meta instant form (${adName})`, leadId: lead.id } });
    await this.scoring.scoreOne(lead.id).catch(() => undefined);
    await this.audit.record('campaigns.lead_imported', 'lead', lead.id, { source: 'meta_ads', campaignId });
    // The lead is scored by now, so conditions on score see it.
    void this.events.emit({ kind: 'lead.created', entityType: 'lead', entityId: lead.id, payload: { source: 'meta_ads' } });
    void this.events.emit({ kind: 'form.submitted', entityType: 'lead', entityId: lead.id, payload: { campaignId, source: 'meta_ads' } });
    if (campaignId) void this.events.emit({ kind: 'campaign.interaction', entityType: 'lead', entityId: lead.id, payload: { campaignId } });
    return 'created';
  }
}

@Injectable()
export class CampaignsScheduler implements OnModuleInit {
  private readonly logger = new Logger(CampaignsScheduler.name);
  constructor(@InjectQueue(CAMPAIGNS_QUEUE) private readonly queue: Queue<CampaignsJob>) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.queue.upsertJobScheduler('campaigns-sweep', { every: 3_600_000 }, { name: 'sweep', data: { kind: 'sweep' } });
      await this.queue.upsertJobScheduler('campaigns-leads', { every: 900_000 }, { name: 'leads', data: { kind: 'leads' } });
    } catch (err) {
      this.logger.warn(`Could not register campaign jobs: ${(err as Error).message}`);
    }
  }
}

@Processor(CAMPAIGNS_QUEUE, { concurrency: 1 })
export class CampaignsProcessor extends WorkerHost {
  constructor(private readonly jobs: CampaignsWorkerService) {
    super();
  }

  async process(job: Job<CampaignsJob>): Promise<void> {
    if (job.data.kind === 'sweep') await this.jobs.sweep();
    else await this.jobs.pullLeads(job.data.organizationId);
  }
}
