import { createHash, randomBytes } from 'node:crypto';
import type { SocialPlatform, SocialProviderId, TargetOptions } from '@zatma/validation';

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
  /** Publishes one post to one account (Phase 10). Must be safe to call again with the saved state. */
  publish?(req: PublishRequest): Promise<PublishResult>;
}

/** Media as seen by an adapter: never a public URL, only on-demand signed URLs or byte ranges. */
export interface PublishMedia {
  kind: 'image' | 'video';
  mimeType: string;
  width: number;
  height: number;
  durationSec?: number;
  sizeBytes: number;
  altText?: string;
  /** Short-lived signed URL the platform fetches itself (Meta). */
  signedUrl(): Promise<string>;
  /** Bytes [start, end] inclusive, for uploads we push (LinkedIn, YouTube). */
  read(start: number, end: number): Promise<Buffer>;
}

export interface PublishRequest {
  platform: SocialPlatform;
  /** The account's id on the platform (Page id, IG user id, organization id, channel id). */
  externalId: string;
  capabilities: Record<string, unknown>;
  token: string;
  /** Final text (caption or per-account override, plus hashtags). */
  text: string;
  hashtags: string[];
  media: PublishMedia[];
  options: TargetOptions;
  /** Progress saved by earlier attempts (container ids, upload sessions, created post id). */
  state: Record<string, unknown>;
  /** Persists progress immediately so a retry never repeats a completed step. */
  saveState(patch: Record<string, unknown>): Promise<void>;
}

export type PublishResult =
  | { status: 'published'; externalId: string; url: string | null }
  /** The platform is still processing (Instagram containers, LinkedIn videos): try again later. */
  | { status: 'processing'; retryAfterMs: number };

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
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Meta Graph codes for temporary conditions (unknown/service errors, throttling). */
const META_TRANSIENT = new Set([1, 2, 4, 17, 32, 341, 613]);

/** Whether a failed publish attempt may succeed if retried (network, 429, 5xx, platform-transient). */
export function isRetryable(e: unknown): boolean {
  if (e instanceof ProviderAuthError) return false;
  if (!(e instanceof ProviderError)) return false;
  if (e.status === undefined || e.status === 429 || e.status >= 500) return true;
  const err = (e.body as { error?: { code?: number; is_transient?: boolean } } | null)?.error;
  return !!err && (err.is_transient === true || (typeof err.code === 'number' && META_TRANSIENT.has(err.code)));
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
  const body = await readBody(res);
  if (!res.ok) throwFor(res.status, body, init.authErrors);
  return body as T;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function throwFor(status: number, body: unknown, authErrors?: (status: number, body: unknown) => boolean): never {
  const message = extractMessage(body) ?? `HTTP ${status}`;
  const isAuth = authErrors ? authErrors(status, body) : status === 401;
  if (isAuth) throw new ProviderAuthError(message);
  throw new ProviderError(message, status, body);
}

/**
 * Raw request for uploads and endpoints that answer with headers rather than JSON
 * (LinkedIn `x-restli-id`, YouTube resumable `Location` / 308). `okStatuses` extends the accepted codes.
 */
export async function requestRaw(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { authErrors?: (status: number, body: unknown) => boolean; okStatuses?: number[]; timeoutMs?: number } = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 120_000) });
  } catch (e) {
    throw new ProviderError(`Could not reach ${new URL(url).host}: ${(e as Error).message}`);
  }
  const body = await readBody(res);
  if (!res.ok && !init.okStatuses?.includes(res.status)) throwFor(res.status, body, init.authErrors);
  return { status: res.status, headers: res.headers, body };
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
