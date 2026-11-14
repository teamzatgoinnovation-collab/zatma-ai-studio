import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdsModule } from '../ads/ads.module.js';
import { CopyModule } from '../copy/copy.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { PublishingModule } from '../publishing/publishing.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { CampaignAssetsService } from './campaign-assets.service.js';
import { CampaignInsightsService } from './campaign-insights.service.js';
import { CampaignTrackingService } from './campaign-tracking.service.js';
import { CampaignsController, TrackedLinkRedirectController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { CAMPAIGNS_QUEUE, CampaignsProcessor, CampaignsScheduler, CampaignsWorkerService } from './campaigns.worker.js';

@Module({
  imports: [BullModule.registerQueue({ name: CAMPAIGNS_QUEUE }), AdsModule, PublishingModule, CrmModule, CopyModule, StorageModule],
  controllers: [CampaignsController, TrackedLinkRedirectController],
  providers: [CampaignsService, CampaignInsightsService, CampaignAssetsService, CampaignTrackingService, CampaignsWorkerService, CampaignsScheduler, CampaignsProcessor],
  exports: [CampaignsService],
})
export class CampaignsModule {}
