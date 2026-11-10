import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  boardQuerySchema,
  bulkLeadsSchema,
  convertLeadSchema,
  createActivitySchema,
  createCompanySchema,
  createContactSchema,
  createDealSchema,
  createLeadSchema,
  createPipelineSchema,
  createStageSchema,
  deleteStageSchema,
  followUpsQuerySchema,
  importPreviewSchema,
  importSchema,
  LEAD_STATUSES,
  listActivitiesSchema,
  listCompaniesSchema,
  listContactsSchema,
  listDealsSchema,
  listLeadsSchema,
  moveDealSchema,
  reorderStagesSchema,
  toCsv,
  updateActivitySchema,
  updateCompanySchema,
  updateContactSchema,
  updateDealSchema,
  updateLeadSchema,
  updatePipelineSchema,
  updateStageSchema,
  type BulkLeadsInput,
  type ConvertLeadInput,
  type CreateActivityInput,
  type CreateCompanyInput,
  type CreateContactInput,
  type CreateDealInput,
  type CreateLeadInput,
  type CreatePipelineInput,
  type CrmSummary,
  type FollowUpsQuery,
  type ImportInput,
  type LeadStatus,
  type ListActivitiesInput,
  type ListCompaniesInput,
  type ListContactsInput,
  type ListDealsInput,
  type ListLeadsInput,
  type MoveDealInput,
  type UpdateActivityInput,
  type UpdateCompanyInput,
  type UpdateContactInput,
  type UpdateDealInput,
  type UpdateLeadInput,
} from '@zatma/validation';
import {
  draftMessageSchema,
  leadInsightsRequestSchema,
  scoringSettingsSchema,
  type DraftMessageInput,
  type ScoringSettings,
} from '@zatma/validation';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { TenantContext } from '../common/tenant-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivitiesService, startOfDayInZone } from './activities.service.js';
import { CrmContext, currentUserId, ownerScope } from './crm-common.js';
import { CrmAiService } from './crm-ai.service.js';
import { CrmImportService } from './import.service.js';
import { ScoringScheduler, ScoringService } from './scoring.service.js';
import { LeadsService } from './leads.service.js';
import { PipelineService } from './pipeline.service.js';
import { CompaniesService, ContactsService } from './records.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const EXPORT_CAP = 10_000;
const AI_THROTTLE = { default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 20), ttl: 60_000 } };
const exportQuery = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
const attachment = (name: string) => `attachment; filename="${name}.csv"`;
const day = (d: string | null) => (d ? d.slice(0, 10) : '');

