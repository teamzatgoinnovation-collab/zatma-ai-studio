import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TenantContext } from '../common/tenant-context.js';
import { NOTIFICATIONS_QUEUE, type NotificationJob } from './notification.types.js';

/**
 * Phase 1: the delivery pipeline (queue → worker → tenant-scoped execution) is in place.
 * Channel delivery (in-app records, email, push) is added in Phase 2 (email) and Phase 18 (in-app/push).
 */
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 5 })
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  async process(job: Job<NotificationJob>): Promise<{ deliveredChannels: string[] }> {
    return TenantContext.run({ organizationId: job.data.organizationId, userId: job.data.userId }, async () => {
      this.logger.log(`Processed notification ${job.data.type} for org ${job.data.organizationId} (job ${job.id})`);
      return { deliveredChannels: ['log'] };
    });
  }
}
