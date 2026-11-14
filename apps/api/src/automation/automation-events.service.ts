import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { EntityType, TriggerKind } from '@zatma/validation';
import { TenantContext } from '../common/tenant-context.js';

export const AUTOMATION_EVENTS_QUEUE = 'automation-events';
export const AUTOMATION_RUNS_QUEUE = 'automation-runs';
/** A run started by an automation's own change may start another, up to this depth (0 = a person's change). */
export const MAX_AUTOMATION_DEPTH = 3;

export interface AutomationEvent {
  organizationId: string;
  kind: TriggerKind;
  entityType: EntityType;
  entityId: string;
  /** Unique per occurrence; with the workflow id it becomes the run's dedupe key. */
  eventKey: string;
  /** Small facts the trigger filters look at (never message bodies or contact details). */
  payload: Record<string, unknown>;
  /** Set when an automation's action caused this event (loop prevention). */
  origin?: { runId: string; workflowId: string; depth: number };
  /** Scanner events are for one workflow only (its own thresholds). */
  workflowId?: string;
}

export type AutomationEventsJob = { kind: 'event'; event: AutomationEvent } | { kind: 'scan' };

/**
 * Where the CRM and campaign services announce what happened. It is fire-and-forget: a queue problem is logged and
 * never fails the change that triggered it, and the event is enqueued only after the write has completed.
 */
@Injectable()
export class AutomationEventsService {
  private readonly logger = new Logger(AutomationEventsService.name);

  constructor(@InjectQueue(AUTOMATION_EVENTS_QUEUE) private readonly queue: Queue<AutomationEventsJob>) {}

  /** Never rejects. The loop-prevention origin is read from the current context. */
  async emit(e: Omit<AutomationEvent, 'eventKey' | 'payload' | 'organizationId' | 'origin'> & { organizationId?: string; eventKey?: string; payload?: Record<string, unknown> }): Promise<void> {
    const ctx = TenantContext.get();
    const organizationId = e.organizationId ?? ctx?.organizationId;
    if (!organizationId) return;
    const event: AutomationEvent = {
      ...e,
      organizationId,
      eventKey: e.eventKey ?? `${e.kind}:${e.entityId}:${randomUUID()}`,
      payload: e.payload ?? {},
      ...(ctx?.automation ? { origin: ctx.automation } : {}),
    };
    try {
      await this.queue.add('event', { kind: 'event', event }, { jobId: `ev_${event.eventKey.replace(/:/g, '_')}`, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true, removeOnFail: 100 });
    } catch (err) {
      this.logger.warn(`Could not queue automation event ${event.kind}: ${(err as Error).message}`);
    }
  }
}

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: AUTOMATION_EVENTS_QUEUE }, { name: AUTOMATION_RUNS_QUEUE })],
  providers: [AutomationEventsService],
  exports: [AutomationEventsService, BullModule],
})
export class AutomationEventsModule {}
