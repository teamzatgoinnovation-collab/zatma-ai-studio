import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BrandKitService } from './brand-kit.service.js';
import { BrandKitController, DesignController, TemplateController } from './design.controller.js';
import { DesignGenerationProcessor, DesignGenerationService } from './design-generation.service.js';
import { DESIGN_QUEUE, DesignService } from './design.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: DESIGN_QUEUE })],
  controllers: [BrandKitController, DesignController, TemplateController],
  providers: [BrandKitService, DesignService, DesignGenerationService, DesignGenerationProcessor],
  exports: [DesignService, BrandKitService],
})
export class DesignModule {}
