import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AICapability, AIProviderInfo } from '@zatma/types';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PROVIDER_CATALOG, type AIImageProvider, type AITextProvider } from './ai-provider.interfaces.js';
import { AnthropicTextProvider } from './providers/anthropic.provider.js';
import { createGeminiProviders } from './providers/gemini.provider.js';
import { createOpenAIProviders } from './providers/openai.provider.js';

export type GenerativeCapability = 'TEXT' | 'IMAGE';
type ByCapability = { TEXT: AITextProvider; IMAGE: AIImageProvider };

/**
 * Holds provider adapters per capability. Adapters are registered at boot for every provider whose
 * API key is configured; the fallback order comes from AI_TEXT_PROVIDERS / AI_IMAGE_PROVIDERS and
 * can be overridden per request or per organization (preferred provider first).
 */
@Injectable()
export class AIProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(AIProviderRegistry.name);
  private readonly providers: { TEXT: Map<string, AITextProvider>; IMAGE: Map<string, AIImageProvider> } = { TEXT: new Map(), IMAGE: new Map() };

  constructor(@Inject(ENV) private readonly env: Env) {}

  onModuleInit(): void {
    const e = this.env;
    if (e.ANTHROPIC_API_KEY) {
      this.register('TEXT', AnthropicTextProvider.create(e.ANTHROPIC_API_KEY, e.ANTHROPIC_TEXT_MODEL, e.ANTHROPIC_EFFORT));
    }
    if (e.OPENAI_API_KEY) {
      const { text, image } = createOpenAIProviders(e.OPENAI_API_KEY, e.OPENAI_TEXT_MODEL, e.OPENAI_IMAGE_MODEL);
      this.register('TEXT', text);
      this.register('IMAGE', image);
    }
    if (e.GEMINI_API_KEY) {
      const { text, image } = createGeminiProviders(e.GEMINI_API_KEY, e.GEMINI_TEXT_MODEL, e.GEMINI_IMAGE_MODEL);
      this.register('TEXT', text);
      this.register('IMAGE', image);
    }
    const summary = (['TEXT', 'IMAGE'] as const).map((c) => `${c}: ${this.order(c).join(' → ') || 'none'}`).join('; ');
    this.logger.log(`AI providers ${summary}`);
  }

  register<K extends GenerativeCapability>(capability: K, provider: ByCapability[K]): void {
    (this.providers[capability] as Map<string, ByCapability[K]>).set(provider.id, provider);
  }

  /** Clears registered adapters (tests). */
  reset(): void {
    this.providers.TEXT.clear();
    this.providers.IMAGE.clear();
  }

  private configuredOrder(capability: GenerativeCapability): string[] {
    return capability === 'TEXT' ? this.env.AI_TEXT_PROVIDERS : this.env.AI_IMAGE_PROVIDERS;
  }

  /** Registered provider ids in fallback order, with `preferred` moved to the front. */
  order(capability: GenerativeCapability, preferred?: string | null): string[] {
    const registered = this.providers[capability];
    const configured = this.configuredOrder(capability);
    const ids = [...configured.filter((id) => registered.has(id)), ...[...registered.keys()].filter((id) => !configured.includes(id))];
    if (preferred && ids.includes(preferred)) return [preferred, ...ids.filter((id) => id !== preferred)];
    return ids;
  }

  chain<K extends GenerativeCapability>(capability: K, preferred?: string | null): ByCapability[K][] {
    const map = this.providers[capability] as Map<string, ByCapability[K]>;
    return this.order(capability, preferred).map((id) => map.get(id)!);
  }

  has(capability: GenerativeCapability, id: string): boolean {
    return this.providers[capability].has(id);
  }

  list(): AIProviderInfo[] {
    return PROVIDER_CATALOG.map((p) => {
      const text = this.providers.TEXT.get(p.id);
      const image = this.providers.IMAGE.get(p.id);
      return {
        id: p.id,
        name: p.name,
        capabilities: p.capabilities as AICapability[],
        configured: Boolean(this.env[p.envKey]),
        implemented: Boolean(text || image),
        models: { ...(text ? { TEXT: text.defaultModel } : {}), ...(image ? { IMAGE: image.defaultModel } : {}) },
      };
    });
  }
}
