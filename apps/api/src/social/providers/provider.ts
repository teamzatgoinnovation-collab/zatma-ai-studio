import { createHash, randomBytes } from 'node:crypto';
import type { SocialPlatform, SocialProviderId } from '@zatma/validation';

export interface OAuthGrant {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  externalUserId: string;
  displayName: string | null;
}

export interface DiscoveredAccount {
  platform: SocialPlatform;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** Account-level token where the platform issues one (Meta page tokens); otherwise null. */
  accountToken: string | null;
  capabilities: Record<string, unknown>;
}

export type HealthResult = { status: 'ACTIVE' } | { status: 'NEEDS_REAUTH' | 'ERROR'; error: string };

export interface SocialProvider {
  readonly id: SocialProviderId;
  readonly name: string;
  readonly platforms: SocialPlatform[];
  readonly scopes: string[];
  readonly usesPkce: boolean;
  authorizeUrl(p: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchangeCode(p: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthGrant>;
  /** Renews an expiring grant. Undefined when the platform requires the user to re-authorise. */
  refresh?(grant: { refreshToken: string }): Promise<Omit<OAuthGrant, 'externalUserId' | 'displayName'>>;
  listAccounts(accessToken: string): Promise<DiscoveredAccount[]>;
  checkAccount(p: { platform: SocialPlatform; externalId: string; token: string }): Promise<HealthResult>;
  revoke(accessToken: string): Promise<void>;
}

/** The token is expired, revoked or lacks permissions: the user must reconnect. */
export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

/** Any other platform failure (outage, rate limit, unexpected payload). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** JSON request helper with platform-neutral error mapping. Never includes tokens in error messages. */
export async function requestJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { authErrors?: (status: number, body: unknown) => boolean } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new ProviderError(`Could not reach ${new URL(url).host}: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message = extractMessage(body) ?? `HTTP ${res.status}`;
    const isAuth = init.authErrors ? init.authErrors(res.status, body) : res.status === 401;
    if (isAuth) throw new ProviderAuthError(message);
    throw new ProviderError(message, res.status);
  }
  return body as T;
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return typeof body === 'string' && body ? body.slice(0, 200) : null;
  const b = body as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | string | undefined;
  if (typeof err === 'object' && err && typeof err.message === 'string') return err.message.slice(0, 300);
  if (typeof b.error_description === 'string') return b.error_description.slice(0, 300);
  if (typeof b.message === 'string') return b.message.slice(0, 300);
  if (typeof err === 'string') return err.slice(0, 300);
  return null;
}

export const form = (values: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined) p.set(k, v);
  return p;
};

export const expiresIn = (seconds: unknown): Date | null => (typeof seconds === 'number' && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null);

/** PKCE (RFC 7636, S256). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
