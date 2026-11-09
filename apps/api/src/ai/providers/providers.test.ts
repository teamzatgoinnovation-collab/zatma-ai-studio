import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AIProviderError, fromHttpStatus } from '../ai-errors.js';
import { textCostMicroUsd } from '../ai-pricing.js';
import { buildInstructions } from '../ai-provider.interfaces.js';
import { AnthropicTextProvider } from './anthropic.provider.js';
import { GeminiImageProvider, GeminiTextProvider, geminiAspectRatio } from './gemini.provider.js';
import { OpenAIImageProvider, OpenAITextProvider, openAiImageSize } from './openai.provider.js';

const anthropicClient = (impl: (params: Record<string, unknown>) => unknown) => {
  const create = vi.fn(async (params: Record<string, unknown>) => impl(params));
  return { client: { beta: { messages: { create } } } as unknown as Pick<Anthropic, 'beta'>, create };
};

describe('AnthropicTextProvider', () => {
  const ok = { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Onam offer!' }], usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };

  it('sends current-API parameters: no temperature, effort, server-side fallback', async () => {
    const { client, create } = anthropicClient(() => ok);
    const p = new AnthropicTextProvider(client);
    const r = await p.generateText({ prompt: 'Write a caption', system: 'You are a marketer', language: 'ml', temperature: 0.9, maxOutputTokens: 500 });
    const params = create.mock.calls[0]![0];
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 500, output_config: { effort: 'medium' }, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
    expect(params.system).toContain('Malayalam');
    expect(r).toMatchObject({ text: 'Onam offer!', model: 'claude-opus-5-5', finishReason: 'stop' });
    expect(r.usage.costMicroUsd).toBe(textCostMicroUsd('anthropic', 'claude-opus-5-5', 100, 50));
  });

  it('prices by the model that actually served the request', async () => {
    const { client } = anthropicClient(() => ({ ...ok, model: 'claude-opus-4-8' }));
    const r = await new AnthropicTextProvider(client).generateText({ prompt: 'x' });
    expect(r.model).toBe('claude-opus-4-8');
    expect(r.usage.costMicroUsd).toBe(textCostMicroUsd('anthropic', 'claude-opus-4-8', 100, 50));
  });

  it('turns refusals and empty output into retryable errors', async () => {
    const refused = anthropicClient(() => ({ ...ok, stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }));
    await expect(new AnthropicTextProvider(refused.client).generateText({ prompt: 'x' })).rejects.toMatchObject({ kind: 'refused', retryable: true });
    const empty = anthropicClient(() => ({ ...ok, content: [] }));
    await expect(new AnthropicTextProvider(empty.client).generateText({ prompt: 'x' })).rejects.toMatchObject({ kind: 'empty_output' });
  });

  it('classifies SDK API errors by status', async () => {
    const { client } = anthropicClient(() => {
      throw new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
    });
    await expect(new AnthropicTextProvider(client).generateText({ prompt: 'x' })).rejects.toMatchObject({ kind: 'rate_limited', retryable: true, status: 429 });
  });
});

describe('OpenAI providers', () => {
  it('uses the Responses API with instructions, JSON mode and token usage', async () => {
    const create = vi.fn(async (_params: Record<string, unknown>) => ({ model: 'gpt-6.1-sol', status: 'completed', output_text: '{"headline":"Hi"}', usage: { input_tokens: 40, output_tokens: 10 } }));
    const p = new OpenAITextProvider({ responses: { create } } as never);
    const r = await p.generateText({ prompt: 'p', system: 's', responseFormat: 'json', temperature: 0.4 });
    expect(create.mock.calls[0]![0]).toMatchObject({ model: 'gpt-6.1-sol', input: 'p', temperature: 0.4, text: { format: { type: 'json_object' } } });
    expect(String(create.mock.calls[0]![0].instructions)).toContain('valid JSON');
    expect(r).toMatchObject({ text: '{"headline":"Hi"}', finishReason: 'stop', usage: { inputTokens: 40, outputTokens: 10 } });
  });

  it('returns decoded PNG images and token-based cost', async () => {
    const png = Buffer.from('fake-png');
    const generate = vi.fn(async (_params: Record<string, unknown>) => ({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 20, output_tokens: 1000 } }));
    const r = await new OpenAIImageProvider({ images: { generate } } as never).generateImage({ prompt: 'poster', width: 1080, height: 1920 });
    expect(generate.mock.calls[0]![0]).toMatchObject({ model: 'gpt-image-2', size: '1024x1536', n: 1 });
    expect(r.images[0]!.data.equals(png)).toBe(true);
    expect(r.usage).toMatchObject({ units: 1, costMicroUsd: Math.ceil((20 * 5_000_000 + 1000 * 30_000_000) / 1_000_000) });
  });

  it('maps canvas sizes to supported image sizes', () => {
    expect(openAiImageSize(1080, 1080)).toBe('1024x1024');
    expect(openAiImageSize(1280, 720)).toBe('1536x1024');
    expect(openAiImageSize(1080, 1920)).toBe('1024x1536');
  });
});

