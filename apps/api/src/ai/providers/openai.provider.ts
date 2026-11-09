import OpenAI from 'openai';
import { AIProviderError, fromHttpStatus } from '../ai-errors.js';
import { OPENAI_IMAGE_PRICES, textCostMicroUsd } from '../ai-pricing.js';
import {
  buildInstructions,
  type AIImageProvider,
  type AITextProvider,
  type ImageGenerationInput,
  type ImageGenerationResult,
  type TextGenerationInput,
  type TextGenerationResult,
} from '../ai-provider.interfaces.js';

const ID = 'openai';

function wrap(err: unknown): AIProviderError {
  if (err instanceof OpenAI.APIError) return fromHttpStatus(ID, err.status, err.message);
  return new AIProviderError(ID, 'unavailable', (err as Error).message, true);
}

/** Picks the supported gpt-image size closest to the requested aspect ratio. */
export function openAiImageSize(width: number, height: number): '1024x1024' | '1536x1024' | '1024x1536' {
  const ratio = width / height;
  if (ratio > 1.2) return '1536x1024';
  if (ratio < 0.83) return '1024x1536';
  return '1024x1024';
}

/** OpenAI text via the Responses API. */
export class OpenAITextProvider implements AITextProvider {
  readonly id = ID;
  readonly name = 'OpenAI';

  constructor(
    private readonly client: Pick<OpenAI, 'responses'>,
    readonly defaultModel = 'gpt-6.1-sol',
  ) {}

  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const model = input.model ?? this.defaultModel;
    const instructions = buildInstructions(input);
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create(
        {
          model,
          input: input.prompt,
          ...(instructions ? { instructions } : {}),
          max_output_tokens: input.maxOutputTokens ?? 16_000,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.responseFormat === 'json' ? { text: { format: { type: 'json_object' } } } : {}),
        },
        input.timeoutMs ? { timeout: input.timeoutMs } : undefined,
      );
    } catch (err) {
      throw wrap(err);
    }
    const text = response.output_text?.trim() ?? '';
    if (!text) throw new AIProviderError(ID, 'empty_output', 'The model returned no text', true);
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    return {
      text,
      model: response.model,
      usage: { inputTokens, outputTokens, costMicroUsd: textCostMicroUsd(ID, response.model, inputTokens, outputTokens) },
      finishReason: response.status === 'incomplete' ? 'length' : response.status === 'completed' ? 'stop' : 'other',
    };
  }
}

/** OpenAI image generation (gpt-image models return base64 data and token usage). */
export class OpenAIImageProvider implements AIImageProvider {
  readonly id = ID;
  readonly name = 'OpenAI';

  constructor(
    private readonly client: Pick<OpenAI, 'images'>,
    readonly defaultModel = 'gpt-image-2',
  ) {}

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const model = input.model ?? this.defaultModel;
    let response: OpenAI.Images.ImagesResponse;
    try {
      response = await this.client.images.generate({
        model,
        prompt: input.prompt,
        n: input.count ?? 1,
        size: openAiImageSize(input.width, input.height),
        output_format: 'png',
      });
    } catch (err) {
      throw wrap(err);
    }
    const images = (response.data ?? []).filter((d) => d.b64_json).map((d) => ({ data: Buffer.from(d.b64_json as string, 'base64'), mimeType: 'image/png' }));
    if (images.length === 0) throw new AIProviderError(ID, 'empty_output', 'No image was returned', true);
    const price = OPENAI_IMAGE_PRICES[model] ?? OPENAI_IMAGE_PRICES['gpt-image-2']!;
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    // Without reported usage, assume ~1.5k output image tokens per 1024px image (conservative).
    const billedOutput = outputTokens || 1_500 * images.length;
    const costMicroUsd = Math.ceil((inputTokens * price.textInputPerMTok + billedOutput * price.imageOutputPerMTok) / 1_000_000);
    return { images, model, usage: { inputTokens, outputTokens: billedOutput, units: images.length, costMicroUsd } };
  }
}

export function createOpenAIProviders(apiKey: string, textModel?: string, imageModel?: string) {
  const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 120_000 });
  return { text: new OpenAITextProvider(client, textModel), image: new OpenAIImageProvider(client, imageModel) };
}
