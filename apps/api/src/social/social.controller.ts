import { randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Inject, Injectable, Logger, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Job, Queue } from 'bullmq';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import {
  addSocialAccountsSchema,
  connectSocialSchema,
  SOCIAL_PROVIDERS,
  updateSocialAccountSchema,
  type AddSocialAccountsInput,
  type ConnectSocialInput,
  type SocialProviderId,
  type UpdateSocialAccountInput,
} from '@zatma/validation';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator.js';
import { AUTH } from '../auth/auth.module.js';
import type { Auth } from '../auth/auth.js';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators.js';
import { AppException } from '../common/errors.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseSignedRequest, verifyMetaSignature } from './providers/meta.provider.js';
import { SocialService } from './social.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const providerParam = new ZodValidationPipe(z.enum(SOCIAL_PROVIDERS));
export const SOCIAL_HEALTH_QUEUE = 'social-health';

@ApiTags('Social accounts')
@ApiCookieAuth()
@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('providers')
  @RequirePermissions('social:read')
  @ApiOperation({ summary: 'Platforms, whether they are configured, scopes and the redirect URI to register' })
  providers() {
    return this.social.providers();
  }

  @Post('connect/:provider')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 20), ttl: 60_000 } })
  @RequirePermissions('social:connect')
  @ApiOperation({ summary: 'Start OAuth: returns the platform authorization URL (single-use state, 10 minutes)' })
  connect(@Param('provider', providerParam) provider: SocialProviderId, @Body(new ZodValidationPipe(connectSocialSchema)) body: ConnectSocialInput) {
    return this.social.startConnect(provider, body);
  }

  @Get('connections/:id/available')
  @RequirePermissions('social:connect')
  @ApiOperation({ summary: 'Pages, Instagram accounts, LinkedIn Pages or channels this grant can manage' })
  available(@Param('id', uuid) id: string) {
    return this.social.available(id);
  }

  @Get('accounts')
  @RequirePermissions('social:read')
  list() {
    return this.social.listAccounts();
  }

  @Post('accounts')
  @RequirePermissions('social:connect')
  @Audit('social.accounts_added', 'social_account')
  add(@Body(new ZodValidationPipe(addSocialAccountsSchema)) body: AddSocialAccountsInput) {
    return this.social.addAccounts(body);
  }

  @Patch('accounts/:id')
  @RequirePermissions('social:connect')
  @Audit('social.account_updated', 'social_account')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateSocialAccountSchema)) body: UpdateSocialAccountInput) {
    return this.social.updateAccount(id, body.workspaceIds);
  }

  @Post('accounts/:id/check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:connect')
  check(@Param('id', uuid) id: string) {
    return this.social.checkAccount(id);
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('social:connect')
  @Audit('social.account_disconnected', 'social_account')
  remove(@Param('id', uuid) id: string) {
    return this.social.disconnect(id);
  }
}

/** Public OAuth redirect target. The state is checked against the signed-in user before anything is stored. */
@ApiTags('Social accounts')
@Controller('social/oauth')
export class SocialOAuthController {
  constructor(
    private readonly social: SocialService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Get(':provider/callback')
  @Public()
  @ApiExcludeEndpoint()
  async callback(@Param('provider', providerParam) provider: SocialProviderId, @Query() q: Record<string, string | undefined>, @Req() req: Request, @Res() res: Response) {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
    const url = await this.social.handleCallback(provider, { code: q.code, state: q.state, error: q.error ?? q.error_reason }, session?.user.id ?? null);
    res.redirect(302, url);
  }
}

/** Meta platform callbacks: webhook verification and events, app deauthorization and data deletion requests. */
@ApiTags('Social accounts')
@Controller('social')
export class MetaCallbacksController {
  private readonly logger = new Logger(MetaCallbacksController.name);

  constructor(
    private readonly social: SocialService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('webhooks/meta')
  @Public()
  @Header('Content-Type', 'text/plain')
  @ApiExcludeEndpoint()
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    if (mode === 'subscribe' && this.env.META_WEBHOOK_VERIFY_TOKEN && token === this.env.META_WEBHOOK_VERIFY_TOKEN && challenge) return challenge;
    throw new AppException(HttpStatus.FORBIDDEN, 'INVALID_VERIFY_TOKEN', 'Webhook verification failed');
  }

  @Post('webhooks/meta')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async event(@Req() req: Request & { rawBody?: Buffer }) {
    const secret = this.env.META_APP_SECRET;
    if (!secret || !req.rawBody || !verifyMetaSignature(req.rawBody, req.header('x-hub-signature-256'), secret)) {
      throw new AppException(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Invalid webhook signature');
    }
    await this.social.recordWebhook('meta', req.body as Record<string, unknown>);
    return { received: true };
  }

  private signed(body: { signed_request?: string }) {
    const data = this.env.META_APP_SECRET && body.signed_request ? parseSignedRequest(body.signed_request, this.env.META_APP_SECRET) : null;
    if (!data?.user_id) throw new AppException(HttpStatus.BAD_REQUEST, 'INVALID_SIGNED_REQUEST', 'Invalid signed_request');
    return data.user_id;
  }

  @Post('meta/deauthorize')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async deauthorize(@Body() body: { signed_request?: string }) {
    const n = await this.social.revokeMetaUser(this.signed(body));
    this.logger.log(`Meta deauthorization: ${n} connection(s) revoked`);
    return { ok: true };
  }

  @Post('meta/data-deletion')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async dataDeletion(@Body() body: { signed_request?: string }) {
    await this.social.deleteMetaUserData(this.signed(body));
    const code = randomBytes(9).toString('base64url');
    return { url: `${this.env.API_URL.replace(/\/$/, '')}/api/v1/social/meta/data-deletion/${code}`, confirmation_code: code };
  }

  @Get('meta/data-deletion/:code')
  @Public()
  @ApiExcludeEndpoint()
  deletionStatus(@Param('code') code: string) {
    return { confirmation_code: code.slice(0, 32), status: 'completed', detail: 'Facebook data for this user was deleted from ZatGo AI Marketing when the request was received.' };
  }
}

type HealthJob = { organizationId?: string };

@Injectable()
export class SocialHealthScheduler implements OnModuleInit {
  private readonly logger = new Logger(SocialHealthScheduler.name);
  constructor(@InjectQueue(SOCIAL_HEALTH_QUEUE) private readonly queue: Queue<HealthJob>) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.queue.upsertJobScheduler('daily-social-health', { pattern: '15 22 * * *' }, { name: 'daily', data: {} });
    } catch (err) {
      this.logger.warn(`Could not register the social health job: ${(err as Error).message}`);
    }
  }
}

@Processor(SOCIAL_HEALTH_QUEUE, { concurrency: 1 })
export class SocialHealthProcessor extends WorkerHost {
  constructor(
    private readonly social: SocialService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<HealthJob>): Promise<{ organizations: number }> {
    const orgs = job.data.organizationId ? [{ organizationId: job.data.organizationId }] : await this.prisma.system.socialConnection.groupBy({ by: ['organizationId'], where: { status: { not: 'REVOKED' } } });
    for (const o of orgs) await this.social.runHealth(o.organizationId);
    return { organizations: orgs.length };
  }
}
