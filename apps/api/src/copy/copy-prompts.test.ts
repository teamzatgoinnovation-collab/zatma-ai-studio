import { describe, expect, it } from 'vitest';
import { copyOutputSchema, generateCopySchema, translateCopySchema, type TextLayer } from '@zatma/validation';
import { copyUserPrompt, OutputParseError, parseJsonOutput, rewriteUserPrompt, translateUserPrompt } from './copy-prompts.js';
import { fontForLanguage, localiseTextLayer } from './design-translation.service.js';

const brand = { name: 'ZatGo', tagline: 'Smart ERP', website: 'zatgo.com', phone: null, whatsapp: '+91 98470 00000', email: null, address: null, guidelines: 'Never use slang.' };

describe('copy prompts', () => {
  it('describes kind, platform, limits, language and brand facts', () => {
    const p = copyUserPrompt(generateCopySchema.parse({ kind: 'ad_headline', brief: 'Van Sales ERP, 1 month free', language: 'ml', platform: 'google_ads', variants: 4 }), brand);
    expect(p).toContain('Write 4 variant(s) of: Ad headline');
    expect(p).toContain('Platform: Google Ads');
    expect(p).toContain('never exceed 30 characters');
    expect(p).toContain('Malayalam script');
    expect(p).toContain('WhatsApp: +91 98470 00000');
    expect(p).toContain('Brand guidelines (follow them): Never use slang.');
    expect(p).toContain('Hashtags: none');
  });

  it('asks for hashtags only where they fit, with the platform maximum', () => {
    const p = copyUserPrompt(generateCopySchema.parse({ kind: 'caption', brief: 'Onam sale at our textile shop', platform: 'instagram' }), null);
    expect(p).toContain('platform maximum 30');
    expect(p).toContain('Brand details: none provided.');
    const noTags = copyUserPrompt(generateCopySchema.parse({ kind: 'caption', brief: 'Onam sale at our textile shop', includeHashtags: false, includeEmojis: false }), null);
    expect(noTags).toContain('Hashtags: none');
    expect(noTags).toContain('Emojis: none.');
  });

  it('builds translation and rewrite prompts', () => {
    const t = translateUserPrompt(translateCopySchema.parse({ text: 'Call 98765 43210', targetLanguages: ['ar', 'ml'] }));
    expect(t).toContain('ar (Arabic), ml (Malayalam)');
    expect(t).toContain('GCC audiences');
    expect(rewriteUserPrompt('Hello', 'en', 'shorter')).toContain('noticeably shorter');
    expect(rewriteUserPrompt('Hello', 'en', 'custom', 'mention free delivery')).toContain('mention free delivery');
  });

  it('parses JSON output with fences and rejects invalid shapes', () => {
    expect(parseJsonOutput('```json\n{"variants":[{"text":"Hi"}]}\n```', copyOutputSchema)).toEqual({ variants: [{ text: 'Hi', hashtags: [] }] });
    expect(() => parseJsonOutput('no json', copyOutputSchema)).toThrow(OutputParseError);
    expect(() => parseJsonOutput('{"variants":[]}', copyOutputSchema)).toThrow(OutputParseError);
    expect(() => parseJsonOutput('{"variants":[{"text":"x"}', copyOutputSchema)).toThrow(OutputParseError);
  });
});

describe('design localisation', () => {
  const layer: TextLayer = {
    id: 'h',
    type: 'text',
    role: 'headline',
    x: 60,
    y: 300,
    width: 960,
    height: 200,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: 'Van Sales ERP',
    fontFamily: 'Montserrat',
    fontSize: 120,
    fontWeight: 800,
    fill: '#FFFFFF',
    align: 'left',
    lineHeight: 1.1,
    letterSpacing: 0,
    direction: 'ltr',
  };

  it('keeps fonts that can render the script and swaps the rest', () => {
    expect(fontForLanguage('Poppins', 'headline', 'hi')).toBe('Poppins');
    expect(fontForLanguage('Montserrat', 'headline', 'ml')).toBe('Noto Sans Malayalam');
    expect(fontForLanguage('Noto Sans Malayalam', 'body', 'ar')).toBe('Noto Sans Arabic');
    expect(fontForLanguage('Noto Sans Arabic', 'body', 'en')).toBe('Noto Sans Arabic');
  });

  it('switches direction and alignment for Arabic and shrinks long text to fit', () => {
    const ar = localiseTextLayer(layer, 'نظام مبيعات الشاحنات من زات جو مع تجربة مجانية لمدة شهر كامل', 'ar');
    expect(ar).toMatchObject({ direction: 'rtl', align: 'right', fontFamily: 'Noto Sans Arabic' });
    expect(ar.fontSize).toBeLessThan(120);
    expect(ar.fontSize).toBeGreaterThanOrEqual(54);
    const back = localiseTextLayer({ ...ar }, 'Van Sales ERP', 'en');
    expect(back).toMatchObject({ direction: 'ltr', align: 'left' });
    expect(localiseTextLayer({ ...layer, align: 'center' }, 'وان', 'ar').align).toBe('center');
  });
});
