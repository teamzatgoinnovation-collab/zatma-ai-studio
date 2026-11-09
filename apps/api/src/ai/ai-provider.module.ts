import { Global, Module } from '@nestjs/common';
import { AIController } from './ai.controller.js';
import { AIProviderRegistry } from './ai-provider.registry.js';

@Global()
@Module({ controllers: [AIController], providers: [AIProviderRegistry], exports: [AIProviderRegistry] })
export class AIProviderModule {}
