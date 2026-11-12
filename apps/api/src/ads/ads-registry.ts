import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AdPlatform } from '@zatma/validation';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { SocialProviderRegistry } from '../social/social-registry.js';
import type { TokenCipher } from '../social/token-cipher.js';
import type { AdsPlatformAdapter } from './providers/ads-provider.js';
import { GoogleAdsAdapter } from './providers/google-ads.js';
import { MetaAdsAdapter } from './providers/meta-ads.js';

export type AdsProviderId = 'meta_ads' | 'google_ads';
export const ADS_PROVIDERS: AdsProviderId[] = ['meta_ads', 'google_ads'];
export const PLATFORM_OF: Record<AdsProviderId, AdPlatform> = { meta_ads: 'META', google_ads: 'GOOGLE' };
export const PROVIDER_OF: Record<AdPlatform, AdsProviderId> = { META: 'meta_ads', GOOGLE: 'google_ads' };
const ENV_NAMES: Record<AdsProviderId, string> = { meta_ads: 'META_APP_ID / META_APP_SECRET', google_ads: 'GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN' };

export interface AdsProviderInfo {
  id: AdsProviderId;
  platform: AdPlatform;
  name: string;
  configured: boolean;
  unavailableReason: string | null;
  scopes: string[];
  redirectUri: string;
}

/** Ads adapters enabled from the environment; tokens use the same encryption keys as social accounts. */
@Injectable()
export class AdsRegistry implements OnModuleInit {
  private readonly logger = new Logger(AdsRegistry.name);
  private readonly adapters = new Map<AdsProviderId, AdsPlatformAdapter>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly social: SocialProviderRegistry,
  ) {}

  onModuleInit(): void {
    const e = this.env;
    if (e.META_APP_ID && e.META_APP_SECRET) this.register(new MetaAdsAdapter({ appId: e.META_APP_ID, appSecret: e.META_APP_SECRET, graphVersion: e.META_GRAPH_VERSION, graphUrl: e.META_GRAPH_URL, oauthUrl: e.META_OAUTH_URL }));
    if (e.GOOGLE_ADS_CLIENT_ID && e.GOOGLE_ADS_CLIENT_SECRET && e.GOOGLE_ADS_DEVELOPER_TOKEN) {
      this.register(
        new GoogleAdsAdapter({
          clientId: e.GOOGLE_ADS_CLIENT_ID,
          clientSecret: e.GOOGLE_ADS_CLIENT_SECRET,
          developerToken: e.GOOGLE_ADS_DEVELOPER_TOKEN,
          loginCustomerId: e.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
          apiVersion: e.GOOGLE_ADS_API_VERSION,
          apiUrl: e.GOOGLE_ADS_API_URL,
          authUrl: e.GOOGLE_OAUTH_URL,
          tokenUrl: e.GOOGLE_TOKEN_URL,
          revokeUrl: e.GOOGLE_REVOKE_URL,
        }),
      );
    }
    this.logger.log(`Ads platforms: ${[...this.adapters.keys()].join(', ') || 'none configured'}`);
  }

  register(a: AdsPlatformAdapter): void {
    this.adapters.set(a.oauthId, a);
  }

  /** Test helper. */
  reset(): void {
    this.adapters.clear();
  }

  get(id: AdsProviderId): AdsPlatformAdapter | undefined {
    return this.adapters.get(id);
  }

  get cipher(): TokenCipher | null {
    return this.social.cipher;
  }

  redirectUri(id: AdsProviderId): string {
    return `${this.env.API_URL.replace(/\/$/, '')}/api/v1/ads/oauth/${id}/callback`;
  }

  info(): AdsProviderInfo[] {
    return ADS_PROVIDERS.map((id) => {
      const a = this.adapters.get(id);
      const reason = !a ? `An administrator must set ${ENV_NAMES[id]} on the server.` : !this.cipher ? 'An administrator must set TOKEN_ENCRYPTION_KEYS on the server.' : null;
      return { id, platform: PLATFORM_OF[id], name: id === 'meta_ads' ? 'Meta Ads' : 'Google Ads', configured: !reason, unavailableReason: reason, scopes: a?.scopes ?? [], redirectUri: this.redirectUri(id) };
    });
  }
}
