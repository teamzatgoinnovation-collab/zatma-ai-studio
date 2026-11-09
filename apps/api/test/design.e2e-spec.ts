import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { designDocumentSchema, type DesignDocument } from '@zatma/validation';
import { AIProviderRegistry } from '../src/ai/ai-provider.registry.js';
import type { AIImageProvider, AITextProvider } from '../src/ai/ai-provider.interfaces.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, MemoryObjectStorage } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, type TestUser } from './helpers.js';

const BRIEF = {
  headline: 'സാറ്റ്ഗോ വാൻ സെയിൽസ് ERP',
  subheadline: 'നിങ്ങളുടെ വാൻ സെയിൽസ് ഇനി ഫോണിൽ',
  body: 'ഓർഡർ, ഇൻവോയ്സ്, സ്റ്റോക്ക് എല്ലാം ഒരു ആപ്പിൽ.',
  cta: 'WhatsApp ചെയ്യൂ',
  badge: '1 മാസം സൗജന്യം',
  caption: 'ZatGo Van Sales ERP – ഒരു മാസം സൗജന്യം!',
  hashtags: ['ZatGo', '#VanSales', '#Kerala'],
  layout: 'hero-center',
  backgroundPrompt: 'Blue delivery van on a Kerala road at sunrise',
};

function textProvider(replies: string[]): AITextProvider & { prompts: string[] } {
  const p = {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-opus-5-5',
    prompts: [] as string[],
    async generateText(input: { prompt: string }) {
      p.prompts.push(input.prompt);
      const text = replies[Math.min(p.prompts.length - 1, replies.length - 1)]!;
      return { text, model: 'claude-opus-5-5', usage: { inputTokens: 600, outputTokens: 400, costMicroUsd: 10_400 }, finishReason: 'stop' as const };
    },
  };
  return p;
}

const imageProvider: AIImageProvider = {
  id: 'openai',
  name: 'OpenAI',
  defaultModel: 'gpt-image-2',
  async generateImage() {
    return { images: [{ data: Buffer.from('png'), mimeType: 'image/png' }], model: 'gpt-image-2', usage: { units: 1, costMicroUsd: 45_000 } };
  },
};

