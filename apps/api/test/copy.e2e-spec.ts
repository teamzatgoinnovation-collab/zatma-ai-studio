import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { designDocumentSchema, type DesignDocument, type TextLayer } from '@zatma/validation';
import { AIProviderRegistry } from '../src/ai/ai-provider.registry.js';
import type { AITextProvider } from '../src/ai/ai-provider.interfaces.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './harness.js';
import { api, createOrg, inviteAndAccept, signUp, type TestUser } from './helpers.js';

/** Fake text provider replying with the queued answers in order (the last one repeats). */
function textProvider(replies: string[]): AITextProvider & { prompts: string[]; systems: string[] } {
  const p = {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-opus-5-5',
    prompts: [] as string[],
    systems: [] as string[],
    async generateText(input: { prompt: string; system?: string }) {
      p.prompts.push(input.prompt);
      p.systems.push(input.system ?? '');
      const text = replies[Math.min(p.prompts.length - 1, replies.length - 1)]!;
      return { text, model: 'claude-opus-5-5', usage: { inputTokens: 500, outputTokens: 300, costMicroUsd: 8_000 }, finishReason: 'stop' as const };
    },
  };
  return p;
}

const VARIANTS = {
  variants: [
    { text: 'ഈ ഓണത്തിന് എല്ലാ സാരികൾക്കും 30% കിഴിവ്! ഇന്ന് തന്നെ വരൂ.', hashtags: ['Onam', '#KeralaSarees', '#onam'] },
    { text: 'ഓണക്കോടി ഇനി കുറഞ്ഞ വിലയിൽ ✨ 30% കിഴിവ്, സെപ്റ്റംബർ 15 വരെ.', hashtags: ['#OnamSale'] },
    { text: 'കുടുംബത്തിനൊപ്പം ഓണം ആഘോഷിക്കൂ, പുതിയ കളക്ഷൻ എത്തി!', hashtags: [] },
  ],
};

