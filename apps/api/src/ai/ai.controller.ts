import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { AIProviderRegistry } from './ai-provider.registry.js';

@ApiTags('AI')
@ApiCookieAuth()
@Controller('ai')
export class AIController {
  constructor(private readonly registry: AIProviderRegistry) {}

  @Get('providers')
  @RequirePermissions('ai:read')
  @ApiOperation({ summary: 'AI providers with configuration status (keys are never returned)' })
  providers() {
    return this.registry.list();
  }
}
