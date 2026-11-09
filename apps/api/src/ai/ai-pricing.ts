/**
 * Provider prices in micro-USD (1e-6 USD). Sources (checked Nov 2026):
 * Anthropic model table, OpenAI API pricing page, Google AI Studio pricing page.
 * Unknown models fall back to the provider's most expensive listed rate (never under-count cost).
 */
export interface TokenPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const TEXT_PRICES: Record<string, TokenPrice> = {
  // Anthropic
  'claude-opus-5-5': { inputPerMTok: 4_000_000, outputPerMTok: 20_000_000 },
  'claude-opus-5': { inputPerMTok: 5_000_000, outputPerMTok: 25_000_000 },
  'claude-opus-4-8': { inputPerMTok: 5_000_000, outputPerMTok: 25_000_000 },
  'claude-sonnet-5-5': { inputPerMTok: 2_000_000, outputPerMTok: 10_000_000 },
  'claude-haiku-5-5': { inputPerMTok: 100_000, outputPerMTok: 500_000 },
  'claude-fable-5-1': { inputPerMTok: 10_000_000, outputPerMTok: 50_000_000 },
  // OpenAI
  'gpt-6.1-sol': { inputPerMTok: 2_000_000, outputPerMTok: 10_000_000 },
  'gpt-6.1-terra': { inputPerMTok: 1_000_000, outputPerMTok: 5_000_000 },
  'gpt-6-luna': { inputPerMTok: 100_000, outputPerMTok: 500_000 },
  // Google
  'gemini-3.8-flash': { inputPerMTok: 750_000, outputPerMTok: 3_750_000 },
  'gemini-4-argon': { inputPerMTok: 2_000_000, outputPerMTok: 10_000_000 },
};

const FALLBACK_TEXT_PRICE: Record<string, TokenPrice> = {
  anthropic: { inputPerMTok: 10_000_000, outputPerMTok: 50_000_000 },
  openai: { inputPerMTok: 10_000_000, outputPerMTok: 50_000_000 },
  gemini: { inputPerMTok: 2_000_000, outputPerMTok: 12_000_000 },
};

/** Image generation: OpenAI bills tokens; Gemini bills per image. */
export const OPENAI_IMAGE_PRICES: Record<string, { textInputPerMTok: number; imageOutputPerMTok: number }> = {
  'gpt-image-2': { textInputPerMTok: 5_000_000, imageOutputPerMTok: 30_000_000 },
};
export const GEMINI_IMAGE_PRICES: Record<string, number> = {
  'gemini-3.1-flash-image': 67_000, // 1K image
  'gemini-3-pro-image': 134_000,
};

export function textCostMicroUsd(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const p = TEXT_PRICES[model] ?? FALLBACK_TEXT_PRICE[provider] ?? { inputPerMTok: 10_000_000, outputPerMTok: 50_000_000 };
  return Math.ceil((inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000);
}