// ───────────── Leads ─────────────

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly crm: CrmContext,
    private readonly activities: ActivitiesService,
    private readonly scoring: ScoringService,
    private readonly ai: CrmAiService,
  ) {}

  @Get()
  @RequirePermissions('crm:read')
  list(@Query(new ZodValidationPipe(listLeadsSchema)) q: ListLeadsInput) {
    return this.leads.list(q);
  }

  @Get('duplicates')
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Leads/contacts with the same email or phone (for forms)' })
  duplicates(@Query(new ZodValidationPipe(z.object({ email: z.string().max(254).optional(), phone: z.string().max(40).optional(), excludeLeadId: z.uuid().optional(), excludeContactId: z.uuid().optional() }))) q: { email?: string; phone?: string; excludeLeadId?: string; excludeContactId?: string }) {
    return this.crm.findDuplicates(q.email, q.phone, { leadId: q.excludeLeadId, contactId: q.excludeContactId });
  }

  @Get('export.csv')
  @RequirePermissions('crm:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', attachment('leads'))
  async export(@Query(exportQuery(listLeadsSchema)) q: ListLeadsInput) {
    const rows = await this.leads.listAll(q, EXPORT_CAP);
    return toCsv(
      ['First name', 'Last name', 'Email', 'Phone', 'WhatsApp', 'Company', 'Job title', 'Status', 'Source', 'City', 'Country', 'Tags', 'Owner', 'Last contacted', 'Next follow-up', 'Created'],
      rows.map((l) => [l.firstName, l.lastName, l.email, l.phone, l.whatsapp, l.company, l.jobTitle, l.status, l.source, l.city, l.country, l.tags, l.owner?.name, day(l.lastContactedAt), day(l.nextFollowUpAt), day(l.createdAt)]),
    );
  }

  @Post()
  @RequirePermissions('crm:write')
  @Audit('lead.created', 'lead', 'response')
  create(@Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadInput) {
    return this.leads.create(body);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('crm:write')
  @Audit('lead.bulk_updated', 'lead')
  bulk(@Body(new ZodValidationPipe(bulkLeadsSchema)) body: BulkLeadsInput) {
    return this.leads.bulk(body);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  get(@Param('id', uuid) id: string) {
    return this.leads.get(id);
  }

  @Get(':id/timeline')
  @RequirePermissions('crm:read')
  timeline(@Param('id', uuid) id: string) {
    return this.activities.leadTimeline(id);
  }

  @Get(':id/score')
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Explainable score: every signal with its points and reason' })
  score(@Param('id', uuid) id: string) {
    return this.scoring.breakdown(id);
  }

  @Get(':id/insights')
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Last generated AI insights (or null)' })
  cachedInsights(@Param('id', uuid) id: string) {
    return this.ai.cachedInsights(id).then((i) => ({ insights: i }));
  }

  @Post(':id/insights')
  @Throttle(AI_THROTTLE)
  @RequirePermissions('crm:write', 'ai:generate')
  @ApiOperation({ summary: 'Generate AI insights: summary, next best action, talking points, drafted message (uses credits)' })
  insights(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(leadInsightsRequestSchema)) body: { language?: string }) {
    return this.ai.leadInsights(id, body.language);
  }

  @Patch(':id')
  @RequirePermissions('crm:write')
  @Audit('lead.updated', 'lead')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadInput) {
    return this.leads.update(id, body);
  }

  @Post(':id/convert')
  @RequirePermissions('crm:write')
  @Audit('lead.converted', 'lead')
  @ApiOperation({ summary: 'Convert a lead into a contact (+ company, + deal)' })
  convert(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(convertLeadSchema)) body: ConvertLeadInput) {
    return this.leads.convert(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('crm:delete')
  @Audit('lead.deleted', 'lead')
  remove(@Param('id', uuid) id: string) {
    return this.leads.remove(id);
  }
}

// ───────────── Contacts & customers ─────────────

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/contacts')
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly ai: CrmAiService,
  ) {}

  @Post(':id/draft-message')
  @HttpCode(HttpStatus.OK)
  @Throttle(AI_THROTTLE)
  @RequirePermissions('crm:write', 'ai:generate')
  @ApiOperation({ summary: 'AI-drafted WhatsApp, email or SMS message for a contact (uses credits; not sent)' })
  draft(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(draftMessageSchema)) body: DraftMessageInput) {
    return this.ai.draftContactMessage(id, body);
  }

  @Get()
  @RequirePermissions('crm:read')
  list(@Query(new ZodValidationPipe(listContactsSchema)) q: ListContactsInput) {
    return this.contacts.list(q);
  }

  @Get('export.csv')
  @RequirePermissions('crm:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', attachment('contacts'))
  async export(@Query(exportQuery(listContactsSchema)) q: ListContactsInput) {
    const rows = (await this.contacts.list({ ...q, page: 1, pageSize: EXPORT_CAP } as ListContactsInput)).data;
    return toCsv(
      ['First name', 'Last name', 'Email', 'Phone', 'WhatsApp', 'Company', 'Job title', 'Lifecycle', 'Source', 'Tags', 'Owner', 'Won value', 'Created'],
      rows.map((c) => [c.firstName, c.lastName, c.email, c.phone, c.whatsapp, c.companyName, c.jobTitle, c.lifecycle, c.source, c.tags, c.owner?.name, c.wonValue, day(c.createdAt)]),
    );
  }

  @Post()
  @RequirePermissions('crm:write')
  @Audit('contact.created', 'contact', 'response')
  create(@Body(new ZodValidationPipe(createContactSchema)) body: CreateContactInput) {
    return this.contacts.create(body);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  get(@Param('id', uuid) id: string) {
    return this.contacts.get(id);
  }

  @Get(':id/timeline')
  @RequirePermissions('crm:read')
  timeline(@Param('id', uuid) id: string) {
    return this.contacts.timeline(id);
  }

  @Patch(':id')
  @RequirePermissions('crm:write')
  @Audit('contact.updated', 'contact')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactInput) {
    return this.contacts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('crm:delete')
  @Audit('contact.deleted', 'contact')
  remove(@Param('id', uuid) id: string) {
    return this.contacts.remove(id);
  }
}

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/customers')
export class CustomersController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Contacts with lifecycle CUSTOMER, with lifetime won value' })
  list(@Query(new ZodValidationPipe(listContactsSchema)) q: ListContactsInput) {
    return this.contacts.list({ ...q, lifecycle: 'CUSTOMER' });
  }
}

