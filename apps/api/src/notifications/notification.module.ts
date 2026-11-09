import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { NotificationProcessor } from './notification.processor.js';
import { NotificationService } from './notification.service.js';
import { NOTIFICATIONS_QUEUE } from './notification.types.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { url: env.REDIS_URL },
        prefix: env.NODE_ENV === 'test' ? 'zatma-test' : 'zatma',
      }),
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  providers: [NotificationService, NotificationProcessor],
  exports: [NotificationService],
})
export class NotificationModule {}