async function waitReady(app: NestExpressApplication, user: TestUser, id: string) {
  for (let i = 0; i < 80; i++) {
    const res = await api(app, user).get(`/designs/${id}`).expect(200);
    if (res.body.status !== 'GENERATING') return res.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('design did not finish');
}

describe('AI Design Studio (e2e)', () => {
  let app: NestExpressApplication;
  let registry: AIProviderRegistry;
  let owner: TestUser;
  let orgId: string;
  const storage = new MemoryObjectStorage();

  const uploadImage = async (user: TestUser, purpose = 'LOGO') => {
    const up = await api(app, user).post('/storage/uploads', { fileName: 'logo.png', mimeType: 'image/png', sizeBytes: 64, purpose }).expect(201);
    storage.put(up.body.key, { sizeBytes: 64, contentType: 'image/png' });
    await api(app, user).post(`/storage/uploads/${up.body.fileId}/complete`).expect(201);
    return up.body.fileId as string;
  };

  const kitBody = (logoFileId?: string) => ({
    name: 'ZatGo',
    logoFileId,
    colors: { primary: '#1D4ED8', secondary: '#0EA5E9', accent: '#FACC15', background: '#0B1220', text: '#FFFFFF' },
    fonts: { heading: 'Montserrat', body: 'Inter' },
    website: 'zatgoinnovation.com',
    whatsapp: '+91 98470 00000',
  });

  beforeAll(async () => {
    app = await createTestApp({ storage });
    registry = app.get(AIProviderRegistry);
    owner = await signUp(app, 'Design Owner');
    orgId = await createOrg(app, owner, 'Design Org');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => registry.reset());

  it('manages brand kits with a single default', async () => {
    const logo = await uploadImage(owner);
    const first = await api(app, owner).post('/brand-kits', kitBody(logo)).expect(201);
    expect(first.body).toMatchObject({ isDefault: true, logoFileId: logo });
    expect(first.body.logoUrl).toContain('X-Amz-Signature');
    const second = await api(app, owner).post('/brand-kits', { ...kitBody(), name: 'Seasonal' }).expect(201);
    expect(second.body.isDefault).toBe(false);
    await api(app, owner).post(`/brand-kits/${second.body.id}/default`).expect(200);
    const list = await api(app, owner).get('/brand-kits').expect(200);
    expect(list.body.map((k: { name: string; isDefault: boolean }) => [k.name, k.isDefault])).toEqual([['Seasonal', true], ['ZatGo', false]]);
    await api(app, owner).delete(`/brand-kits/${second.body.id}`).expect(204);
    expect((await api(app, owner).get('/brand-kits').expect(200)).body[0]).toMatchObject({ name: 'ZatGo', isDefault: true });
    await api(app, owner).post('/brand-kits', { ...kitBody(), colors: { ...kitBody().colors, primary: 'blue' } }).expect(400);
    await api(app, owner).post('/brand-kits', { ...kitBody(), fonts: { heading: 'Comic Sans', body: 'Inter' } }).expect(400);
  });

  it('generates an editable Malayalam design with an AI background through the queue', async () => {
    const text = textProvider([JSON.stringify(BRIEF)]);
    registry.register('TEXT', text);
    registry.register('IMAGE', imageProvider);
    const res = await api(app, owner)
      .post('/designs/generate', { prompt: 'Create a Malayalam advertisement for ZatGo Van Sales ERP. Highlight 1 month free, monthly subscription, and WhatsApp contact.', language: 'ml', sizePreset: 'instagram_post' })
      .expect(202);
    expect(res.body.design.status).toBe('GENERATING');
    const design = await waitReady(app, owner, res.body.jobId);

    expect(design).toMatchObject({ status: 'READY', title: BRIEF.headline, language: 'ml', revision: 1, width: 1080, height: 1080, hashtags: ['#ZatGo', '#VanSales', '#Kerala'] });
    expect(designDocumentSchema.safeParse(design.document).success).toBe(true);
    const doc = design.document as DesignDocument;
    expect(doc.background.type).toBe('image');
    const roles = doc.layers.map((l) => l.role);
    expect(roles).toEqual(expect.arrayContaining(['logo', 'badge', 'headline', 'subheadline', 'body', 'cta', 'footer']));
    const headline = doc.layers.find((l) => l.role === 'headline');
    expect(headline).toMatchObject({ type: 'text', text: BRIEF.headline, fontFamily: 'Noto Sans Malayalam' });
    // every referenced file resolves to a signed URL
    for (const id of Object.keys(design.assets)) expect(design.assets[id]).toContain('X-Amz-Signature');
    expect(Object.keys(design.assets).length).toBeGreaterThanOrEqual(2);
    // system prompt asks for no text in images; user prompt carries the brand
    expect(text.prompts[0]).toContain('Brand: ZatGo');

    const usage = await app.get(PrismaService).system.aiUsage.findMany({ where: { organizationId: orgId, purpose: 'design' } });
    expect(usage.map((u) => u.capability).sort()).toEqual(['IMAGE', 'TEXT']);
    const versions = await api(app, owner).get(`/designs/${design.id}/versions`).expect(200);
    expect(versions.body).toHaveLength(1);
    expect(versions.body[0]).toMatchObject({ revision: 1, note: 'AI generated' });
  });

  it('falls back to a brand gradient without an image provider and repairs invalid JSON once', async () => {
    const text = textProvider(['Sure! Here is a poster idea without JSON.', JSON.stringify({ ...BRIEF, headline: 'Onam Mega Sale', layout: 'split-left' })]);
    registry.register('TEXT', text);
    const res = await api(app, owner).post('/designs/generate', { prompt: 'Kerala supermarket Onam sale poster with 30% off', sizePreset: 'facebook_post', language: 'en' }).expect(202);
    const design = await waitReady(app, owner, res.body.jobId);
    expect(design.status).toBe('READY');
    expect(text.prompts).toHaveLength(2);
    expect(text.prompts[1]).toContain('could not be used');
    expect(design.document.background).toEqual({ type: 'gradient', from: '#1D4ED8', to: '#0EA5E9', angle: 135 });
    expect(design.document.layers.find((l: { role: string }) => l.role === 'headline')).toMatchObject({ text: 'Onam Mega Sale', fontFamily: 'Montserrat' });
  });

  it('marks the design FAILED with a safe error when the brief stays invalid', async () => {
    registry.register('TEXT', textProvider(['not json', 'still not json']));
    const res = await api(app, owner).post('/designs/generate', { prompt: 'Diwali greeting card for our customers' }).expect(202);
    const design = await waitReady(app, owner, res.body.jobId);
    expect(design).toMatchObject({ status: 'FAILED', error: { code: 'AI_BRIEF_INVALID' } });
  });

  it('requires a text provider and plan credits', async () => {
    expect((await api(app, owner).post('/designs/generate', { prompt: 'Eid sale banner for our store' }).expect(503)).body.code).toBe('AI_PROVIDER_UNAVAILABLE');
    registry.register('TEXT', textProvider([JSON.stringify(BRIEF)]));
    const u = await signUp(app, 'No Credits');
    const org2 = await createOrg(app, u, 'No Credit Org');
    await api(app, u).post('/billing/change-plan', { plan: 'FREE' }).expect(200);
    await app.get(PrismaService).system.aiUsage.create({ data: { organizationId: org2, capability: 'TEXT', provider: 'x', model: 'm', credits: 20, status: 'SUCCEEDED' } });
    expect((await api(app, u).post('/designs/generate', { prompt: 'Eid sale banner for our store' }).expect(402)).body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('saves edits with optimistic concurrency and validates assets', async () => {
    const created = await api(app, owner).post('/designs', { title: 'Blank', sizePreset: 'instagram_story' }).expect(201);
    expect(created.body).toMatchObject({ width: 1080, height: 1920, revision: 1, status: 'READY' });
    const doc: DesignDocument = {
      ...created.body.document,
      layers: [{ id: 't1', role: 'headline', type: 'text', x: 100, y: 300, width: 800, height: 200, rotation: 0, opacity: 1, visible: true, locked: false, text: 'Hello', fontFamily: 'Poppins', fontSize: 96, fontWeight: 800, fill: '#111111', align: 'center', lineHeight: 1.1, letterSpacing: 0, direction: 'ltr' }],
    };
    const saved = await api(app, owner).patch(`/designs/${created.body.id}`, { revision: 1, document: doc, title: 'Story' }).expect(200);
    expect(saved.body).toMatchObject({ revision: 2, title: 'Story' });
    const stale = await api(app, owner).patch(`/designs/${created.body.id}`, { revision: 1, title: 'Stale' }).expect(409);
    expect(stale.body).toMatchObject({ code: 'REVISION_CONFLICT', details: { currentRevision: 2 } });

    const badUrl = { ...doc, layers: [{ ...doc.layers[0], type: 'image', fileId: 'https://evil.example/x.png' }] };
    await api(app, owner).patch(`/designs/${created.body.id}`, { revision: 2, document: badUrl }).expect(400);
    const foreign = { ...doc, background: { type: 'image', fileId: '01a1be0a-35af-77bd-b2cf-c9ca2907a8f4', fit: 'cover', fallbackColor: '#000000' } };
    expect((await api(app, owner).patch(`/designs/${created.body.id}`, { revision: 2, document: foreign }).expect(422)).body.code).toBe('INVALID_ASSET');
    await api(app, owner).patch(`/designs/${created.body.id}`, { revision: 2, document: { ...doc, width: 500 } }).expect(422);

    const asset = await uploadImage(owner, 'DESIGN_ASSET');
    const withImage = { ...doc, layers: [...doc.layers, { id: 'img', role: 'product', type: 'image', fileId: asset, fit: 'cover', cornerRadius: 0, x: 0, y: 0, width: 200, height: 200, rotation: 0, opacity: 1, visible: true, locked: false }] };
    const ok = await api(app, owner).patch(`/designs/${created.body.id}`, { revision: 2, document: withImage }).expect(200);
    expect(ok.body.assets[asset]).toContain('X-Amz-Signature');
  });

  it('supports versions, duplicate, thumbnail, templates and soft delete', async () => {
    const d = (await api(app, owner).post('/designs', { title: 'Versioned', sizePreset: 'instagram_post' }).expect(201)).body;
    const v1 = await api(app, owner).post(`/designs/${d.id}/versions`, { note: 'blank' }).expect(201);
    const doc = { ...d.document, background: { type: 'color', color: '#FF0000' } };
    await api(app, owner).patch(`/designs/${d.id}`, { revision: d.revision, document: doc }).expect(200);
    const restored = await api(app, owner).post(`/designs/${d.id}/versions/${v1.body.id}/restore`).expect(200);
    expect(restored.body.document.background).toEqual({ type: 'color', color: '#FFFFFF' });
    expect(restored.body.revision).toBe(3);

    const thumb = await uploadImage(owner, 'THUMBNAIL');
    await api(app, owner).put(`/designs/${d.id}/thumbnail`, { fileId: thumb }).expect(204);
    const copy = await api(app, owner).post(`/designs/${d.id}/duplicate`).expect(201);
    expect(copy.body.title).toBe('Versioned (copy)');
    expect(copy.body.thumbnailUrl).toContain('X-Amz-Signature');

    const tpl = await api(app, owner).post(`/designs/${d.id}/save-as-template`, { name: 'Clean square', category: 'Sale' }).expect(201);
    expect(tpl.body).toMatchObject({ name: 'Clean square', category: 'Sale', sizePreset: 'instagram_post' });
    const fromTpl = await api(app, owner).post('/designs', { title: 'From template', templateId: tpl.body.id }).expect(201);
    expect(fromTpl.body.document).toEqual(restored.body.document);

    await api(app, owner).delete(`/designs/${d.id}`).expect(204);
    await api(app, owner).get(`/designs/${d.id}`).expect(404);
    const list = await api(app, owner).get('/designs?q=versioned').expect(200);
    expect(list.body.data.map((x: { title: string }) => x.title)).toEqual(['Versioned (copy)']);
    await api(app, owner).delete(`/templates/${tpl.body.id}`).expect(204);
  });

  it('enforces permissions and tenant isolation', async () => {
    const d = (await api(app, owner).post('/designs', { title: 'Private', sizePreset: 'instagram_post' }).expect(201)).body;
    const viewer = await signUp(app, 'Studio Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    await api(app, viewer).get(`/designs/${d.id}`).expect(200);
    await api(app, viewer).get('/brand-kits').expect(200);
    await api(app, viewer).patch(`/designs/${d.id}`, { revision: d.revision, title: 'x' }).expect(403);
    await api(app, viewer).post('/designs', { title: 'x' }).expect(403);
    await api(app, viewer).post('/designs/generate', { prompt: 'A design please for me' }).expect(403);

    const designer = await signUp(app, 'Studio Designer');
    await inviteAndAccept(app, owner, designer, orgId, 'designer');
    await api(app, designer).patch(`/designs/${d.id}`, { revision: d.revision, title: 'Renamed by designer' }).expect(200);

    const outsider = await signUp(app, 'Studio Outsider');
    await createOrg(app, outsider, 'Other Studio');
    await api(app, outsider).get(`/designs/${d.id}`).expect(404);
    await api(app, outsider).patch(`/designs/${d.id}`, { revision: 2, title: 'pwned' }).expect(404);
    expect((await api(app, outsider).get('/designs').expect(200)).body.meta.total).toBe(0);
    expect((await api(app, outsider).get('/brand-kits').expect(200)).body).toEqual([]);
    expect((await api(app, outsider).get('/templates').expect(200)).body).toEqual([]);
    const kit = (await api(app, owner).get('/brand-kits').expect(200)).body[0];
    await api(app, outsider).patch(`/brand-kits/${kit.id}`, { name: 'pwned' }).expect(404);
    // An outsider cannot reference the owner's logo file in their own brand kit.
    expect((await api(app, outsider).post('/brand-kits', kitBody(kit.logoFileId)).expect(422)).body.code).toBe('INVALID_ASSET');
  });
});
