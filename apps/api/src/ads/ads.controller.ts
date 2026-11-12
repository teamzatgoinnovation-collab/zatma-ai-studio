import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import {
  activateCampaignSchema,
  aiCampaignRequestSchema,
  budgetChangeSchema,
  campaignDraftSchema,
  insightsQuerySchema,
  listCampaignsSchema,
  updateAdAccountSchema,
  updateCampaignSchema,
  type AiCampaignRequest,
  type CampaignDraftInput,
  type ListCampaignsQuery,
  type UpdateCampaignInput,
} from '@zatma/validation';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator.js';
import { AUTH } from '../auth/auth.module.js';
import type { Auth } from '../auth/auth.js';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AdsAccountsService } from './ads-accounts.service.js';
import { ADS_PROVIDERS, type AdsProviderId } from './ads-registry.js';
import { AdsService } from './ads.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const providerParam = new ZodValidationPipe(z.enum(ADS_PROVIDERS as [AdsProviderId, ...AdsProviderId[]]));
const connectSchema = z.object({ returnTo: z.string().max(200).regex(/^\/(?!\/)[\w\-/?=&.%]*$/).optional() }).strict();
const addAccountsSchema = z.object({ connectionId: z.uuid(), externalIds: z.array(z.string().min(1).max(64)).min(1).max(50), workspaceIds: z.array(z.uuid()).max(50).default([]) }).strict();
const targetingSchema = z.object({ kind: z.enum(['location', 'interest', 'language']), q: z.string().trim().min(1).max(80) });
const platformSchema = z.object({ platform: z.enum(['META', 'GOOGLE']).optional() });

@ApiTags('Ads')
@ApiCookieAuth()
@Controller('ads')
export class AdsController {
  constructor(
    private readonly accounts: AdsAccountsService,
    private readonly ads: AdsService,
  ) {}

  @Get('providers')
  @RequirePermissions('ads:read')
  providers() {
    return this.accounts.providers();
  }

  @Post('connect/:provider')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ads:manage')
  connect(@Param('provider', providerParam) provider: AdsProviderId, @Body(new ZodValidationPipe(connectSchema)) body: { returnTo?: string }) {
    return this.accounts.startConnect(provider, body.returnTo);
  }

  @Get('connections/:id/available')
  @RequirePermissions('ads:manage')
  available(@Param('id', uuid) id: string) {
    return this.accounts.available(id);
  }

  @Get('accounts')
  @RequirePermissions('ads:read')
  listAccounts(@Query(new ZodValidationPipe(platformSchema)) q: { platform?: 'META' | 'GOOGLE' }) {
    return this.accounts.list(q.platform ? { platform: q.platform } : {});
  }

  @Post('accounts')
  @RequirePermissions('ads:manage')
  addAccounts(@Body(new ZodValidationPipe(addAccountsSchema)) body: z.infer<typeof addAccountsSchema>) {
    return this.accounts.addAccounts(body);
  }

  @Patch('accounts/:id')
  @RequirePermissions('ads:manage')
  updateAccount(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateAdAccountSchema)) body: { workspaceIds?: string[]; monthlySpendCap?: string | null }) {
    return this.accounts.update(id, body);
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('ads:manage')
  removeAccount(@Param('id', uuid) id: string) {
    return this.accounts.remove(id);
  }

  @Post('accounts/:id/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('ads:manage')
  sync(@Param('id', uuid) id: string) {
    return this.ads.syncNow(id);
  }

  @Get('accounts/:id/targeting')
  @RequirePermissions('ads:manage')
  @ApiOperation({ summary: 'Search locations, interests or languages through the platform (returns real platform ids)' })
  targeting(@Param('id', uuid) id: string, @Query(new ZodValidationPipe(targetingSchema)) q: { kind: 'location' | 'interest' | 'language'; q: string }) {
    return this.ads.targeting(id, q.kind, q.q);
  }

  @Get('campaigns')
  @RequirePermissions('ads:read')
  list(@Query(new ZodValidationPipe(listCampaignsSchema)) q: ListCampaignsQuery) {
    return this.ads.list(q);
  }

  @Post('campaigns/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ads:manage')
  validate(@Body(new ZodValidationPipe(campaignDraftSchema)) body: CampaignDraftInput) {
    return this.ads.validateDraft(body);
  }

  @Post('campaigns/ai-draft')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 10), ttl: 60_000 } })
  @RequirePermissions('ads:manage', 'ai:generate')
  @ApiOperation({ summary: 'AI suggestion for a campaign. Returns a draft only; nothing is saved or created.' })
  aiDraft(@Body(new ZodValidationPipe(aiCampaignRequestSchema)) body: AiCampaignRequest) {
    return this.ads.aiDraft(body);
  }

  @Post('campaigns')
  @RequirePermissions('ads:manage')
  create(@Body(new ZodValidationPipe(campaignDraftSchema)) body: CampaignDraftInput) {
    return this.ads.create(body);
  }

  @Get('campaigns/:id')
  @RequirePermissions('ads:read')
  get(@Param('id', uuid) id: string) {
    return this.ads.get(id);
  }

  @Patch('campaigns/:id')
  @RequirePermissions('ads:manage')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignInput) {
    return this.ads.update(id, body);
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('ads:manage')
  remove(@Param('id', uuid) id: string) {
    return this.ads.remove(id);
  }

  @Post('campaigns/:id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ads:manage')
  @ApiOperation({ summary: 'Create the campaign on the platform. It is always created PAUSED and spends nothing.' })
  publish(@Param('id', uuid) id: string) {
    return this.ads.publish(id);
  }

  @Post('campaigns/:id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ads:manage')
  pause(@Param('id', uuid) id: string) {
    return this.ads.pause(id);
  }

  @Post('campaigns/:id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ads:approve')
  @Audit('ads.activation_requested', 'ad_campaign')
  @ApiOperation({ summary: 'Start spending. Owner/Admin only; requires { confirm: true, maxSpend } matching the server computation.' })
  activate(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(activateCampaignSchema)) body: { confirm: true; maxSpend: string }) {
    return this.ads.activate(id, body.maxSpend);
  }

  @Post('campaigns/:id/budget')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ads:manage')
  budget(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(budgetChangeSchema)) body: { budgetAmount: string; confirm?: true; maxSpend?: string }) {
    return this.ads.changeBudget(id, body);
  }

  @Get('campaigns/:id/insights')
  @RequirePermissions('ads:read')
  insights(@Param('id', uuid) id: string, @Query(new ZodValidationPipe(insightsQuerySchema)) q: { from: string; to: string }) {
    return this.ads.insights(id, q.from, q.to);
  }
}

/** Public OAuth redirect target for ad platforms (state is checked against the signed-in user). */
@ApiTags('Ads')
@Controller('ads/oauth')
export class AdsOAuthController {
  constructor(
    private readonly accounts: AdsAccountsService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Get(':provider/callback')
  @Public()
  @ApiExcludeEndpoint()
  async callback(@Param('provider', providerParam) provider: AdsProviderId, @Query() q: Record<string, string | undefined>, @Req() req: Request, @Res() res: Response) {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
    res.redirect(302, await this.accounts.handleCallback(provider, { code: q.code, state: q.state, error: q.error ?? q.error_reason }, session?.user.id ?? null));
  }
}
