import { describe, expect, it } from 'vitest';
import { FONT_CATALOG } from '@zatma/validation';
import { defaultFontFor, FONT_OPTIONS, GOOGLE_FONTS_HREF } from './fonts';

describe('editor fonts', () => {
  it('picks a font that can render each design language', () => {
    expect(defaultFontFor('ml')).toBe('Noto Sans Malayalam');
    expect(defaultFontFor('ar')).toBe('Noto Sans Arabic');
    expect(defaultFontFor('en')).toBe('Poppins');
    expect(defaultFontFor('xx')).toBe('Poppins');
  });

  it('loads every catalogue family from the stylesheet', () => {
    expect(FONT_OPTIONS).toHaveLength(FONT_CATALOG.length);
    for (const f of FONT_OPTIONS) expect(GOOGLE_FONTS_HREF).toContain(`family=${f.replace(/ /g, '+')}`);
    expect(GOOGLE_FONTS_HREF.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
  });
});

describe('font stack', () => {
  it('falls back to Latin-capable sans fonts after the script font', async () => {
    const { fontStack } = await import('./fonts');
    expect(fontStack('Noto Sans Malayalam')).toBe('"Noto Sans Malayalam", "Inter", "Noto Sans", Arial, sans-serif');
  });
});
