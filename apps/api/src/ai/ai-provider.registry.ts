import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AICapability, AIProviderInfo } from '@zatma/types';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AppException } from '../common/errors.js';
import {
  PROVIDER_CATALOG,
  type AIImageProvider,
  type AITextProvider,
  type AIVideoProvider,
} from './ai-provider.interfaces.js';

type ByCapability = {
  TEXT: AITextProvider;
  IMAGE: AIImageProvider;
  VIDEO: AIVideoProvider;
};

/**
 * Holds provider adapters per capability with an ordered fallback chain.
 * Adapters are registered in Phase 4; until then `resolve()` fails with AI_PROVIDER_UNAVAILABLE
 * rather than pretending to generate content.
 */
@Injectable()
export class AIProviderRegistry {
  private readonly providers: { [K in keyof ByCapability]: ByCapability[K][] } = { TEXT: [], IMAGE: [], VIDEO: [] };

  constructor(@Inject(ENV) private readonly env: Env) {}

  register<K extends keyof ByCapability>(capability: K, provider: ByCapability[K]): void {
    if (this.providers[capability].some((p) => p.id === provider.id)) return;
    this.providers[capability].push(provider);
  }

  /** Returns providers in fallback order, preferred first. */
  chain<K extends keyof ByCapability>(capability: K, preferredId?: string): ByCapability[K][] {
    const list = [...(this.providers[capability] as ByCapability[K][])];
    if (preferredId) list.sort((a, b) => (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0));
    return list;
  }

  resolve<K extends keyof ByCapability>(capability: K, preferredId?: string): ByCapability[K] {
    const first = this.chain(capability, preferredId)[0];
    if (!first) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'AI_PROVIDER_UNAVAILABLE', `No ${capability} provider is configured`);
    }
    return first;
  }

  list(): AIProviderInfo[] {
    const implemented = new Set(Object.values(this.providers).flat().map((p) => p.id));
    return PROVIDER_CATALOG.map((p) => ({
      id: p.id,
      name: p.name,
      capabilities: p.capabilities as AICapability[],
      configured: Boolean(this.env[p.envKey]),
      implemented: implemented.has(p.id),
    }));
  }
}
