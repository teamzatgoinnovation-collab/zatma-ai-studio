import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MetaCallbacksController, SOCIAL_HEALTH_QUEUE, SocialController, SocialHealthProcessor, SocialHealthScheduler, SocialOAuthController } from './social.controller.js';
import { OAuthStateStore, SocialProviderRegistry } from './social-registry.js';
import { SocialService } from './social.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: SOCIAL_HEALTH_QUEUE })],
  controllers: [SocialController, SocialOAuthController, MetaCallbacksController],
  providers: [SocialProviderRegistry, OAuthStateStore, SocialService, SocialHealthScheduler, SocialHealthProcessor],
  exports: [SocialService, SocialProviderRegistry],
})
export class SocialModule {}
