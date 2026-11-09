import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EMAIL_QUEUE, type EmailMessage } from './email.types.js';

@Injectable()
export class EmailService {
  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailMessage>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Queues an email for delivery with retries. */
  async send(message: EmailMessage): Promise<void> {
    await this.queue.add(message.tag, message, {
      attempts: 6,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 14 * 24 * 3600 },
    });
  }

  /**
   * Better Auth builds links on the API origin. The web app proxies `/api/*`, so links are rewritten
   * to the public web URL, keeping users on one domain.
   */
  publicLink(url: string): string {
    const parsed = new URL(url);
    return `${this.env.WEB_URL}${parsed.pathname}${parsed.search}`;
  }

  webUrl(path: string): string {
    return `${this.env.WEB_URL}${path.startsWith('/') ? path : `/${path}`}`;
  }
}
