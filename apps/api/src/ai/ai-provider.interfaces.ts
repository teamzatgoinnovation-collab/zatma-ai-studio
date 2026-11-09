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
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** BCP-47 / ISO-639-1 language for the output (en, ml, ar, hi, ta, kn, te). */
  language?: string;
  responseFormat?: 'text' | 'json';
}

export interface TextGenerationResult {
  text: string;
  model: string;
  usage: AIUsage;
}

export interface ImageGenerationInput {
  prompt: string;
  model?: string;
  width: number;
  height: number;
  count?: number;
  negativePrompt?: string;
}

export interface ImageGenerationResult {
  images: Array<{ data: Buffer; mimeType: string }>;
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
  video?: { data: Buffer; mimeType: string };
  model: string;
  usage: AIUsage;
}

interface ProviderBase {
  readonly id: string;
  readonly name: string;
}

export interface AITextProvider extends ProviderBase {
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
}

export interface AIImageProvider extends ProviderBase {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

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

/** Providers we plan to support (Phase 4). Shown to admins with their configuration status. */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'openai', name: 'OpenAI', capabilities: ['TEXT', 'IMAGE', 'EMBEDDING'], envKey: 'OPENAI_API_KEY' },
  { id: 'anthropic', name: 'Anthropic', capabilities: ['TEXT'], envKey: 'ANTHROPIC_API_KEY' },
  { id: 'gemini', name: 'Google Gemini', capabilities: ['TEXT', 'IMAGE', 'EMBEDDING'], envKey: 'GEMINI_API_KEY' },
];
