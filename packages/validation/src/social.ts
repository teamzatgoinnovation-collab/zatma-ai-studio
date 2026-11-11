import { z } from 'zod';

export const SOCIAL_PROVIDERS = ['meta', 'linkedin', 'google'] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];

export const SOCIAL_PLATFORMS = ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'LINKEDIN_PAGE', 'YOUTUBE_CHANNEL'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_STATUSES = ['ACTIVE', 'NEEDS_REAUTH', 'ERROR', 'DISCONNECTED'] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const PROVIDER_LABELS: Record<SocialProviderId, string> = { meta: 'Facebook & Instagram', linkedin: 'LinkedIn', google: 'YouTube' };
export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  FACEBOOK_PAGE: 'Facebook Page',
  INSTAGRAM_BUSINESS: 'Instagram Business',
  LINKEDIN_PAGE: 'LinkedIn Page',
  YOUTUBE_CHANNEL: 'YouTube channel',
};
export const PLATFORM_PROVIDER: Record<SocialPlatform, SocialProviderId> = { FACEBOOK_PAGE: 'meta', INSTAGRAM_BUSINESS: 'meta', LINKEDIN_PAGE: 'linkedin', YOUTUBE_CHANNEL: 'google' };

/** OAuth error codes passed back to the web app after the callback. */
export const OAUTH_ERRORS = ['access_denied', 'invalid_state', 'provider_error', 'not_configured', 'no_accounts'] as const;
export type OAuthErrorCode = (typeof OAUTH_ERRORS)[number];

export const connectSocialSchema = z
  .object({
    /** Web path to return to after the OAuth round trip. Must be a same-site path. */
    returnTo: z
      .string()
      .max(200)
      .regex(/^\/(?!\/)[\w\-/?=&.%]*$/, 'Must be a path on this site')
      .optional(),
    reconnectConnectionId: z.uuid().optional(),
  })
  .strict();
export type ConnectSocialInput = z.infer<typeof connectSocialSchema>;

export const addSocialAccountsSchema = z
  .object({
    connectionId: z.uuid(),
    externalIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    /** Empty = available in every workspace. */
    workspaceIds: z.array(z.uuid()).max(50).default([]),
  })
  .strict();
export type AddSocialAccountsInput = z.infer<typeof addSocialAccountsSchema>;

export const updateSocialAccountSchema = z.object({ workspaceIds: z.array(z.uuid()).max(50) }).strict();
export type UpdateSocialAccountInput = z.infer<typeof updateSocialAccountSchema>;

export interface SocialProviderInfo {
  id: SocialProviderId;
  name: string;
  platforms: SocialPlatform[];
  configured: boolean;
  /** Why it can't be used yet (e.g. missing app keys or encryption key). */
  unavailableReason: string | null;
  scopes: string[];
  /** Redirect URI to register in the platform's developer console. */
  redirectUri: string;
}

export interface AvailableSocialAccount {
  platform: SocialPlatform;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** Already connected in this organization. */
  alreadyAdded: boolean;
}

export interface SocialConnectionSummary {
  id: string;
  provider: SocialProviderId;
  displayName: string | null;
  status: 'ACTIVE' | 'NEEDS_REAUTH' | 'REVOKED';
  expiresAt: string | null;
  scopes: string[];
}

export interface SocialAccountDto {
  id: string;
  platform: SocialPlatform;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: SocialAccountStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  workspaceIds: string[];
  connection: SocialConnectionSummary;
  connectedBy: { id: string; name: string } | null;
  createdAt: string;
}
