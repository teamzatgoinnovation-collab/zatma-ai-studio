import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { BillingService } from './billing.service.js';

export const BILLING_QUEUE = 'billing';

/** Hourly housekeeping: trial reminders/expiry and grace-period expiry. */
@Processor(BILLING_QUEUE)
export class BillingMaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingMaintenanceProcessor.name);

  constructor(
    private readonly billing: BillingService,
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.upsertJobScheduler('billing-maintenance', { every: 60 * 60 * 1000 }, { name: 'maintenance' });
  }

  async process(_job: Job): Promise<unknown> {
    const result = await this.billing.runMaintenance();
    this.logger.log(`Billing maintenance: ${JSON.stringify(result)}`);
    return result;
  }
}
