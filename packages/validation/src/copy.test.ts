import { describe, expect, it } from 'vitest';
import {
  checkLimits,
  countGraphemes,
  generateCopySchema,
  missingTokens,
  normalizeHashtags,
  protectedTokens,
  rewriteCopySchema,
  saveCopyAssetSchema,
  smsSegments,
  translateCopySchema,
} from './copy.js';

describe('copy counting and limits', () => {
  it('counts user-perceived characters', () => {
    expect(countGraphemes('hello')).toBe(5);
    expect(countGraphemes('👍🏽🇮🇳')).toBe(2);
    // "ക്ഷ" is one visual conjunct but several code points
    expect(countGraphemes('ക്ഷ')).toBeLessThan('ക്ഷ'.length);
    expect(countGraphemes('')).toBe(0);
  });

  it('flags hard limits and soft recommendations', () => {
    const ok = checkLimits('ad_headline', 'meta_ads', 'Free trial for 30 days');
    expect(ok).toMatchObject({ recommended: 40, long: false, overLimit: false });
    const long = checkLimits('ad_headline', 'meta_ads', 'x'.repeat(41));
    expect(long).toMatchObject({ long: true, overLimit: false });
    expect(checkLimits('ad_headline', 'google_ads', 'x'.repeat(31)).overLimit).toBe(true);
    expect(checkLimits('caption', 'instagram', 'x'.repeat(2201)).overLimit).toBe(true);
    expect(checkLimits('caption', 'instagram', 'hi', Array.from({ length: 31 }, (_, i) => `#t${i}`))).toMatchObject({ hashtagCount: 31, overLimit: true });
    expect(checkLimits('caption', 'generic', 'x'.repeat(9000)).overLimit).toBe(false);
  });

  it('computes SMS segments for Latin and non-Latin text', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM-7', segments: 1, perSegment: 160 });
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('ഓണം ഓഫർ').encoding).toBe('UCS-2');
    expect(smsSegments('ഓ'.repeat(71)).segments).toBe(2);
    expect(checkLimits('sms', 'sms', 'Hi').sms?.segments).toBe(1);
  });

  it('normalises hashtags', () => {
    expect(normalizeHashtags(['Onam', '#onam', '##Kerala Shopping', ' ', '#'])).toEqual(['#Onam', '#KeralaShopping']);
  });
});

describe('translation safeguards', () => {
  it('extracts numbers, phones and URLs', () => {
    expect(protectedTokens('Call +91 98765 43210 or visit zatgo.com — 30% off, ₹2,999')).toEqual(['zatgo.com', '+919876543210', '30', '2999']);
  });

  it('reports tokens missing from a translation, accepting Arabic-Indic digits', () => {
    const src = 'Call +91 98765 43210, 30% off at zatgo.com';
    expect(missingTokens(src, 'വിളിക്കൂ +91 98765 43210, 30% കിഴിവ് zatgo.com')).toEqual([]);
    expect(missingTokens(src, 'اتصل +91 98765 43210، خصم ٣٠٪ zatgo.com')).toEqual([]);
    expect(missingTokens(src, 'വിളിക്കൂ, 40% കിഴിവ്')).toEqual(['zatgo.com', '+919876543210', '30']);
  });
});

describe('copy schemas', () => {
  it('applies defaults and validates generation input', () => {
    const v = generateCopySchema.parse({ kind: 'caption', brief: 'Onam sale at our textile shop' });
    expect(v).toMatchObject({ language: 'en', tone: 'friendly', variants: 3, includeHashtags: true });
    expect(generateCopySchema.safeParse({ kind: 'caption', brief: 'short' }).success).toBe(false);
    expect(generateCopySchema.safeParse({ kind: 'caption', brief: 'Onam sale at our shop', variants: 6 }).success).toBe(false);
    expect(generateCopySchema.safeParse({ kind: 'caption', brief: 'Onam sale at our shop', organizationId: 'x' }).success).toBe(false);
  });

  it('requires unique target languages and an instruction for custom rewrites', () => {
    expect(translateCopySchema.safeParse({ text: 'Hi', targetLanguages: ['ml', 'ml'] }).success).toBe(false);
    expect(translateCopySchema.safeParse({ text: 'Hi', targetLanguages: ['ml', 'ar'] }).success).toBe(true);
    expect(rewriteCopySchema.safeParse({ text: 'Hi', action: 'custom' }).success).toBe(false);
    expect(rewriteCopySchema.safeParse({ text: 'Hi', action: 'custom', instruction: 'mention free delivery' }).success).toBe(true);
  });

  it('validates saved copy', () => {
    expect(saveCopyAssetSchema.safeParse({ kind: 'caption', content: 'Hello', language: 'xx' }).success).toBe(false);
    expect(saveCopyAssetSchema.parse({ kind: 'caption', content: 'Hello' })).toMatchObject({ platform: 'generic', favorite: false, hashtags: [] });
  });
});
