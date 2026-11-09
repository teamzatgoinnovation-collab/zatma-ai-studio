import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EMAIL_QUEUE, EMAIL_TRANSPORT, type EmailMessage, type EmailTransport } from './email.types.js';

@Processor(EMAIL_QUEUE, { concurrency: 5, limiter: { max: 10, duration: 1000 } })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(@Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport) {
    super();
  }

  async process(job: Job<EmailMessage>): Promise<{ id: string; transport: string }> {
    const result = await this.transport.send(job.data);
    this.logger.log(`Sent "${job.data.tag}" email via ${this.transport.name} (job ${job.id})`);
    return { ...result, transport: this.transport.name };
  }
}
