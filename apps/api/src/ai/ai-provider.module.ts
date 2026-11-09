import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AIController } from './ai.controller.js';
import { AIGenerationProcessor } from './ai-generation.processor.js';
import { AIProviderRegistry } from './ai-provider.registry.js';
import { AI_QUEUE, AIService } from './ai.service.js';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: AI_QUEUE })],
  controllers: [AIController],
  providers: [AIProviderRegistry, AIService, AIGenerationProcessor],
  exports: [AIProviderRegistry, AIService],
})
export class AIProviderModule {}
