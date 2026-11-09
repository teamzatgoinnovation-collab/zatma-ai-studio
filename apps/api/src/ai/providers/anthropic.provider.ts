import Anthropic from '@anthropic-ai/sdk';
import { AIProviderError, fromHttpStatus } from '../ai-errors.js';
import { textCostMicroUsd } from '../ai-pricing.js';
import { buildInstructions, type AITextProvider, type TextGenerationInput, type TextGenerationResult } from '../ai-provider.interfaces.js';

const ID = 'anthropic';

/**
 * Claude via the official Anthropic SDK (Messages API).
 * - Current Claude models reject sampling parameters, so `temperature` is not sent.
 * - Thinking is left at the model default (adaptive); depth is controlled with `output_config.effort`.
 * - Server-side refusal fallback (`fallbacks: "default"`) is enabled so a policy decline is retried on
 *   an appropriate model inside the same call; the served model is read from `response.model`.
 */
export class AnthropicTextProvider implements AITextProvider {
  readonly id = ID;
  readonly name = 'Anthropic';

  constructor(
    private readonly client: Pick<Anthropic, 'beta'>,
    readonly defaultModel = 'claude-opus-5-5',
    private readonly effort: 'low' | 'medium' | 'high' = 'medium',
  ) {}

  static create(apiKey: string, model?: string, effort?: 'low' | 'medium' | 'high'): AnthropicTextProvider {
    return new AnthropicTextProvider(new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 }), model, effort);
  }

  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const model = input.model ?? this.defaultModel;
    const system = buildInstructions(input);
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model,
          max_tokens: input.maxOutputTokens ?? 16_000,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: input.prompt }],
          output_config: { effort: this.effort },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        input.timeoutMs ? { timeout: input.timeoutMs } : undefined,
      );
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw fromHttpStatus(ID, err.status, err.message);
      throw new AIProviderError(ID, 'unavailable', (err as Error).message, true);
    }

    if (response.stop_reason === 'refusal') {
      throw new AIProviderError(ID, 'refused', `Request declined${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`, true);
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new AIProviderError(ID, 'empty_output', 'The model returned no text', true);

    const inputTokens = response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    const outputTokens = response.usage.output_tokens;
    return {
      text,
      model: response.model,
      usage: { inputTokens, outputTokens, costMicroUsd: textCostMicroUsd(ID, response.model, inputTokens, outputTokens) },
      finishReason: response.stop_reason === 'max_tokens' ? 'length' : response.stop_reason === 'end_turn' ? 'stop' : 'other',
    };
  }
}
