import { describe, expect, it } from 'vitest';
import { designBriefSchema, designDocumentSchema, SIZE_PRESETS, type DesignBrief } from '@zatma/validation';
import { chooseLayout, composeDesign, contrastText, fitFontSize, measureText, type ComposerBrand } from './composer.js';

const brief = (over: Partial<DesignBrief> = {}): DesignBrief =>
  designBriefSchema.parse({
    headline: 'ZatGo Van Sales ERP',
    subheadline: 'Run your van sales from your phone',
    body: 'Orders, invoices, stock and collections in one app. Monthly subscription.',
    cta: 'WhatsApp us',
    badge: '1 MONTH FREE',
    ...over,
  });

const brand: ComposerBrand = {
  colors: { primary: '#1D4ED8', secondary: '#0EA5E9', accent: '#FACC15', background: '#0B1220', text: '#FFFFFF' },
  fonts: { heading: 'Montserrat', body: 'Inter' },
  logoFileId: '01a1be0a-35af-77bd-b2cf-c9ca2907a8f4',
  website: 'zatgoinnovation.com',
  phone: '+91 98470 00000',
  whatsapp: '+91 98470 00000',
};

describe('composeDesign', () => {
  for (const preset of Object.values(SIZE_PRESETS)) {
    for (const language of ['en', 'ml', 'ar'] as const) {
      it(`produces a valid document inside the safe area: ${preset.id} / ${language}`, () => {
        const doc = composeDesign({ preset, brief: brief(), language, brand, backgroundFileId: null });
        expect(designDocumentSchema.safeParse(doc).success).toBe(true);
        expect(doc.width).toBe(preset.width);
        for (const l of doc.layers) {
          expect(l.x, `${l.id} x`).toBeGreaterThanOrEqual(0);
          expect(l.y, `${l.id} y`).toBeGreaterThanOrEqual(0);
          expect(l.x + l.width, `${l.id} right`).toBeLessThanOrEqual(preset.width);
          expect(l.y + l.height, `${l.id} bottom`).toBeLessThanOrEqual(preset.height);
          if (l.type === 'text') {
            expect(l.y, `${l.id} inside top safe`).toBeGreaterThanOrEqual(preset.safe.top - 1);
            expect(l.y + l.height, `${l.id} inside bottom safe`).toBeLessThanOrEqual(preset.height - preset.safe.bottom + 1);
          }
        }
        const headline = doc.layers.find((l) => l.role === 'headline');
        expect(headline?.type).toBe('text');
      });
    }
  }

  it('applies brand colours, fonts, logo and contact footer', () => {
    const doc = composeDesign({ preset: SIZE_PRESETS.instagram_post, brief: brief(), language: 'en', brand });
    expect(doc.background).toEqual({ type: 'gradient', from: '#1D4ED8', to: '#0EA5E9', angle: 135 });
    const byRole = Object.fromEntries(doc.layers.map((l) => [l.role, l]));
    expect(byRole.logo).toMatchObject({ type: 'image', fileId: brand.logoFileId });
    expect(byRole.headline).toMatchObject({ fontFamily: 'Montserrat' });
    expect(byRole.body).toMatchObject({ fontFamily: 'Inter' });
    expect(byRole.cta).toMatchObject({ background: { fill: '#FACC15' }, fill: '#111827' });
    expect((byRole.footer as { text: string }).text).toContain('zatgoinnovation.com');
    expect((byRole.footer as { text: string }).text).toContain('WhatsApp +91 98470 00000');
  });

  it('uses script-capable fonts and RTL for non-English languages', () => {
    const ml = composeDesign({ preset: SIZE_PRESETS.instagram_post, brief: brief({ headline: 'സാറ്റ്ഗോ വാൻ സെയിൽസ് ERP' }), language: 'ml', brand });
    expect(ml.layers.find((l) => l.role === 'headline')).toMatchObject({ fontFamily: 'Noto Sans Malayalam', direction: 'ltr' });
    const ar = composeDesign({ preset: SIZE_PRESETS.facebook_post, brief: brief({ headline: 'عرض خاص' }), language: 'ar', brand });
    expect(ar.layers.find((l) => l.role === 'headline')).toMatchObject({ fontFamily: 'Noto Sans Arabic', direction: 'rtl', align: 'right' });
  });

  it('uses the AI background image with a readability overlay when provided', () => {
    const fileId = '01a1be0a-35af-77bd-b2cf-c9ca2907a8f5';
    const doc = composeDesign({ preset: SIZE_PRESETS.instagram_story, brief: brief(), language: 'en', brand: null, backgroundFileId: fileId });
    expect(doc.background).toMatchObject({ type: 'image', fileId, overlay: { color: '#000000' } });
    expect(doc.layers.some((l) => l.role === 'logo' || l.role === 'footer')).toBe(false); // no brand kit
  });

  it('shrinks long headlines instead of overflowing', () => {
    const short = composeDesign({ preset: SIZE_PRESETS.instagram_post, brief: brief({ headline: 'Big Sale' }), language: 'en', brand });
    const long = composeDesign({ preset: SIZE_PRESETS.instagram_post, brief: brief({ headline: 'An unusually long headline that keeps going to test the automatic fitting of text into the space' }), language: 'en', brand });
    const size = (d: typeof short) => (d.layers.find((l) => l.role === 'headline') as { fontSize: number }).fontSize;
    expect(size(long)).toBeLessThan(size(short));
  });

  it('is deterministic and omits empty blocks', () => {
    const a = composeDesign({ preset: SIZE_PRESETS.linkedin_post, brief: brief({ body: '', badge: '' }), language: 'en', brand });
    const b = composeDesign({ preset: SIZE_PRESETS.linkedin_post, brief: brief({ body: '', badge: '' }), language: 'en', brand });
    expect(a).toEqual(b);
    expect(a.layers.map((l) => l.role)).not.toContain('body');
    expect(a.layers.map((l) => l.role)).not.toContain('badge');
  });
});

describe('composer helpers', () => {
  it('chooses layouts that suit the aspect ratio', () => {
    expect(chooseLayout(1080, 1920)).toBe('story-stack');
    expect(chooseLayout(1200, 630)).toBe('split-left');
    expect(chooseLayout(1080, 1080)).toBe('hero-center');
    expect(chooseLayout(1080, 1920, 'split-left')).toBe('story-stack'); // unsuitable request ignored
    expect(chooseLayout(1080, 1080, 'bottom-band')).toBe('bottom-band');
  });

  it('measures wider scripts as taking more space', () => {
    expect(measureText('x'.repeat(60), 40, 400, 1.2, 'ml')).toBeGreaterThan(measureText('x'.repeat(60), 40, 400, 1.2, 'en'));
    expect(fitFontSize('short', 800, 200, 120, 20, 1.1, 'en')).toBe(120);
  });

  it('picks readable text colours', () => {
    expect(contrastText('#FACC15')).toBe('#111827');
    expect(contrastText('#1D4ED8')).toBe('#FFFFFF');
  });
});
