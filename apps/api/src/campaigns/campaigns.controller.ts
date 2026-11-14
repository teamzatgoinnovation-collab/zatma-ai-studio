import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  aiCampaignPlanRequestSchema,
  audienceSegmentSchema,
  campaignAssetSchema,
  campaignAttachSchema,
  campaignCalendarSchema,
  campaignRangeSchema,
  campaignReadySchema,
  campaignStopSchema,
  campaignTaskSchema,
  createMarketingCampaignSchema,
  listMarketingCampaignsSchema,
  paginationSchema,
  trackedLinkSchema,
  updateCampaignTaskSchema,
  updateMarketingCampaignSchema,
  updateTrackedLinkSchema,
  type AiCampaignPlanRequest,
  type AudienceSegment,
  type CampaignAssetInput,
  type CampaignAttachInput,
  type CampaignCalendarQuery,
  type CampaignRange,
  type CampaignStopInput,
  type CampaignTaskInput,
  type CreateMarketingCampaignInput,
  type ListMarketingCampaignsQuery,
  type PaginationInput,
  type TrackedLinkInput,
  type UpdateCampaignTaskInput,
  type UpdateMarketingCampaignInput,
  type UpdateTrackedLinkInput,
} from '@zatma/validation';
import type { ZodType } from 'zod';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CampaignAssetsService } from './campaign-assets.service.js';
import { CampaignInsightsService } from './campaign-insights.service.js';
import { CampaignTrackingService } from './campaign-tracking.service.js';
import { CampaignsService } from './campaigns.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const v = (schema: ZodType) => new ZodValidationPipe(schema);

