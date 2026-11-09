/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeRedirect(target: string | null | undefined, fallback = '/dashboard'): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}

/**
 * Better Auth resolves relative callback URLs against the API's base URL, so links in emails
 * must carry the web origin explicitly. (The origin is in the API's trusted origins.)
 */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}
