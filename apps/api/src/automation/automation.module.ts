import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module.js';
import { AutomationActions } from './automation-actions.js';
import { AutomationController } from './automation.controller.js';
import { AutomationEngine } from './automation.engine.js';
import { AutomationService } from './automation.service.js';
import { AutomationEventsProcessor, AutomationRunsProcessor, AutomationScanner, AutomationScheduler } from './automation.worker.js';

@Module({
  imports: [CrmModule],
  controllers: [AutomationController],
  providers: [AutomationActions, AutomationEngine, AutomationService, AutomationScanner, AutomationScheduler, AutomationEventsProcessor, AutomationRunsProcessor],
  exports: [AutomationScanner, AutomationEngine],
})
export class AutomationModule {}
