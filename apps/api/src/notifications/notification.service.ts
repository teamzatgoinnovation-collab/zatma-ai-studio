import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { NOTIFICATIONS_QUEUE, type NotificationJob } from './notification.types.js';

@Injectable()
export class NotificationService {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationJob>) {}

  /** Enqueues a notification for asynchronous delivery (retries with exponential backoff). */
  async enqueue(job: NotificationJob): Promise<string | undefined> {
    const added = await this.queue.add(job.type, job, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
    return added.id;
  }
}
