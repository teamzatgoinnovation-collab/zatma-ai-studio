import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SocialModule } from '../social/social.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { PublishingController } from './publishing.controller.js';
import { PublishingService, SOCIAL_PUBLISH_QUEUE } from './publishing.service.js';
import { PublishingProcessor, PublishingScheduler, PublishingWorkerService } from './publishing.worker.js';

@Module({
  imports: [BullModule.registerQueue({ name: SOCIAL_PUBLISH_QUEUE }), SocialModule, StorageModule],
  controllers: [PublishingController],
  providers: [PublishingService, PublishingWorkerService, PublishingScheduler, PublishingProcessor],
  exports: [PublishingService],
})
export class PublishingModule {}
