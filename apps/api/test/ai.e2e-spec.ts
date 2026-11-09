import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIProviderError } from '../src/ai/ai-errors.js';
import { AIProviderRegistry } from '../src/ai/ai-provider.registry.js';
import type { AIImageProvider, AITextProvider } from '../src/ai/ai-provider.interfaces.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, MemoryObjectStorage } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, type TestUser } from './helpers.js';

function textProvider(id: string, impl: () => Promise<string> | string): AITextProvider & { calls: number } {
  const p = {
    id,
    name: id,
    defaultModel: `${id}-model`,
    calls: 0,
    async generateText() {
      p.calls++;
      const text = await impl();
      return { text, model: `${id}-model`, usage: { inputTokens: 1200, outputTokens: 3000, costMicroUsd: 1234 }, finishReason: 'stop' as const };
    },
  };
  return p;
}

const imageProvider = (id: string): AIImageProvider => ({
  id,
  name: id,
  defaultModel: `${id}-image`,
  async generateImage(input) {
    return { images: Array.from({ length: input.count ?? 1 }, () => ({ data: Buffer.from('png-bytes'), mimeType: 'image/png' })), model: `${id}-image`, usage: { units: input.count ?? 1, costMicroUsd: 67_000 } };
  },
});

const fail = (provider: string, kind: AIProviderError['kind'], retryable = true) => () => {
  throw new AIProviderError(provider, kind, `${provider} ${kind}`, retryable);
};

