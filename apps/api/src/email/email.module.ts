import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { REDIS } from '../redis/redis.module.js';
import { EmailProcessor } from './email.processor.js';
import { EmailService } from './email.service.js';
import { EMAIL_QUEUE, EMAIL_TRANSPORT } from './email.types.js';
import { CaptureTransport, ResendTransport } from './transports.js';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [
    EmailService,
    EmailProcessor,
    {
      provide: EMAIL_TRANSPORT,
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) =>
        env.EMAIL_TRANSPORT === 'resend' ? new ResendTransport(env.RESEND_API_KEY as string, env.EMAIL_FROM) : new CaptureTransport(redis),
    },
  ],
  exports: [EmailService, EMAIL_TRANSPORT],
})
export class EmailModule {}
