import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PROVIDER_LABELS, SOCIAL_PROVIDERS, type SocialProviderId, type SocialProviderInfo } from '@zatma/validation';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { REDIS } from '../redis/redis.module.js';
import { LINKEDIN_SCOPES, LinkedInProvider } from './providers/linkedin.provider.js';
import { META_SCOPES, MetaProvider } from './providers/meta.provider.js';
import type { SocialProvider } from './providers/provider.js';
import { YOUTUBE_SCOPES, YouTubeProvider } from './providers/youtube.provider.js';
import { TokenCipher } from './token-cipher.js';

const DEFAULT_SCOPES: Record<SocialProviderId, string[]> = { meta: META_SCOPES, linkedin: LINKEDIN_SCOPES, google: YOUTUBE_SCOPES };
const PLATFORMS: Record<SocialProviderId, SocialProviderInfo['platforms']> = {
  meta: ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS'],
  linkedin: ['LINKEDIN_PAGE'],
  google: ['YOUTUBE_CHANNEL'],
};
const ENV_NAMES: Record<SocialProviderId, string> = { meta: 'META_APP_ID / META_APP_SECRET', linkedin: 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET', google: 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET' };

/**
 * Platform adapters enabled from the environment (a platform is available only when its app keys and
 * TOKEN_ENCRYPTION_KEYS are set). Tests replace adapters with fakes via `register`.
 */
@Injectable()
export class SocialProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(SocialProviderRegistry.name);
  private readonly providers = new Map<SocialProviderId, SocialProvider>();
  private cipherInstance: TokenCipher | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  onModuleInit(): void {
    const e = this.env;
    if (e.TOKEN_ENCRYPTION_KEYS) this.cipherInstance = new TokenCipher(e.TOKEN_ENCRYPTION_KEYS);
    if (e.META_APP_ID && e.META_APP_SECRET) {
      this.register(new MetaProvider({ appId: e.META_APP_ID, appSecret: e.META_APP_SECRET, graphVersion: e.META_GRAPH_VERSION, graphUrl: e.META_GRAPH_URL, oauthUrl: e.META_OAUTH_URL }));
    }
    if (e.LINKEDIN_CLIENT_ID && e.LINKEDIN_CLIENT_SECRET) {
      this.register(new LinkedInProvider({ clientId: e.LINKEDIN_CLIENT_ID, clientSecret: e.LINKEDIN_CLIENT_SECRET, apiVersion: e.LINKEDIN_API_VERSION, apiUrl: e.LINKEDIN_API_URL, oauthUrl: e.LINKEDIN_OAUTH_URL }));
    }
    if (e.YOUTUBE_CLIENT_ID && e.YOUTUBE_CLIENT_SECRET) {
      this.register(
        new YouTubeProvider({ clientId: e.YOUTUBE_CLIENT_ID, clientSecret: e.YOUTUBE_CLIENT_SECRET, authUrl: e.GOOGLE_OAUTH_URL, tokenUrl: e.GOOGLE_TOKEN_URL, revokeUrl: e.GOOGLE_REVOKE_URL, apiUrl: e.YOUTUBE_API_URL, uploadUrl: e.YOUTUBE_UPLOAD_URL }),
      );
    }
    this.logger.log(`Social platforms: ${[...this.providers.keys()].join(', ') || 'none configured'}`);
  }

  register(provider: SocialProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Test helper: replace the configured adapters (and optionally the cipher). */
  reset(cipher?: TokenCipher | null): void {
    this.providers.clear();
    if (cipher !== undefined) this.cipherInstance = cipher;
  }

  get(id: SocialProviderId): SocialProvider | undefined {
    return this.providers.get(id);
  }

  get cipher(): TokenCipher | null {
    return this.cipherInstance;
  }

  redirectUri(id: SocialProviderId): string {
    return `${this.env.API_URL.replace(/\/$/, '')}/api/v1/social/oauth/${id}/callback`;
  }

  info(): SocialProviderInfo[] {
    return SOCIAL_PROVIDERS.map((id) => {
      const p = this.providers.get(id);
      const reason = !p ? `An administrator must set ${ENV_NAMES[id]} on the server.` : !this.cipherInstance ? 'An administrator must set TOKEN_ENCRYPTION_KEYS on the server.' : null;
      return { id, name: PROVIDER_LABELS[id], platforms: PLATFORMS[id], configured: !reason, unavailableReason: reason, scopes: p?.scopes ?? DEFAULT_SCOPES[id], redirectUri: this.redirectUri(id) };
    });
  }
}

export interface OAuthStateData {
  organizationId: string;
  userId: string;
  provider: SocialProviderId;
  codeVerifier?: string;
  returnTo?: string;
  reconnectConnectionId?: string;
}

const STATE_TTL_SECONDS = 600;

/** Single-use OAuth `state` values stored server-side (10 minutes). */
@Injectable()
export class OAuthStateStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async create(data: OAuthStateData): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    await this.redis.set(`oauth:state:${state}`, JSON.stringify(data), 'EX', STATE_TTL_SECONDS);
    return state;
  }

  /** Returns and deletes the state (null if unknown, expired or already used). */
  async consume(state: string | undefined): Promise<OAuthStateData | null> {
    if (!state || !/^[\w-]{20,100}$/.test(state)) return null;
    const raw = await this.redis.getdel(`oauth:state:${state}`);
    return raw ? (JSON.parse(raw) as OAuthStateData) : null;
  }
}
