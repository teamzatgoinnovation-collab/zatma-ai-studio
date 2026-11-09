/**
 * Credits are the customer-facing unit counted against plan limits (Plan.limits.aiCredits).
 * Provider cost (micro-USD) is tracked separately for margin reporting and never shown to customers.
 */
export const CREDITS = {
  /** One text generation costs 1 credit per started block of 4,000 tokens (input + output). */
  textTokensPerCredit: 4_000,
  /** One generated image (about 1 megapixel) costs 4 credits. */
  perImage: 4,
} as const;

export function textCredits(inputTokens: number, outputTokens: number): number {
  return Math.max(1, Math.ceil((inputTokens + outputTokens) / CREDITS.textTokensPerCredit));
}

/** Upper-bound estimate before calling a provider, used for the plan-limit pre-check. */
export function estimateTextCredits(prompt: string, maxOutputTokens: number): number {
  const promptTokens = Math.ceil(prompt.length / 3); // conservative for non-Latin scripts
  return textCredits(promptTokens, maxOutputTokens);
}

export const imageCredits = (count: number) => CREDITS.perImage * count;
