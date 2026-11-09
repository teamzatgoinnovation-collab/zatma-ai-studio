/**
 * Normalised provider failure. `retryable` decides whether the fallback chain moves on to the next
 * provider (rate limits, outages, refusals, timeouts) or stops (bad request from our side).
 */
export class AIProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: 'rate_limited' | 'unavailable' | 'refused' | 'invalid_request' | 'auth' | 'empty_output' | 'unknown',
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Maps an HTTP status from any provider SDK to a normalised error. */
export function fromHttpStatus(provider: string, status: number | undefined, message: string): AIProviderError {
  if (status === 429) return new AIProviderError(provider, 'rate_limited', message, true, status);
  if (status === 401 || status === 403) return new AIProviderError(provider, 'auth', message, true, status);
  if (status === 400 || status === 404 || status === 413 || status === 422) return new AIProviderError(provider, 'invalid_request', message, false, status);
  if (status !== undefined && status >= 500) return new AIProviderError(provider, 'unavailable', message, true, status);
  return new AIProviderError(provider, 'unknown', message, true, status);
}
