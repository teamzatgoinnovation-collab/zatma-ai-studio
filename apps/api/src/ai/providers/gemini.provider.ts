import { ApiError, GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { AIProviderError, fromHttpStatus } from '../ai-errors.js';
import { GEMINI_IMAGE_PRICES, textCostMicroUsd } from '../ai-pricing.js';
import {
  buildInstructions,
  type AIImageProvider,
  type AITextProvider,
  type ImageGenerationInput,
  type ImageGenerationResult,
  type TextGenerationInput,
  type TextGenerationResult,
} from '../ai-provider.interfaces.js';

const ID = 'gemini';
type Models = Pick<GoogleGenAI['models'], 'generateContent'>;

function wrap(err: unknown): AIProviderError {
  if (err instanceof ApiError) return fromHttpStatus(ID, err.status, err.message);
  if (err instanceof AIProviderError) return err;
  return new AIProviderError(ID, 'unavailable', (err as Error).message, true);
}

const RATIOS: Array<[string, number]> = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
];

/** Closest supported aspect ratio for the requested canvas. */
export function geminiAspectRatio(width: number, height: number): string {
  const r = width / height;
  return RATIOS.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0];
}

function blockedReason(response: GenerateContentResponse): string | null {
  const block = response.promptFeedback?.blockReason;
  const finish = response.candidates?.[0]?.finishReason;
  if (block) return `prompt blocked (${block})`;
  if (finish && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'].includes(String(finish))) return `output blocked (${finish})`;
  return null;
}

export class GeminiTextProvider implements AITextProvider {
  readonly id = ID;
  readonly name = 'Google Gemini';

  constructor(
    private readonly models: Models,
    readonly defaultModel = 'gemini-3.8-flash',
  ) {}

  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const model = input.model ?? this.defaultModel;
    const systemInstruction = buildInstructions(input);
    let response: GenerateContentResponse;
    try {
      response = await this.models.generateContent({
        model,
        contents: input.prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          maxOutputTokens: input.maxOutputTokens ?? 16_000,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
          ...(input.timeoutMs ? { httpOptions: { timeout: input.timeoutMs } } : {}),
        },
      });
    } catch (err) {
      throw wrap(err);
    }
    const blocked = blockedReason(response);
    if (blocked) throw new AIProviderError(ID, 'refused', blocked, true);
    const text = response.text?.trim() ?? '';
    if (!text) throw new AIProviderError(ID, 'empty_output', 'The model returned no text', true);
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0);
    const finish = String(response.candidates?.[0]?.finishReason ?? '');
    return {
      text,
      model,
      usage: { inputTokens, outputTokens, costMicroUsd: textCostMicroUsd(ID, model, inputTokens, outputTokens) },
      finishReason: finish === 'MAX_TOKENS' ? 'length' : finish === 'STOP' ? 'stop' : 'other',
    };
  }
}

export class GeminiImageProvider implements AIImageProvider {
  readonly id = ID;
  readonly name = 'Google Gemini';

  constructor(
    private readonly models: Models,
    readonly defaultModel = 'gemini-3.1-flash-image',
  ) {}

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const model = input.model ?? this.defaultModel;
    const count = input.count ?? 1;
    const images: ImageGenerationResult['images'] = [];
    let inputTokens = 0;
    try {
      // The image model returns one image per call.
      for (let i = 0; i < count; i++) {
        const response = await this.models.generateContent({
          model,
          contents: input.prompt,
          config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: geminiAspectRatio(input.width, input.height), imageSize: '1K' } },
        });
        const blocked = blockedReason(response);
        if (blocked) throw new AIProviderError(ID, 'refused', blocked, true);
        inputTokens += response.usageMetadata?.promptTokenCount ?? 0;
        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) images.push({ data: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType ?? 'image/png' });
        }
      }
    } catch (err) {
      throw wrap(err);
    }
    if (images.length === 0) throw new AIProviderError(ID, 'empty_output', 'No image was returned', true);
    const perImage = GEMINI_IMAGE_PRICES[model] ?? GEMINI_IMAGE_PRICES['gemini-3-pro-image']!;
    return { images, model, usage: { inputTokens, units: images.length, costMicroUsd: perImage * images.length } };
  }
}

export function createGeminiProviders(apiKey: string, textModel?: string, imageModel?: string) {
  const ai = new GoogleGenAI({ apiKey });
  return { text: new GeminiTextProvider(ai.models, textModel), image: new GeminiImageProvider(ai.models, imageModel) };
}