// ───────────── Companies ─────────────

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions('crm:read')
  list(@Query(new ZodValidationPipe(listCompaniesSchema)) q: ListCompaniesInput) {
    return this.companies.list(q);
  }

  @Get('export.csv')
  @RequirePermissions('crm:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', attachment('companies'))
  async export(@Query(exportQuery(listCompaniesSchema)) q: ListCompaniesInput) {
    const rows = (await this.companies.list({ ...q, page: 1, pageSize: EXPORT_CAP } as ListCompaniesInput)).data;
    return toCsv(
      ['Name', 'Website', 'Industry', 'Size', 'Phone', 'Email', 'City', 'Country', 'Tags', 'Owner', 'Contacts', 'Deals', 'Created'],
      rows.map((c) => [c.name, c.website, c.industry, c.size, c.phone, c.email, c.city, c.country, c.tags, c.owner?.name, c.contactCount, c.dealCount, day(c.createdAt)]),
    );
  }

  @Post()
  @RequirePermissions('crm:write')
  @Audit('company.created', 'company', 'response')
  create(@Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompanyInput) {
    return this.companies.create(body);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  get(@Param('id', uuid) id: string) {
    return this.companies.get(id);
  }

  @Get(':id/timeline')
  @RequirePermissions('crm:read')
  timeline(@Param('id', uuid) id: string) {
    return this.companies.timeline(id);
  }

  @Patch(':id')
  @RequirePermissions('crm:write')
  @Audit('company.updated', 'company')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompanyInput) {
    return this.companies.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('crm:delete')
  @Audit('company.deleted', 'company')
  remove(@Param('id', uuid) id: string) {
    return this.companies.remove(id);
  }
}

// ───────────── Pipelines & deals ─────────────

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelineService) {}

  @Get()
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Pipelines with stages (the default pipeline is created on first use)' })
  list() {
    return this.pipelines.list();
  }

  @Post()
  @RequirePermissions('crm:delete')
  @Audit('pipeline.created', 'pipeline', 'response')
  create(@Body(new ZodValidationPipe(createPipelineSchema)) body: CreatePipelineInput) {
    return this.pipelines.create(body);
  }

  @Get(':id/board')
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Kanban board: stages with deals, counts and value totals' })
  board(@Param('id', uuid) id: string, @Query(new ZodValidationPipe(boardQuerySchema)) q: { ownerId?: string; q?: string }) {
    return this.pipelines.board(id, q);
  }

  @Patch(':id')
  @RequirePermissions('crm:delete')
  @Audit('pipeline.updated', 'pipeline')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updatePipelineSchema)) body: { name?: string; isDefault?: true }) {
    return this.pipelines.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('crm:delete')
  @Audit('pipeline.deleted', 'pipeline')
  remove(@Param('id', uuid) id: string) {
    return this.pipelines.remove(id);
  }

  @Post(':id/stages')
  @RequirePermissions('crm:delete')
  addStage(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(createStageSchema)) body: z.infer<typeof createStageSchema>) {
    return this.pipelines.addStage(id, body);
  }

  @Post(':id/stages/reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('crm:delete')
  reorder(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(reorderStagesSchema)) body: { stageIds: string[] }) {
    return this.pipelines.reorderStages(id, body.stageIds);
  }

  @Patch(':id/stages/:stageId')
  @RequirePermissions('crm:delete')
  updateStage(@Param('id', uuid) id: string, @Param('stageId', uuid) stageId: string, @Body(new ZodValidationPipe(updateStageSchema)) body: z.infer<typeof updateStageSchema>) {
    return this.pipelines.updateStage(id, stageId, body);
  }

  @Delete(':id/stages/:stageId')
  @RequirePermissions('crm:delete')
  removeStage(@Param('id', uuid) id: string, @Param('stageId', uuid) stageId: string, @Query(new ZodValidationPipe(deleteStageSchema)) q: { moveDealsTo?: string }) {
    return this.pipelines.removeStage(id, stageId, q.moveDealsTo);
  }
}

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/deals')
export class DealsController {
  constructor(
    private readonly pipelines: PipelineService,
    private readonly activities: ActivitiesService,
  ) {}

