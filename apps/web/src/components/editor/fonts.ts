import { FONT_CATALOG, LANGUAGE_FONTS, type FontFamily } from '@zatma/validation';

/** Google Fonts stylesheet with every catalogue family (canvas text uses the real family names). */
export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  [
    'Inter:wght@400..800',
    'Poppins:wght@400;500;600;700;800',
    'Montserrat:wght@400..800',
    'Playfair+Display:wght@400..800',
    'Bebas+Neue',
    'Noto+Sans+Malayalam:wght@400..800',
    'Noto+Sans+Arabic:wght@400..800',
    'Noto+Sans+Devanagari:wght@400..800',
    'Noto+Sans+Tamil:wght@400..800',
    'Noto+Sans+Kannada:wght@400..800',
    'Noto+Sans+Telugu:wght@400..800',
  ]
    .map((f) => `family=${f}`)
    .join('&') +
  '&display=swap';

export const FONT_OPTIONS = FONT_CATALOG.map((f) => f.family);

/** Default font for text added in the editor, matching the design's language. */
export function defaultFontFor(language: string): FontFamily {
  return (LANGUAGE_FONTS[language] ?? LANGUAGE_FONTS.en!).heading;
}

/** Waits until the given font faces are usable by canvas (no-op where the Font Loading API is missing). */
export async function loadFonts(specs: Array<{ family: string; weight: number }>): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const unique = [...new Set(specs.flatMap((s) => [`${s.weight} 48px "${s.family}"`, `${s.weight} 48px "Inter"`]))];
  await Promise.all(unique.map((spec) => document.fonts.load(spec).catch(() => [])));
}

/** CSS font stack for canvas text: the chosen family, then Latin-capable sans fallbacks (script fonts lack Latin glyphs). */
export function fontStack(family: string): string {
  return `"${family}", "Inter", "Noto Sans", Arial, sans-serif`;
}
