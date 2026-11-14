import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { parseNodeConfig, type WorkflowGraph } from '@zatma/validation';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AutomationEngine, type RunJob } from './automation.engine.js';
import { AUTOMATION_EVENTS_QUEUE, AUTOMATION_RUNS_QUEUE, AutomationEventsService, type AutomationEventsJob } from './automation-events.service.js';

const DAY = 86_400_000;

/**
 * Hourly look for the two time-based triggers, follow-ups that are overdue and customers gone quiet. Each is emitted
 * for the one workflow whose threshold it met, once per occurrence (the key includes the due date or last contact).
 */
@Injectable()
export class AutomationScanner {
  private readonly logger = new Logger(AutomationScanner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AutomationEventsService,
  ) {}

  async scan(organizationId?: string): Promise<number> {
    const workflows = await this.prisma.system.automationWorkflow.findMany({
      where: { status: 'ACTIVE', deletedAt: null, triggerKind: { in: ['activity.followup_overdue', 'contact.inactive'] }, ...(organizationId ? { organizationId } : {}) },
    });
    let emitted = 0;
    for (const wf of workflows) {
      emitted += await TenantContext.run({ organizationId: wf.organizationId }, () => this.scanWorkflow(wf).catch((e) => (this.logger.warn(`Scan for ${wf.id} failed: ${(e as Error).message}`), 0)));
    }
    return emitted;
  }

  private async scanWorkflow(wf: { id: string; organizationId: string; triggerKind: string | null; graph: unknown }): Promise<number> {
    const db = this.prisma.tenant;
    const trigger = (wf.graph as WorkflowGraph).nodes.find((n) => n.type === 'trigger');
    const parsed = trigger ? parseNodeConfig('trigger', trigger.kind, trigger.config) : null;
    if (!parsed?.ok) return 0;
    const now = Date.now();
    let candidates: Array<{ id: string; key: string; entityType: 'activity' | 'contact' }>;
    if (wf.triggerKind === 'activity.followup_overdue') {
      const grace = (parsed.config.graceHours as number) * 3_600_000;
      // Only recent lapses: very old overdue tasks are not worth waking an automation for.
      const rows = await db.activity.findMany({ where: { deletedAt: null, completedAt: null, type: { in: ['TASK', 'FOLLOW_UP', 'CALL'] }, dueAt: { gte: new Date(now - 14 * DAY), lt: new Date(now - grace) } }, orderBy: { dueAt: 'asc' }, take: 500, select: { id: true, dueAt: true } });
      candidates = rows.map((r) => ({ id: r.id, key: `activity.followup_overdue:${r.id}:${r.dueAt!.getTime()}`, entityType: 'activity' }));
    } else {
      const cutoff = new Date(now - (parsed.config.days as number) * DAY);
      const rows = await db.contact.findMany({
        where: { deletedAt: null, lifecycle: 'CUSTOMER', OR: [{ lastContactedAt: { lt: cutoff } }, { lastContactedAt: null, createdAt: { lt: cutoff } }] },
        orderBy: { lastContactedAt: { sort: 'asc', nulls: 'first' } },
        take: 500,
        select: { id: true, lastContactedAt: true },
      });
      candidates = rows.map((r) => ({ id: r.id, key: `contact.inactive:${r.id}:${r.lastContactedAt?.getTime() ?? 'never'}`, entityType: 'contact' }));
    }
    if (!candidates.length) return 0;
    const seen = new Set((await db.automationRun.findMany({ where: { workflowId: wf.id, dedupeKey: { in: candidates.map((c) => c.key) } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey));
    const fresh = candidates.filter((c) => !seen.has(c.key));
    for (const c of fresh) await this.events.emit({ organizationId: wf.organizationId, kind: wf.triggerKind as 'contact.inactive', entityType: c.entityType, entityId: c.id, eventKey: c.key, workflowId: wf.id });
    return fresh.length;
  }
}

@Injectable()
export class AutomationScheduler implements OnModuleInit {
  private readonly logger = new Logger(AutomationScheduler.name);
  constructor(@InjectQueue(AUTOMATION_EVENTS_QUEUE) private readonly queue: Queue<AutomationEventsJob>) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.queue.upsertJobScheduler('automation-scan', { every: 3_600_000 }, { name: 'scan', data: { kind: 'scan' } });
    } catch (err) {
      this.logger.warn(`Could not register the automation scan: ${(err as Error).message}`);
    }
  }
}

@Processor(AUTOMATION_EVENTS_QUEUE, { concurrency: 4 })
export class AutomationEventsProcessor extends WorkerHost {
  constructor(
    private readonly engine: AutomationEngine,
    private readonly scanner: AutomationScanner,
  ) {
    super();
  }

  async process(job: Job<AutomationEventsJob>): Promise<void> {
    if (job.data.kind === 'scan') await this.scanner.scan();
    else await this.engine.dispatch(job.data.event);
  }
}

@Processor(AUTOMATION_RUNS_QUEUE, { concurrency: 4 })
export class AutomationRunsProcessor extends WorkerHost {
  constructor(private readonly engine: AutomationEngine) {
    super();
  }

  async process(job: Job<RunJob>): Promise<void> {
    const result = await this.engine.execute(job.data.runId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
    if (result === 'retry') throw new Error('Retrying automation step');
  }
}