  @Get()
  @RequirePermissions('crm:read')
  list(@Query(new ZodValidationPipe(listDealsSchema)) q: ListDealsInput) {
    return this.pipelines.listDeals(q);
  }

  @Get('export.csv')
  @RequirePermissions('crm:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', attachment('deals'))
  async export(@Query(exportQuery(listDealsSchema)) q: ListDealsInput) {
    const rows = (await this.pipelines.listDeals({ ...q, page: 1, pageSize: EXPORT_CAP } as ListDealsInput)).data;
    return toCsv(
      ['Name', 'Value', 'Currency', 'Stage', 'Status', 'Probability', 'Expected close', 'Contact', 'Company', 'Owner', 'Lost reason', 'Created'],
      rows.map((d) => [d.name, d.value, d.currency, d.stageName, d.status, d.probability, day(d.expectedCloseAt), d.contact?.name, d.company?.name, d.owner?.name, d.lostReason, day(d.createdAt)]),
    );
  }

  @Post()
  @RequirePermissions('crm:write')
  @Audit('deal.created', 'deal', 'response')
  create(@Body(new ZodValidationPipe(createDealSchema)) body: CreateDealInput) {
    return this.pipelines.createDeal(body);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  get(@Param('id', uuid) id: string) {
    return this.pipelines.getDeal(id);
  }

  @Get(':id/timeline')
  @RequirePermissions('crm:read')
  timeline(@Param('id', uuid) id: string) {
    return this.activities.dealTimeline(id);
  }

  @Patch(':id')
  @RequirePermissions('crm:write')
  @Audit('deal.updated', 'deal')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateDealSchema)) body: UpdateDealInput) {
    return this.pipelines.updateDeal(id, body);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('crm:write')
  @Audit('deal.moved', 'deal')
  @ApiOperation({ summary: 'Move a deal to a stage/position (won/lost stages close the deal)' })
  move(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(moveDealSchema)) body: MoveDealInput) {
    return this.pipelines.moveDeal(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('crm:delete')
  @Audit('deal.deleted', 'deal')
  remove(@Param('id', uuid) id: string) {
    return this.pipelines.removeDeal(id);
  }
}

// ───────────── Activities & follow-ups ─────────────

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions('crm:read')
  list(@Query(new ZodValidationPipe(listActivitiesSchema)) q: ListActivitiesInput) {
    return this.activities.list(q);
  }

  @Post()
  @RequirePermissions('crm:write')
  @Audit('activity.created', 'activity', 'response')
  create(@Body(new ZodValidationPipe(createActivitySchema)) body: CreateActivityInput) {
    return this.activities.create(body);
  }

  @Patch(':id')
  @RequirePermissions('crm:write')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateActivitySchema)) body: UpdateActivityInput) {
    return this.activities.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('crm:write')
  @Audit('activity.deleted', 'activity')
  remove(@Param('id', uuid) id: string) {
    return this.activities.remove(id);
  }
}

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/follow-ups')
export class FollowUpsController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Open tasks and follow-ups by due date (overdue, today, this week, all)' })
  list(@Query(new ZodValidationPipe(followUpsQuerySchema)) q: FollowUpsQuery) {
    return this.activities.followUps(q);
  }
}

