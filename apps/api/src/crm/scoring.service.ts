import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { resolveScoringSettings, scoreLead, type LeadScoreDto, type ScoringSettings } from '@zatma/validation';
import { notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ownerScope } from './crm-common.js';

export const CRM_SCORING_QUEUE = 'crm-scoring';
const BATCH = 200;
type ScoringJob = { organizationId: string } | { nightly: true };

/**
 * Deterministic, explainable lead scores (see `scoreLead` in @zatma/validation).
 * Scores are refreshed whenever a lead or its activities change, nightly (recency decay),
 * and on demand after the organization changes its scoring settings.
 */
@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(organizationId = TenantContext.requireOrganizationId()): Promise<ScoringSettings> {
    const org = await this.prisma.system.organization.findUnique({ where: { id: organizationId }, select: { crmSettings: true } });
    return resolveScoringSettings((org?.crmSettings as { scoring?: unknown } | null)?.scoring);
  }

  async updateSettings(input: ScoringSettings): Promise<ScoringSettings> {
    const organizationId = TenantContext.requireOrganizationId();
    const org = await this.prisma.system.organization.findUnique({ where: { id: organizationId }, select: { crmSettings: true } });
    const crmSettings = { ...((org?.crmSettings as Record<string, unknown> | null) ?? {}), scoring: input };
    await this.prisma.system.organization.update({ where: { id: organizationId }, data: { crmSettings: crmSettings as Prisma.InputJsonValue } });
    return input;
  }

  /** Rescores one lead of the active organization. Returns null when the lead is gone. */
  async scoreOne(leadId: string, settings?: ScoringSettings, now = new Date()): Promise<LeadScoreDto | null> {
    const db = this.prisma.tenant;
    const lead = await db.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: { activities: { where: { deletedAt: null }, select: { type: true, createdAt: true, dueAt: true, completedAt: true } } },
    });
    if (!lead) return null;
    const result = scoreLead(lead, settings ?? (await this.settings(lead.organizationId)), now);
    await db.lead.update({
      where: { id: leadId },
      data: { score: result.score, scoreGrade: result.grade, scoreReason: result.reason || null, scoreBreakdown: result.signals as unknown as Prisma.InputJsonValue, scoredAt: now },
    });
    return { ...result, scoredAt: now.toISOString() };
  }

  /** Full breakdown for a lead the current user can see (recomputed so it reflects today). */
  async breakdown(leadId: string): Promise<LeadScoreDto> {
    const visible = await this.prisma.tenant.lead.findFirst({ where: { id: leadId, deletedAt: null, ...ownerScope() }, select: { id: true } });
    if (!visible) throw notFound('Lead');
    return (await this.scoreOne(leadId))!;
  }

  /** Rescores every lead of an organization in batches (inside that organization's tenant context). */
  async rescoreOrganization(organizationId: string): Promise<number> {
    return TenantContext.run({ organizationId }, async () => {
      const settings = await this.settings(organizationId);
      const now = new Date();
      let cursor: string | undefined;
      let count = 0;
      for (;;) {
        const ids = await this.prisma.tenant.lead.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (ids.length === 0) break;
        for (const { id } of ids) {
          await this.scoreOne(id, settings, now);
          count++;
        }
        cursor = ids[ids.length - 1]!.id;
      }
      return count;
    });
  }
}

@Injectable()
export class ScoringScheduler implements OnModuleInit {
  private readonly logger = new Logger(ScoringScheduler.name);

  constructor(@InjectQueue(CRM_SCORING_QUEUE) private readonly queue: Queue<ScoringJob>) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    // Nightly refresh so recency decay and overdue follow-ups are reflected without user activity.
    try {
      await this.queue.upsertJobScheduler('nightly-rescore', { pattern: '30 21 * * *' }, { name: 'nightly', data: { nightly: true } });
    } catch (err) {
      this.logger.warn(`Could not register the nightly rescore: ${(err as Error).message}`);
    }
  }

  async enqueue(organizationId: string): Promise<void> {
    await this.queue.add('rescore', { organizationId }, { jobId: `rescore-${organizationId}-${Date.now()}`, removeOnComplete: 50, removeOnFail: 50 });
  }
}

@Processor(CRM_SCORING_QUEUE, { concurrency: 1 })
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    private readonly scoring: ScoringService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<ScoringJob>): Promise<{ scored: number }> {
    if ('organizationId' in job.data) return { scored: await this.scoring.rescoreOrganization(job.data.organizationId) };
    const orgs = await this.prisma.system.lead.groupBy({ by: ['organizationId'], where: { deletedAt: null } });
    let scored = 0;
    for (const o of orgs) scored += await this.scoring.rescoreOrganization(o.organizationId);
    this.logger.log(`Nightly rescore: ${scored} leads in ${orgs.length} organizations`);
    return { scored };
  }
}