describe('AI Copywriter (e2e)', () => {
  let app: NestExpressApplication;
  let registry: AIProviderRegistry;
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    app = await createTestApp();
    registry = app.get(AIProviderRegistry);
    owner = await signUp(app, 'Copy Owner');
    orgId = await createOrg(app, owner, 'Copy Org');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => registry.reset());

  it('generates Malayalam caption variants with limits, brand facts and metered credits', async () => {
    await api(app, owner)
      .post('/brand-kits', { name: 'Kalyan Silks Demo', colors: { primary: '#1D4ED8', secondary: '#0EA5E9', accent: '#FACC15', background: '#0B1220', text: '#FFFFFF' }, fonts: { heading: 'Poppins', body: 'Inter' }, whatsapp: '+91 90000 11111' })
      .expect(201);
    const text = textProvider([JSON.stringify(VARIANTS)]);
    registry.register('TEXT', text);
    const res = await api(app, owner)
      .post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees, 30% off until 15 September', language: 'ml', platform: 'instagram', tone: 'festive' })
      .expect(200);
    expect(res.body.variants).toHaveLength(3);
    expect(res.body.variants[0]).toMatchObject({ hashtags: ['#Onam', '#KeralaSarees'], limits: { max: 2200, overLimit: false, maxHashtags: 30 } });
    expect(res.body.variants[0].limits.count).toBeGreaterThan(20);
    expect(res.body).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(res.body.credits).toBeGreaterThan(0);
    expect(text.prompts[0]).toContain('Malayalam script');
    expect(text.prompts[0]).toContain('WhatsApp: +91 90000 11111'); // default brand kit facts
    expect(text.systems[0]).toContain('Never invent prices');
    const usage = await app.get(PrismaService).system.aiUsage.findMany({ where: { organizationId: orgId, purpose: 'copywriter' } });
    expect(usage).toHaveLength(1);
  });

  it('repairs invalid JSON once, then fails with AI_OUTPUT_INVALID', async () => {
    const repaired = textProvider(['Sure! Here are some captions...', JSON.stringify(VARIANTS)]);
    registry.register('TEXT', repaired);
    await api(app, owner).post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees, 30% off' }).expect(200);
    expect(repaired.prompts[1]).toContain('could not be used');

    registry.reset();
    registry.register('TEXT', textProvider(['nope', '{"variants": []}']));
    const bad = await api(app, owner).post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees, 30% off' }).expect(422);
    expect(bad.body.code).toBe('AI_OUTPUT_INVALID');
  });

  it('normalises hashtag sets and flags over-limit ad headlines', async () => {
    registry.register('TEXT', textProvider([JSON.stringify({ variants: [{ text: '#Onam #Kerala #onam #Sale', hashtags: [] }] })]));
    const tags = await api(app, owner).post('/copy/generate', { kind: 'hashtags', brief: 'Onam sale at a textile shop', variants: 1 }).expect(200);
    expect(tags.body.variants[0]).toMatchObject({ text: '#Onam #Kerala #Sale', hashtags: [] });

    registry.reset();
    registry.register('TEXT', textProvider([JSON.stringify({ variants: [{ text: 'ZatGo Van Sales ERP – first month completely free' }] })]));
    const ad = await api(app, owner).post('/copy/generate', { kind: 'ad_headline', brief: 'Van sales ERP free month', platform: 'google_ads', variants: 1 }).expect(200);
    expect(ad.body.variants[0].limits).toMatchObject({ max: 30, overLimit: true });
  });

  it('translates into several languages and warns when details change', async () => {
    const t = textProvider([
      JSON.stringify({
        translations: [
          { language: 'ml', text: 'ഇന്ന് വിളിക്കൂ: +91 98765 43210. 30% കിഴിവ് zatgo.com ൽ', hashtags: ['#ഓണം'] },
          { language: 'ar', text: 'اتصل اليوم: +91 98765 43210. خصم 40%', hashtags: [] },
        ],
      }),
    ]);
    registry.register('TEXT', t);
    const res = await api(app, owner)
      .post('/copy/translate', { text: 'Call today: +91 98765 43210. 30% off at zatgo.com', hashtags: ['#Onam'], targetLanguages: ['ml', 'ar'] })
      .expect(200);
    expect(res.body.translations.map((x: { language: string }) => x.language)).toEqual(['ml', 'ar']);
    expect(res.body.translations[0]).toMatchObject({ warnings: [], hashtags: ['#ഓണം'] });
    expect(res.body.translations[1].hashtags).toEqual(['#Onam']); // falls back to the source hashtags
    expect(res.body.translations[1].warnings[0]).toContain('zatgo.com');
    expect(res.body.translations[1].warnings[0]).toContain('30');
    expect(t.prompts[0]).toContain('ml (Malayalam), ar (Arabic)');
    await api(app, owner).post('/copy/translate', { text: 'Hi', targetLanguages: [] }).expect(400);
  });

  it('rewrites copy', async () => {
    const t = textProvider([JSON.stringify({ text: 'Onam sale: 30% off!' })]);
    registry.register('TEXT', t);
    const res = await api(app, owner).post('/copy/rewrite', { text: 'Celebrate Onam with us and enjoy 30% off on all sarees this week.', action: 'shorter' }).expect(200);
    expect(res.body.text).toBe('Onam sale: 30% off!');
    expect(t.prompts[0]).toContain('noticeably shorter');
    await api(app, owner).post('/copy/rewrite', { text: 'Hi', action: 'custom' }).expect(400);
  });

  it('saves, filters, favourites, edits and deletes copy', async () => {
    const a = await api(app, owner)
      .post('/copy-assets', { kind: 'caption', content: 'ഓണം ഓഫർ 30%', hashtags: ['Onam', '#onam'], language: 'ml', platform: 'instagram', variants: ['ഓണം ഓഫർ 30%', 'other'] })
      .expect(201);
    expect(a.body).toMatchObject({ kind: 'caption', hashtags: ['#Onam'], language: 'ml', favorite: false, createdByName: 'Copy Owner', variants: ['ഓണം ഓഫർ 30%', 'other'] });
    const b = await api(app, owner).post('/copy-assets', { kind: 'email_subject', content: 'Your Onam offer is here', language: 'en' }).expect(201);
    await api(app, owner).patch(`/copy-assets/${b.body.id}`, { favorite: true }).expect(200);

    const all = await api(app, owner).get('/copy-assets').expect(200);
    expect(all.body.data.map((x: { id: string }) => x.id)).toEqual([b.body.id, a.body.id]); // favourites first
    expect((await api(app, owner).get('/copy-assets?language=ml').expect(200)).body.data).toHaveLength(1);
    expect((await api(app, owner).get('/copy-assets?kind=email_subject').expect(200)).body.data).toHaveLength(1);
    expect((await api(app, owner).get('/copy-assets?favorite=true').expect(200)).body.data[0].id).toBe(b.body.id);
    expect((await api(app, owner).get('/copy-assets?q=onam%20offer').expect(200)).body.data[0].id).toBe(b.body.id);

    const edited = await api(app, owner).patch(`/copy-assets/${a.body.id}`, { content: 'ഓണം ഓഫർ 40%' }).expect(200);
    expect(edited.body.content).toBe('ഓണം ഓഫർ 40%');
    await api(app, owner).delete(`/copy-assets/${a.body.id}`).expect(204);
    await api(app, owner).get(`/copy-assets/${a.body.id}`).expect(404);
    await api(app, owner).post('/copy-assets', { kind: 'nope', content: 'x' }).expect(400);
  });

  it('requires a text provider and plan credits', async () => {
    expect((await api(app, owner).post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees' }).expect(503)).body.code).toBe('AI_PROVIDER_UNAVAILABLE');
    registry.register('TEXT', textProvider([JSON.stringify(VARIANTS)]));
    const u = await signUp(app, 'Copy No Credits');
    const org2 = await createOrg(app, u, 'Copy No Credit Org');
    await api(app, u).post('/billing/change-plan', { plan: 'FREE' }).expect(200);
    await app.get(PrismaService).system.aiUsage.create({ data: { organizationId: org2, capability: 'TEXT', provider: 'x', model: 'm', credits: 20, status: 'SUCCEEDED' } });
    expect((await api(app, u).post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees' }).expect(402)).body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('enforces permissions and tenant isolation', async () => {
    const saved = (await api(app, owner).post('/copy-assets', { kind: 'headline', content: 'Private headline' }).expect(201)).body;
    registry.register('TEXT', textProvider([JSON.stringify(VARIANTS)]));

    const viewer = await signUp(app, 'Copy Viewer');
    await inviteAndAccept(app, owner, viewer, orgId, 'viewer');
    await api(app, viewer).get(`/copy-assets/${saved.id}`).expect(200);
    await api(app, viewer).post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees' }).expect(403);
    await api(app, viewer).post('/copy-assets', { kind: 'headline', content: 'x' }).expect(403);
    await api(app, viewer).delete(`/copy-assets/${saved.id}`).expect(403);

    const designer = await signUp(app, 'Copy Designer');
    await inviteAndAccept(app, owner, designer, orgId, 'designer');
    await api(app, designer).post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees' }).expect(200);

    const outsider = await signUp(app, 'Copy Outsider');
    await createOrg(app, outsider, 'Other Copy Org');
    await api(app, outsider).get(`/copy-assets/${saved.id}`).expect(404);
    await api(app, outsider).patch(`/copy-assets/${saved.id}`, { content: 'pwned' }).expect(404);
    expect((await api(app, outsider).get('/copy-assets').expect(200)).body.meta.total).toBe(0);
    const kit = (await api(app, owner).get('/brand-kits').expect(200)).body[0];
    await api(app, outsider).post('/copy/generate', { kind: 'caption', brief: 'Onam sale on sarees', brandKitId: kit.id }).expect(404);
  });

  it('translates a design into Arabic as a new RTL design that fits its boxes', async () => {
    const created = (await api(app, owner).post('/designs', { title: 'Van Sales', sizePreset: 'instagram_post' }).expect(201)).body;
    const headline: TextLayer = { id: 'h1', role: 'headline', type: 'text', x: 60, y: 300, width: 960, height: 160, rotation: 0, opacity: 1, visible: true, locked: false, text: 'Van Sales ERP', fontFamily: 'Montserrat', fontSize: 120, fontWeight: 800, fill: '#111111', align: 'left', lineHeight: 1.1, letterSpacing: 0, direction: 'ltr' };
    const cta: TextLayer = { ...headline, id: 'c1', role: 'cta', y: 700, height: 110, text: 'Order now', fontSize: 56, align: 'center', background: { fill: '#FACC15', cornerRadius: 500, padding: 20 } };
    const doc: DesignDocument = { ...created.document, layers: [headline, cta] };
    const patched = await api(app, owner).patch(`/designs/${created.id}`, { revision: created.revision, document: doc });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    registry.register(
      'TEXT',
      textProvider([JSON.stringify({ layers: [{ id: 'h1', text: 'نظام مبيعات الشاحنات من زات جو مع شهر مجاني كامل' }, { id: 'c1', text: 'اطلب الآن' }], caption: 'جرّب مجاناً', hashtags: ['ZatGo'] })]),
    );
    const res = await api(app, owner).post(`/designs/${created.id}/translate`, { language: 'ar' }).expect(201);
    expect(res.body.id).not.toBe(created.id);
    expect(res.body).toMatchObject({ language: 'ar', title: 'Van Sales (Arabic)', caption: 'جرّب مجاناً', hashtags: ['#ZatGo'], revision: 1, status: 'READY' });
    const out = designDocumentSchema.parse(res.body.document);
    const [h, c] = out.layers as TextLayer[];
    expect(h).toMatchObject({ direction: 'rtl', align: 'right', fontFamily: 'Noto Sans Arabic', x: 60, width: 960 });
    expect(h!.fontSize).toBeLessThan(120);
    expect(c).toMatchObject({ text: 'اطلب الآن', align: 'center', direction: 'rtl' });
    // The original is untouched and the new design has a first version.
    expect((await api(app, owner).get(`/designs/${created.id}`).expect(200)).body.language).toBe('en');
    expect((await api(app, owner).get(`/designs/${res.body.id}/versions`).expect(200)).body[0].note).toBe('Translated from English');

    expect((await api(app, owner).post(`/designs/${res.body.id}/translate`, { language: 'ar' }).expect(422)).body.code).toBe('SAME_LANGUAGE');
    await api(app, owner).post(`/designs/${created.id}/translate`, { language: 'fr' }).expect(400);
    const outsider = await signUp(app, 'Translate Outsider');
    await createOrg(app, outsider, 'Translate Other');
    await api(app, outsider).post(`/designs/${created.id}/translate`, { language: 'ml' }).expect(404);
  });
});
