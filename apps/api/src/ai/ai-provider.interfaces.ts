import type { AICapability } from '@zatma/types';

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Images generated, seconds of video, etc. */
  units?: number;
  costMicroUsd: number;
}

export interface TextGenerationInput {
  system?: string;
  prompt: string;
  /** Overrides the provider's configured model. */
  model?: string;
  maxOutputTokens?: number;
  /** 0–1. Ignored by providers that no longer support sampling parameters (current Claude models). */
  temperature?: number;
  /** ISO-639-1 output language (en, ml, ar, hi, ta, kn, te). Adapters add it to the instructions. */
  language?: string;
  responseFormat?: 'text' | 'json';
  /** Abort long requests (ms). */
  timeoutMs?: number;
}

export interface TextGenerationResult {
  text: string;
  /** Model that actually produced the output (may differ from the requested one after a server-side fallback). */
  model: string;
  usage: AIUsage;
  finishReason: 'stop' | 'length' | 'other';
}

export interface ImageGenerationInput {
  prompt: string;
  model?: string;
  width: number;
  height: number;
  count?: number;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
}

export interface ImageGenerationResult {
  images: GeneratedImage[];
  model: string;
  usage: AIUsage;
}

export interface VideoGenerationInput {
  prompt: string;
  model?: string;
  durationSeconds: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  imageUrl?: string;
}

export interface VideoGenerationResult {
  /** Providers are asynchronous: return a provider job id to poll, or the final video. */
  providerJobId?: string;
  video?: GeneratedImage;
  model: string;
  usage: AIUsage;
}

interface ProviderBase {
  /** Provider id: 'anthropic' | 'openai' | 'gemini' | … */
  readonly id: string;
  readonly name: string;
  /** Model used when the request doesn't name one. */
  readonly defaultModel: string;
}

export interface AITextProvider extends ProviderBase {
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
}

export interface AIImageProvider extends ProviderBase {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

/** Implemented in Phase 16 (AI Video Studio). */
export interface AIVideoProvider extends ProviderBase {
  generateVideo(input: VideoGenerationInput): Promise<VideoGenerationResult>;
}

export type AnyProvider = AITextProvider | AIImageProvider | AIVideoProvider;

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  capabilities: AICapability[];
  envKey: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY';
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'anthropic', name: 'Anthropic', capabilities: ['TEXT'], envKey: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI', capabilities: ['TEXT', 'IMAGE'], envKey: 'OPENAI_API_KEY' },
  { id: 'gemini', name: 'Google Gemini', capabilities: ['TEXT', 'IMAGE'], envKey: 'GEMINI_API_KEY' },
];

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ml: 'Malayalam',
  ar: 'Arabic',
  hi: 'Hindi',
  ta: 'Tamil',
  kn: 'Kannada',
  te: 'Telugu',
};

/** Shared instruction suffix so every provider honours language and JSON requests the same way. */
export function buildInstructions(input: Pick<TextGenerationInput, 'system' | 'language' | 'responseFormat'>): string | undefined {
  const parts = [input.system?.trim()].filter(Boolean) as string[];
  if (input.language && input.language !== 'en') {
    parts.push(`Write the response in ${LANGUAGE_NAMES[input.language] ?? input.language}, using its native script.`);
  }
  if (input.responseFormat === 'json') {
    parts.push('Respond with a single valid JSON value only: no prose, no markdown code fences.');
  }
  return parts.length ? parts.join('\n\n') : undefined;
}
