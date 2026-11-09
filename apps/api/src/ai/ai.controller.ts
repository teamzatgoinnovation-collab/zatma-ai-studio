import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  aiSettingsSchema,
  createGenerationJobSchema,
  generateTextSchema,
  paginationSchema,
  type AISettingsInput,
  type CreateGenerationJobInput,
  type GenerateTextInput,
  type PaginationInput,
} from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AIProviderRegistry } from './ai-provider.registry.js';
import { AIService } from './ai.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
/** Generation endpoints: 20 requests per minute per client on top of plan credit limits. */
const GENERATION_THROTTLE = { default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 20), ttl: 60_000 } };

@ApiTags('AI')
@ApiCookieAuth()
@Controller('ai')
export class AIController {
  constructor(
    private readonly registry: AIProviderRegistry,
    private readonly ai: AIService,
  ) {}

  @Get('providers')
  @RequirePermissions('ai:read')
  @ApiOperation({ summary: 'AI providers, availability and default models (keys are never returned)' })
  providers() {
    return this.registry.list();
  }

  @Get('settings')
  @RequirePermissions('ai:read')
  @ApiOperation({ summary: 'Preferred providers and effective fallback order for the organization' })
  settings() {
    return this.ai.settings();
  }

  @Patch('settings')
  @RequirePermissions('organization:update')
  @Audit('ai.settings_updated', 'organization')
  @ApiOperation({ summary: 'Set preferred text / image providers (null = platform default order)' })
  updateSettings(@Body(new ZodValidationPipe(aiSettingsSchema)) body: AISettingsInput) {
    return this.ai.updateSettings(body);
  }

  @Post('text')
  @HttpCode(HttpStatus.OK)
  @Throttle(GENERATION_THROTTLE)
  @RequirePermissions('ai:generate')
  @ApiOperation({ summary: 'Generate text synchronously (copy, captions, briefs) with provider fallback' })
  generateText(@Body(new ZodValidationPipe(generateTextSchema)) body: GenerateTextInput) {
    return this.ai.generateText(body);
  }

  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(GENERATION_THROTTLE)
  @RequirePermissions('ai:generate')
  @ApiOperation({ summary: 'Queue an AI generation (images, long text); poll GET /ai/jobs/:id' })
  createJob(@Body(new ZodValidationPipe(createGenerationJobSchema)) body: CreateGenerationJobInput) {
    return this.ai.createJob(body);
  }

  @Get('jobs')
  @RequirePermissions('ai:read')
  @ApiOperation({ summary: 'Recent generation jobs of the organization' })
  listJobs(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput) {
    return this.ai.listJobs(query);
  }

  @Get('jobs/:id')
  @RequirePermissions('ai:read')
  @ApiOperation({ summary: 'Generation job status and output (images as short-lived signed URLs)' })
  getJob(@Param('id', uuid) id: string) {
    return this.ai.getJob(id);
  }

  @Get('usage')
  @RequirePermissions('ai:read')
  @ApiOperation({ summary: 'AI credit usage this period, by provider, plus recent requests' })
  usage() {
    return this.ai.usageSummary();
  }
}
