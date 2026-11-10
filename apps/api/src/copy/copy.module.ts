import { Module } from '@nestjs/common';
import { DesignModule } from '../design/design.module.js';
import { CopyAssetController, CopyController, DesignTranslationController } from './copy.controller.js';
import { CopyService } from './copy.service.js';
import { DesignTranslationService } from './design-translation.service.js';

@Module({
  imports: [DesignModule],
  controllers: [CopyController, CopyAssetController, DesignTranslationController],
  providers: [CopyService, DesignTranslationService],
  exports: [CopyService],
})
export class CopyModule {}
