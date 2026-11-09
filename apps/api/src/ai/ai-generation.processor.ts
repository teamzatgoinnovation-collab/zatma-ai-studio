import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TenantContext } from '../common/tenant-context.js';
import { AI_QUEUE, AIService } from './ai.service.js';

/** Runs queued AI generations; each job executes inside its organization's tenant context. */
@Processor(AI_QUEUE, { concurrency: 4 })
export class AIGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(AIGenerationProcessor.name);

  constructor(private readonly ai: AIService) {
    super();
  }

  async process(job: Job<{ jobId: string; organizationId: string; userId: string | null }>): Promise<void> {
    await TenantContext.run({ organizationId: job.data.organizationId, userId: job.data.userId ?? undefined }, () => this.ai.runJob(job.data.jobId));
    this.logger.log(`AI job ${job.data.jobId} processed`);
  }
}