describe('Gemini providers', () => {
  it('generates text with system instruction and usage metadata', async () => {
    const generateContent = vi.fn(async (_params: Record<string, unknown>) => ({ text: 'Hello', candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 2 } }));
    const r = await new GeminiTextProvider({ generateContent } as never).generateText({ prompt: 'p', system: 's', responseFormat: 'json' });
    expect(generateContent.mock.calls[0]![0]).toMatchObject({ model: 'gemini-3.8-flash', contents: 'p', config: { systemInstruction: expect.stringContaining('s'), responseMimeType: 'application/json' } });
    expect(r).toMatchObject({ text: 'Hello', usage: { inputTokens: 12, outputTokens: 5 }, finishReason: 'stop' });
  });

  it('reports safety blocks as refusals', async () => {
    const generateContent = vi.fn(async (_params: Record<string, unknown>) => ({ text: undefined, promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(new GeminiTextProvider({ generateContent } as never).generateText({ prompt: 'p' })).rejects.toMatchObject({ kind: 'refused' });
  });

  it('extracts inline image data, one call per image, with aspect ratio', async () => {
    const generateContent = vi.fn(async (_params: Record<string, unknown>) => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('img').toString('base64'), mimeType: 'image/png' } }] } }], usageMetadata: { promptTokenCount: 5 } }));
    const r = await new GeminiImageProvider({ generateContent } as never).generateImage({ prompt: 'p', width: 1280, height: 720, count: 2 });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0]![0]).toMatchObject({ config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } } });
    expect(r.images).toHaveLength(2);
    expect(r.usage.costMicroUsd).toBe(2 * 67_000);
    expect(geminiAspectRatio(1080, 1920)).toBe('9:16');
  });
});

describe('shared helpers', () => {
  it('builds instructions for language and JSON', () => {
    expect(buildInstructions({})).toBeUndefined();
    expect(buildInstructions({ language: 'ar', responseFormat: 'json' })).toMatch(/Arabic[\s\S]*JSON/);
    expect(buildInstructions({ language: 'en' })).toBeUndefined();
  });

  it('classifies HTTP statuses', () => {
    expect(fromHttpStatus('x', 400, 'bad')).toMatchObject({ kind: 'invalid_request', retryable: false });
    expect(fromHttpStatus('x', 503, 'down')).toMatchObject({ kind: 'unavailable', retryable: true });
    expect(fromHttpStatus('x', 401, 'key')).toMatchObject({ kind: 'auth', retryable: true });
    expect(new AIProviderError('x', 'refused', 'm', true)).toBeInstanceOf(Error);
  });

  it('never under-prices unknown models', () => {
    expect(textCostMicroUsd('anthropic', 'claude-future-9', 1_000_000, 0)).toBe(10_000_000);
  });
});
