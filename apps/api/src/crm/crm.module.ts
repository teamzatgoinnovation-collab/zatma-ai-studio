import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ActivitiesService } from './activities.service.js';
import { CrmContext } from './crm-common.js';
import {
  ActivitiesController,
  CompaniesController,
  ContactsController,
  CrmSummaryController,
  CrmSummaryService,
  CustomersController,
  DealsController,
  FollowUpsController,
  ImportController,
  LeadsController,
  PipelinesController,
} from './crm.controller.js';
import { CRM_IMPORT_QUEUE, CrmImportProcessor, CrmImportRunner, CrmImportService } from './import.service.js';
import { LeadsService } from './leads.service.js';
import { PipelineService } from './pipeline.service.js';
import { CompaniesService, ContactsService } from './records.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: CRM_IMPORT_QUEUE })],
  controllers: [
    CrmSummaryController,
    LeadsController,
    ContactsController,
    CustomersController,
    CompaniesController,
    PipelinesController,
    DealsController,
    ActivitiesController,
    FollowUpsController,
    ImportController,
  ],
  providers: [CrmContext, LeadsService, ContactsService, CompaniesService, PipelineService, ActivitiesService, CrmImportService, CrmImportRunner, CrmImportProcessor, CrmSummaryService],
})
export class CrmModule {}
