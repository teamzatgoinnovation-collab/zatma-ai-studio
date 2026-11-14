import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CopyModule } from '../copy/copy.module.js';
import { SocialModule } from '../social/social.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AdsAccountsService } from './ads-accounts.service.js';
import { AdsController, AdsOAuthController } from './ads.controller.js';
import { AdsRegistry } from './ads-registry.js';
import { ADS_SYNC_QUEUE, AdsService } from './ads.service.js';
import { AdsProcessor, AdsScheduler, AdsWorkerService } from './ads.worker.js';

@Module({
  imports: [BullModule.registerQueue({ name: ADS_SYNC_QUEUE }), SocialModule, StorageModule, CopyModule],
  controllers: [AdsController, AdsOAuthController],
  providers: [AdsRegistry, AdsAccountsService, AdsService, AdsWorkerService, AdsScheduler, AdsProcessor],
  exports: [AdsService, AdsAccountsService],
})
export class AdsModule {}
