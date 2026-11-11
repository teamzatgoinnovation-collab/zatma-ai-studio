import { PLATFORM_LABELS, type OAuthErrorCode, type SocialAccountDto, type SocialPlatform } from '@zatma/validation';

export const OAUTH_ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  access_denied: 'The connection was cancelled on the platform, so nothing was connected.',
  invalid_state: 'That sign-in link expired or was opened by a different user. Start the connection again.',
  provider_error: 'The platform returned an error while connecting. Try again in a few minutes.',
  not_configured: 'This platform has not been set up on the server yet.',
  no_accounts: 'No Pages, accounts or channels you manage were found for that login.',
};

export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return OAUTH_ERROR_MESSAGES[code as OAuthErrorCode] ?? 'Something went wrong while connecting. Try again.';
}

export const STATUS_BADGE: Record<SocialAccountDto['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  NEEDS_REAUTH: { label: 'Reconnect needed', tone: 'warning' },
  ERROR: { label: 'Error', tone: 'danger' },
  DISCONNECTED: { label: 'Disconnected', tone: 'neutral' },
};

/** Brand-coloured monogram for a platform (decorative). */
export const PLATFORM_MARK: Record<SocialPlatform, { text: string; className: string }> = {
  FACEBOOK_PAGE: { text: 'f', className: 'bg-[#1877F2] text-white' },
  INSTAGRAM_BUSINESS: { text: 'IG', className: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white' },
  LINKEDIN_PAGE: { text: 'in', className: 'bg-[#0A66C2] text-white' },
  YOUTUBE_CHANNEL: { text: '▶', className: 'bg-[#FF0000] text-white' },
};

export const platformLabel = (p: SocialPlatform) => PLATFORM_LABELS[p];

/** "All workspaces" when unrestricted, else the names (unknown ids are skipped). */
export function workspaceSummary(ids: string[], workspaces: Array<{ id: string; name: string }>): string {
  if (!ids.length) return 'All workspaces';
  const names = ids.map((id) => workspaces.find((w) => w.id === id)?.name).filter(Boolean);
  return names.length ? names.join(', ') : 'All workspaces';
}

/** Accounts grouped so a Page's linked Instagram account follows it. Sorted by status (problems first) then name. */
export function sortAccounts(accounts: SocialAccountDto[]): SocialAccountDto[] {
  const rank: Record<SocialAccountDto['status'], number> = { NEEDS_REAUTH: 0, ERROR: 1, ACTIVE: 2, DISCONNECTED: 3 };
  return [...accounts].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}