@ApiTags('Campaigns')
@ApiCookieAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly insights: CampaignInsightsService,
    private readonly assets: CampaignAssetsService,
    private readonly tracking: CampaignTrackingService,
  ) {}

  @Get()
  @RequirePermissions('campaign:read')
  list(@Query(v(listMarketingCampaignsSchema)) q: ListMarketingCampaignsQuery) {
    return this.campaigns.list(q);
  }

  @Get('calendar')
  @RequirePermissions('campaign:read')
  calendar(@Query(v(campaignCalendarSchema)) q: CampaignCalendarQuery) {
    return this.insights.calendar(q);
  }

  @Post('audience/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('campaign:read', 'crm:read')
  @ApiOperation({ summary: 'Count and sample the CRM records a segment matches (respects record ownership)' })
  audience(@Body(v(audienceSegmentSchema)) body: AudienceSegment) {
    return this.insights.audiencePreview(body);
  }

  @Post('ai/plan')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 10), ttl: 60_000 } })
  @RequirePermissions('campaign:write', 'ai:generate')
  @ApiOperation({ summary: 'AI campaign plan. Returns a suggestion only; nothing is saved, scheduled or created on any platform.' })
  aiPlan(@Body(v(aiCampaignPlanRequestSchema)) body: AiCampaignPlanRequest) {
    return this.assets.aiPlan(body);
  }

  @Post()
  @RequirePermissions('campaign:write')
  create(@Body(v(createMarketingCampaignSchema)) body: CreateMarketingCampaignInput) {
    return this.campaigns.create(body);
  }

  @Get(':id')
  @RequirePermissions('campaign:read')
  get(@Param('id', uuid) id: string) {
    return this.campaigns.get(id);
  }

  @Patch(':id')
  @RequirePermissions('campaign:write')
  update(@Param('id', uuid) id: string, @Body(v(updateMarketingCampaignSchema)) body: UpdateMarketingCampaignInput) {
    return this.campaigns.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('campaign:write')
  remove(@Param('id', uuid) id: string) {
    return this.campaigns.remove(id);
  }

  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('campaign:write')
  ready(@Param('id', uuid) id: string, @Body(v(campaignReadySchema)) body: { ready: boolean }) {
    return this.campaigns.ready(id, body.ready);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('campaign:write')
  @ApiOperation({ summary: 'Pause the campaign; optionally pause its running ads (stops spend) and unschedule its posts' })
  pause(@Param('id', uuid) id: string, @Body(v(campaignStopSchema)) body: CampaignStopInput) {
    return this.campaigns.stop(id, 'PAUSED', body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('campaign:write')
  cancel(@Param('id', uuid) id: string, @Body(v(campaignStopSchema)) body: CampaignStopInput) {
    return this.campaigns.stop(id, 'CANCELLED', body);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('campaign:write')
  @ApiOperation({ summary: 'Clear a pause. Never activates ads: paused ads are listed for review in the spend-approval flow.' })
  resume(@Param('id', uuid) id: string) {
    return this.campaigns.resume(id);
  }

  @Post(':id/attach')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('campaign:write')
  attach(@Param('id', uuid) id: string, @Body(v(campaignAttachSchema)) body: CampaignAttachInput) {
    return this.campaigns.attach(id, body);
  }

  @Get(':id/content')
  @RequirePermissions('campaign:read')
  content(@Param('id', uuid) id: string) {
    return this.campaigns.content(id);
  }

  @Get(':id/leads')
  @RequirePermissions('campaign:read', 'crm:read')
  leads(@Param('id', uuid) id: string, @Query(v(paginationSchema)) q: PaginationInput) {
    return this.insights.leads(id, q);
  }

  @Get(':id/analytics')
  @RequirePermissions('campaign:read')
  analytics(@Param('id', uuid) id: string, @Query(v(campaignRangeSchema)) q: CampaignRange) {
    return this.insights.analytics(id, q);
  }

  // Assets
  @Get(':id/assets')
  @RequirePermissions('campaign:read')
  listAssets(@Param('id', uuid) id: string) {
    return this.assets.listAssets(id);
  }

  @Post(':id/assets')
  @RequirePermissions('campaign:write')
  addAsset(@Param('id', uuid) id: string, @Body(v(campaignAssetSchema)) body: CampaignAssetInput) {
    return this.assets.addAsset(id, body);
  }

  @Delete(':id/assets/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('campaign:write')
  removeAsset(@Param('id', uuid) id: string, @Param('assetId') assetId: string) {
    return this.assets.removeAsset(id, assetId.slice(0, 80));
  }

  // Tasks
  @Get(':id/tasks')
  @RequirePermissions('campaign:read')
  listTasks(@Param('id', uuid) id: string) {
    return this.assets.listTasks(id);
  }

  @Post(':id/tasks')
  @RequirePermissions('campaign:write')
  addTask(@Param('id', uuid) id: string, @Body(v(campaignTaskSchema)) body: CampaignTaskInput) {
    return this.assets.addTask(id, body);
  }

  @Patch(':id/tasks/:taskId')
  @RequirePermissions('campaign:write')
  updateTask(@Param('id', uuid) id: string, @Param('taskId', uuid) taskId: string, @Body(v(updateCampaignTaskSchema)) body: UpdateCampaignTaskInput) {
    return this.assets.updateTask(id, taskId, body);
  }

  @Delete(':id/tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('campaign:write')
  removeTask(@Param('id', uuid) id: string, @Param('taskId', uuid) taskId: string) {
    return this.assets.removeTask(id, taskId);
  }

  // Tracked links
  @Get(':id/links')
  @RequirePermissions('campaign:read')
  listLinks(@Param('id', uuid) id: string) {
    return this.tracking.list(id);
  }

  @Post(':id/links')
  @RequirePermissions('campaign:write')
  addLink(@Param('id', uuid) id: string, @Body(v(trackedLinkSchema)) body: TrackedLinkInput) {
    return this.tracking.create(id, body);
  }

  @Patch(':id/links/:linkId')
  @RequirePermissions('campaign:write')
  updateLink(@Param('id', uuid) id: string, @Param('linkId', uuid) linkId: string, @Body(v(updateTrackedLinkSchema)) body: UpdateTrackedLinkInput) {
    return this.tracking.update(id, linkId, body);
  }

  @Delete(':id/links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('campaign:write')
  removeLink(@Param('id', uuid) id: string, @Param('linkId', uuid) linkId: string) {
    return this.tracking.remove(id, linkId);
  }
}

const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not found</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;color:#1f2937;background:#f9fafb}@media(prefers-color-scheme:dark){body{color:#e5e7eb;background:#111827}}main{max-width:28rem;text-align:center}h1{font-size:1.25rem}</style></head><body><main><h1>This link isn’t available</h1><p>It may have expired or been removed. Check the address and try again.</p></main></body></html>`;

/** Public short-link redirect: `/api/v1/r/{slug}` (the web app serves it as `/r/{slug}`). */
@ApiTags('Campaigns')
@Controller('r')
export class TrackedLinkRedirectController {
  constructor(private readonly tracking: CampaignTrackingService) {}

  @Get(':slug')
  @Public()
  @Throttle({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 120), ttl: 60_000 } })
  @ApiExcludeEndpoint()
  async redirect(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const url = await this.tracking.resolve(slug, { ip: req.ip, userAgent: req.headers['user-agent'], method: req.method });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!url) {
      res.status(404).type('html').send(NOT_FOUND_PAGE);
      return;
    }
    res.redirect(302, url);
  }
}