// ───────────── Import & summary ─────────────

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/import')
export class ImportController {
  constructor(private readonly imports: CrmImportService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('crm:write')
  preview(@Body(new ZodValidationPipe(importPreviewSchema)) body: { fileId: string; entity: ImportInput['entity'] }) {
    return this.imports.preview(body.fileId, body.entity);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('crm:write')
  @Audit('crm.import_started', 'crm_import', 'response')
  start(@Body(new ZodValidationPipe(importSchema)) body: ImportInput) {
    return this.imports.start(body);
  }

  @Get(':id')
  @RequirePermissions('crm:read')
  status(@Param('id', uuid) id: string) {
    return this.imports.status(id);
  }
}

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm/scoring')
export class ScoringController {
  constructor(
    private readonly scoring: ScoringService,
    private readonly scheduler: ScoringScheduler,
  ) {}

  @Get('settings')
  @RequirePermissions('crm:read')
  settings() {
    return this.scoring.settings();
  }

  @Patch('settings')
  @RequirePermissions('crm:delete')
  @Audit('crm.scoring_updated', 'organization')
  @ApiOperation({ summary: 'Update scoring weights, targets and thresholds (then recalculate)' })
  update(@Body(new ZodValidationPipe(scoringSettingsSchema)) body: ScoringSettings) {
    return this.scoring.updateSettings(body);
  }

  @Post('recalculate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('crm:delete')
  @Audit('crm.scoring_recalculated', 'organization')
  async recalculate() {
    await this.scheduler.enqueue(TenantContext.requireOrganizationId());
    return { queued: true };
  }
}

@Injectable()
export class CrmSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmContext,
  ) {}

  async summary(): Promise<CrmSummary> {
    const db = this.prisma.tenant;
    const scope = ownerScope();
    const user = await this.prisma.system.user.findUnique({ where: { id: currentUserId() }, select: { timezone: true } });
    const now = new Date();
    const today = startOfDayInZone(now, user?.timezone ?? 'Asia/Kolkata');
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const openLeads = { deletedAt: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] as LeadStatus[] }, ...scope };
    const [byStatus, contacts, customers, companies, open, won, overdue, dueToday, byGrade, top] = await Promise.all([
      db.lead.groupBy({ by: ['status'], where: { deletedAt: null, ...scope }, _count: { _all: true } }),
      db.contact.count({ where: { deletedAt: null, ...scope } }),
      db.contact.count({ where: { deletedAt: null, lifecycle: 'CUSTOMER', ...scope } }),
      db.company.count({ where: { deletedAt: null } }),
      db.deal.aggregate({ where: { deletedAt: null, status: 'OPEN', ...scope }, _count: { _all: true }, _sum: { value: true } }),
      db.deal.aggregate({ where: { deletedAt: null, status: 'WON', closedAt: { gte: monthStart }, ...scope }, _count: { _all: true }, _sum: { value: true } }),
      db.activity.count({ where: { deletedAt: null, completedAt: null, dueAt: { lt: now }, ...scope } }),
      db.activity.count({ where: { deletedAt: null, completedAt: null, dueAt: { gte: today, lt: tomorrow }, ...scope } }),
      db.lead.groupBy({ by: ['scoreGrade'], where: openLeads, _count: { _all: true } }),
      db.lead.findMany({ where: { ...openLeads, score: { not: null } }, orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }], take: 5 }),
    ]);
    const leadsByGrade = { HOT: 0, WARM: 0, COLD: 0 };
    for (const g of byGrade) if (g.scoreGrade && g.scoreGrade in leadsByGrade) leadsByGrade[g.scoreGrade as keyof typeof leadsByGrade] = g._count._all;
    const leadsByStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
    for (const r of byStatus) leadsByStatus[r.status] = r._count._all;
    return {
      leadsByStatus,
      leadsByGrade,
      callFirst: top.map((l) => ({ id: l.id, name: [l.firstName, l.lastName].filter(Boolean).join(' '), company: l.company, score: l.score!, grade: (l.scoreGrade ?? 'COLD') as 'HOT' | 'WARM' | 'COLD', reason: l.scoreReason })),
      contacts,
      customers,
      companies,
      openDeals: open._count._all,
      openPipelineValue: Number(open._sum.value ?? 0),
      wonThisMonth: { count: won._count._all, value: Number(won._sum.value ?? 0) },
      followUps: { overdue, today: dueToday },
      currency: await this.crm.currency(),
    };
  }
}

@ApiTags('CRM')
@ApiCookieAuth()
@Controller('crm')
export class CrmSummaryController {
  constructor(private readonly summary: CrmSummaryService) {}

  @Get('summary')
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'CRM overview counts and values (scoped to what the user can see)' })
  get() {
    return this.summary.summary();
  }
}
