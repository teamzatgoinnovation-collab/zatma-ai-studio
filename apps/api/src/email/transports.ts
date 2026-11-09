import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { CapturedEmail, EmailMessage, EmailTransport } from './email.types.js';

/** Production transport: Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendTransport implements EmailTransport {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: 'category', value: message.tag.replace(/[^a-zA-Z0-9_-]/g, '_') }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      // 4xx (except 429) are permanent; BullMQ will still retry, but the error tells operators why.
      throw new Error(`Resend responded ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }
}

const CAPTURE_KEY = 'zatma:dev:emails';
const CAPTURE_LIMIT = 200;

/** Development/test transport: stores emails in Redis so they can be read from the dev mailbox. Never used in production. */
export class CaptureTransport implements EmailTransport {
  readonly name = 'capture';
  private readonly logger = new Logger('CaptureTransport');

  constructor(private readonly redis: Redis) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const captured: CapturedEmail = { ...message, id: randomUUID(), sentAt: new Date().toISOString() };
    await this.redis.multi().lpush(CAPTURE_KEY, JSON.stringify(captured)).ltrim(CAPTURE_KEY, 0, CAPTURE_LIMIT - 1).exec();
    this.logger.log(`[dev mailbox] "${message.subject}" → ${message.to}`);
    return { id: captured.id };
  }

  async list(to?: string): Promise<CapturedEmail[]> {
    const raw = await this.redis.lrange(CAPTURE_KEY, 0, CAPTURE_LIMIT - 1);
    const all = raw.map((r) => JSON.parse(r) as CapturedEmail);
    return to ? all.filter((e) => e.to.toLowerCase() === to.toLowerCase()) : all;
  }
}