async function waitForJob(app: NestExpressApplication, user: TestUser, id: string) {
  for (let i = 0; i < 80; i++) {
    const res = await api(app, user).get(`/ai/jobs/${id}`).expect(200);
    if (['SUCCEEDED', 'FAILED'].includes(res.body.status)) return res.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('job did not finish');
}

describe('AI generation (e2e)', () => {
  let app: NestExpressApplication;
  let registry: AIProviderRegistry;
  let owner: TestUser;
  let orgId: string;
  const storage = new MemoryObjectStorage();

  beforeAll(async () => {
    app = await createTestApp({ storage });
    registry = app.get(AIProviderRegistry);
    owner = await signUp(app, 'AI Owner');
    orgId = await createOrg(app, owner, 'AI Org');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => registry.reset());

  it('reports providers honestly when no keys are configured', async () => {
    const res = await api(app, owner).get('/ai/providers').expect(200);
    expect(res.body.every((p: { implemented: boolean; configured: boolean }) => !p.implemented && !p.configured)).toBe(true);
    const gen = await api(app, owner).post('/ai/text', { prompt: 'Write an Onam caption' }).expect(503);
    expect(gen.body.code).toBe('AI_PROVIDER_UNAVAILABLE');
  });

  it('falls back to the next provider and meters every attempt', async () => {
    const anthropic = textProvider('anthropic', fail('anthropic', 'rate_limited'));
    const openai = textProvider('openai', () => 'ഓണം ഓഫർ!');
    registry.register('TEXT', anthropic);
    registry.register('TEXT', openai);

    const res = await api(app, owner).post('/ai/text', { prompt: 'Write an Onam sale caption', language: 'ml', purpose: 'copywriter' }).expect(200);
    expect(res.body).toMatchObject({ text: 'ഓണം ഓഫർ!', provider: 'openai', model: 'openai-model', credits: 2, fallbackFrom: ['anthropic'] });

    const rows = await app.get(PrismaService).system.aiUsage.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.provider, r.status, r.credits, r.errorKind])).toEqual([
      ['anthropic', 'FAILED', 0, 'rate_limited'],
      ['openai', 'SUCCEEDED', 2, null],
    ]);
    expect(rows[1]!.costMicroUsd).toBe(1234n);
    expect(rows[1]!.purpose).toBe('copywriter');

    const usage = await api(app, owner).get('/ai/usage').expect(200);
    expect(usage.body.credits).toMatchObject({ used: 2 });
    expect(usage.body.byProvider).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'anthropic', failures: 1, credits: 0 })]));
    expect(JSON.stringify(usage.body)).not.toContain('costMicroUsd');
  });

  it('honours the organization preference and validates it', async () => {
    registry.register('TEXT', textProvider('anthropic', () => 'from anthropic'));
    registry.register('TEXT', textProvider('openai', () => 'from openai'));
    const settings = await api(app, owner).patch('/ai/settings', { textProvider: 'openai' }).expect(200);
    expect(settings.body.textOrder).toEqual(['openai', 'anthropic']);
    expect((await api(app, owner).post('/ai/text', { prompt: 'Write a caption' }).expect(200)).body.provider).toBe('openai');
    // Per-request override wins
    expect((await api(app, owner).post('/ai/text', { prompt: 'Write a caption', provider: 'anthropic' }).expect(200)).body.provider).toBe('anthropic');
    const bad = await api(app, owner).patch('/ai/settings', { textProvider: 'gemini' }).expect(422);
    expect(bad.body.code).toBe('AI_PROVIDER_NOT_AVAILABLE');
    await api(app, owner).patch('/ai/settings', { textProvider: null }).expect(200);
  });

  it('stops the chain on a non-retryable error', async () => {
    const first = textProvider('anthropic', fail('anthropic', 'invalid_request', false));
    const second = textProvider('openai', () => 'should not run');
    registry.register('TEXT', first);
    registry.register('TEXT', second);
    const res = await api(app, owner).post('/ai/text', { prompt: 'Write a caption' }).expect(422);
    expect(res.body.code).toBe('AI_REQUEST_REJECTED');
    expect(second.calls).toBe(0);
  });

  it('reports refusals from every provider distinctly', async () => {
    registry.register('TEXT', textProvider('anthropic', fail('anthropic', 'refused')));
    registry.register('TEXT', textProvider('gemini', fail('gemini', 'refused')));
    const res = await api(app, owner).post('/ai/text', { prompt: 'Something disallowed' }).expect(422);
    expect(res.body.code).toBe('AI_CONTENT_REFUSED');
    registry.reset();
    registry.register('TEXT', textProvider('anthropic', fail('anthropic', 'unavailable')));
    expect((await api(app, owner).post('/ai/text', { prompt: 'Write a caption' }).expect(503)).body.code).toBe('AI_PROVIDERS_FAILED');
  });

  it('generates images through the queue and stores them as private files', async () => {
    registry.register('IMAGE', imageProvider('openai'));
    const created = await api(app, owner).post('/ai/jobs', { type: 'IMAGE', input: { prompt: 'Onam sale poster background, blue', width: 1080, height: 1080, count: 2 } }).expect(202);
    expect(created.body.status).toBe('QUEUED');
    const job = await waitForJob(app, owner, created.body.id);
    expect(job).toMatchObject({ status: 'SUCCEEDED', provider: 'openai', credits: 8 });
    expect(job.output.files).toHaveLength(2);
    expect(job.output.files[0].url).toContain('X-Amz-Signature');
    const files = await app.get(PrismaService).system.storedFile.findMany({ where: { organizationId: orgId, purpose: 'AI_IMAGE' } });
    expect(files).toHaveLength(2);
    expect(storage.objects.get(files[0]!.key)).toMatchObject({ contentType: 'image/png' });
    const list = await api(app, owner).get('/ai/jobs').expect(200);
    expect(list.body.data[0].id).toBe(created.body.id);
  });

  it('records failed jobs with a safe error', async () => {
    registry.register('TEXT', textProvider('anthropic', fail('anthropic', 'unavailable')));
    const created = await api(app, owner).post('/ai/jobs', { type: 'TEXT', input: { prompt: 'Long blog outline please' } }).expect(202);
    const job = await waitForJob(app, owner, created.body.id);
    expect(job).toMatchObject({ status: 'FAILED', error: { code: 'AI_PROVIDERS_FAILED' }, output: null });
    expect(JSON.stringify(job)).not.toContain('anthropic unavailable');
  });

  it('rejects unknown job types and invalid input', async () => {
    await api(app, owner).post('/ai/jobs', { type: 'VIDEO', input: { prompt: 'x' } }).expect(400);
    await api(app, owner).post('/ai/text', { prompt: 'x' }).expect(400);
    await api(app, owner).post('/ai/text', { prompt: 'Write it', maxOutputTokens: 100000 }).expect(400);
  });

  it('enforces plan AI credits', async () => {
    registry.register('TEXT', textProvider('anthropic', () => 'ok'));
    const u = await signUp(app, 'Credit User');
    const otherOrg = await createOrg(app, u, 'Credit Org');
    await api(app, u).post('/billing/change-plan', { plan: 'FREE' }).expect(200); // 20 credits
    await app.get(PrismaService).system.aiUsage.create({
      data: { organizationId: otherOrg, capability: 'TEXT', provider: 'anthropic', model: 'm', credits: 20, status: 'SUCCEEDED' },
    });
    const res = await api(app, u).post('/ai/text', { prompt: 'Write a caption', maxOutputTokens: 2000 }).expect(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { metric: 'aiCredits', limit: 20 } });
    await api(app, u).post('/ai/jobs', { type: 'IMAGE', input: { prompt: 'poster' } }).expect(402);
  });

  it('applies permissions and tenant isolation', async () => {
    registry.register('TEXT', textProvider('anthropic', () => 'ok'));
    const viewer = await signUp(app, 'AI Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    await api(app, viewer).get('/ai/usage').expect(200);
    await api(app, viewer).post('/ai/text', { prompt: 'Write a caption' }).expect(403);
    await api(app, viewer).patch('/ai/settings', { textProvider: null }).expect(403);

    const designer = await signUp(app, 'AI Designer');
    await inviteAndAccept(app, owner, designer, orgId, 'designer');
    await api(app, designer).post('/ai/text', { prompt: 'Write a caption' }).expect(200);

    const created = await api(app, owner).post('/ai/jobs', { type: 'TEXT', input: { prompt: 'Private text job' } }).expect(202);
    const outsider = await signUp(app, 'Outsider');
    await createOrg(app, outsider, 'Outsider Org');
    await api(app, outsider).get(`/ai/jobs/${created.body.id}`).expect(404);
    expect((await api(app, outsider).get('/ai/jobs').expect(200)).body.meta.total).toBe(0);
    expect((await api(app, outsider).get('/ai/usage').expect(200)).body.credits.used).toBe(0);
  });
});

vi.setConfig({ testTimeout: 30_000 });
