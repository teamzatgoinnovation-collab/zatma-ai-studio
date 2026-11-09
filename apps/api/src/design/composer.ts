import {
  LANGUAGE_FONTS,
  type DesignBackground,
  type DesignBrief,
  type DesignDocument,
  type DesignLayer,
  type FontFamily,
  type LayoutStyle,
  type SizePreset,
  type TextLayer,
} from '@zatma/validation';

/**
 * Composition engine: turns AI copy + brand kit + size preset into a layered, fully editable
 * design document. Pure and deterministic (no I/O, no randomness) so it is unit-testable and the
 * same inputs always produce the same layout. Exact text is always live text, never baked into images.
 */

export interface ComposerBrand {
  colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  fonts: { heading: FontFamily; body: FontFamily };
  logoFileId: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
}

export interface ComposeInput {
  preset: Pick<SizePreset, 'width' | 'height' | 'safe'>;
  brief: DesignBrief;
  language: string;
  brand: ComposerBrand | null;
  backgroundFileId?: string | null;
}

export const DEFAULT_COLORS: ComposerBrand['colors'] = {
  primary: '#4F46E5',
  secondary: '#06B6D4',
  accent: '#F59E0B',
  background: '#0F172A',
  text: '#FFFFFF',
};

/** Average glyph advance as a fraction of font size, per script (conservative). */
const SCRIPT_WIDTH: Record<string, number> = { en: 0.56, ml: 0.78, ar: 0.6, hi: 0.68, ta: 0.82, kn: 0.76, te: 0.76 };

// ───────────── Colour helpers ─────────────

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** Black or white, whichever reads better on `bg`. */
export function contrastText(bg: string): string {
  return luminance(bg) > 0.45 ? '#111827' : '#FFFFFF';
}

// ───────────── Text fitting ─────────────

/** Estimated wrapped height of `text` in a box `width` wide. */
export function measureText(text: string, fontSize: number, width: number, lineHeight: number, language: string): number {
  const charW = fontSize * (SCRIPT_WIDTH[language] ?? 0.6);
  const perLine = Math.max(1, Math.floor(width / charW));
  const lines = text.split('\n').reduce((sum, para) => sum + Math.max(1, Math.ceil([...para].length / perLine)), 0);
  return Math.ceil(lines * fontSize * lineHeight);
}

/** Largest font size in [min, max] whose wrapped text fits `maxHeight`. */
export function fitFontSize(text: string, width: number, maxHeight: number, max: number, min: number, lineHeight: number, language: string): number {
  let size = max;
  while (size > min && measureText(text, size, width, lineHeight, language) > maxHeight) size = Math.floor(size * 0.92);
  return Math.max(min, size);
}

// ───────────── Layout ─────────────

export function chooseLayout(width: number, height: number, requested?: LayoutStyle): LayoutStyle {
  const ratio = width / height;
  const natural: LayoutStyle = ratio < 0.75 ? 'story-stack' : ratio > 1.4 ? 'split-left' : 'hero-center';
  if (!requested) return natural;
  // Only honour requests that suit the aspect ratio.
  const allowed: Record<LayoutStyle, (r: number) => boolean> = {
    'story-stack': (r) => r < 0.9,
    'split-left': (r) => r > 1.2,
    'bottom-band': (r) => r >= 0.75,
    'hero-center': (r) => r >= 0.75 && r <= 1.6,
  };
  return allowed[requested](ratio) ? requested : natural;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Block {
  role: TextLayer['role'];
  text: string;
  font: FontFamily;
  weight: TextLayer['fontWeight'];
  /** Font size range as fractions of the reference dimension. */
  max: number;
  min: number;
  share: number;
  lineHeight: number;
  pill?: { fill: string };
}

function stackText(blocks: Block[], column: Box, ref: number, opts: { align: TextLayer['align']; rtl: boolean; color: string; language: string; gap: number }): TextLayer[] {
  const present = blocks.filter((b) => b.text.trim().length > 0);
  if (present.length === 0) return [];
  const gaps = opts.gap * (present.length - 1);
  const totalShare = present.reduce((s, b) => s + b.share, 0);
  let scale = 1;
  // Fit, then shrink everything together until the stack fits the column.
  for (let attempt = 0; attempt < 12; attempt++) {
    const layers: TextLayer[] = [];
    let y = column.y;
    for (const b of present) {
      const pad = b.pill ? Math.round(ref * 0.022) : 0;
      const innerW = b.pill ? Math.min(column.width, Math.max(ref * 0.3, [...b.text].length * ref * 0.05 * scale)) - pad * 2 : column.width;
      const maxH = ((column.height - gaps) * b.share) / totalShare;
      const size = fitFontSize(b.text, innerW, maxH, Math.round(ref * b.max * scale), Math.round(ref * b.min * scale), b.lineHeight, opts.language);
      const h = measureText(b.text, size, innerW, b.lineHeight, opts.language) + pad * 2;
      const w = innerW + pad * 2;
      const x = opts.align === 'center' ? column.x + (column.width - w) / 2 : opts.align === 'right' ? column.x + column.width - w : column.x;
      layers.push({
        id: b.role,
        role: b.role,
        type: 'text',
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: b.text,
        fontFamily: b.font,
        fontSize: size,
        fontWeight: b.weight,
        fill: b.pill ? contrastText(b.pill.fill) : opts.color,
        align: b.pill ? 'center' : opts.align,
        lineHeight: b.lineHeight,
        letterSpacing: 0,
        direction: opts.rtl ? 'rtl' : 'ltr',
        ...(b.pill ? { background: { fill: b.pill.fill, cornerRadius: Math.round(h / 2), padding: pad } } : {}),
      });
      y += h + opts.gap;
    }
    if (y - opts.gap <= column.y + column.height || attempt === 11) {
      // Vertically centre the stack inside the column.
      const used = y - opts.gap - column.y;
      const offset = Math.max(0, Math.round((column.height - used) / 2));
      return layers.map((l) => ({ ...l, y: l.y + offset }));
    }
    scale *= 0.9;
  }
  return [];
}

function footerText(brand: ComposerBrand | null): string {
  if (!brand) return '';
  const parts = [brand.website, brand.phone ? `📞 ${brand.phone}` : null, brand.whatsapp ? `WhatsApp ${brand.whatsapp}` : null].filter(Boolean);
  return parts.join('   ·   ');
}

/** Builds the full design document. */
export function composeDesign(input: ComposeInput): DesignDocument {
  const { width: W, height: H, safe } = input.preset;
  const brief = input.brief;
  const colors = input.brand?.colors ?? {
    ...DEFAULT_COLORS,
    ...(brief.palette?.primary ? { primary: brief.palette.primary } : {}),
    ...(brief.palette?.accent ? { accent: brief.palette.accent } : {}),
    ...(brief.palette?.background ? { background: brief.palette.background } : {}),
  };
  const langFonts = LANGUAGE_FONTS[input.language] ?? LANGUAGE_FONTS.en!;
  // Brand fonts are used for English; other scripts need a font that can render them.
  const headingFont = input.language === 'en' && input.brand ? input.brand.fonts.heading : langFonts.heading;
  const bodyFont = input.language === 'en' && input.brand ? input.brand.fonts.body : langFonts.body;
  const rtl = langFonts.rtl;
  const ref = Math.min(W, H);
  const content: Box = { x: safe.left, y: safe.top, width: W - safe.left - safe.right, height: H - safe.top - safe.bottom };
  const layout = chooseLayout(W, H, brief.layout);

  const background: DesignBackground = input.backgroundFileId
    ? { type: 'image', fileId: input.backgroundFileId, fit: 'cover', fallbackColor: colors.background, overlay: { color: '#000000', opacity: layout === 'bottom-band' ? 0.1 : 0.38 } }
    : { type: 'gradient', from: colors.primary, to: colors.secondary, angle: 135 };

  const layers: DesignLayer[] = [];

  // Logo (top corner / top centre for stories)
  const logoSize = Math.round(ref * (layout === 'story-stack' ? 0.2 : 0.16));
  const hasLogo = Boolean(input.brand?.logoFileId);
  if (hasLogo) {
    const lx = layout === 'story-stack' ? Math.round((W - logoSize) / 2) : rtl ? content.x + content.width - logoSize : content.x;
    layers.push({ id: 'logo', role: 'logo', type: 'image', fileId: input.brand!.logoFileId!, fit: 'contain', cornerRadius: 0, x: lx, y: content.y, width: logoSize, height: Math.round(logoSize * 0.5), rotation: 0, opacity: 1, visible: true, locked: false });
  }

  // Badge (e.g. "1 MONTH FREE") opposite the logo
  if (brief.badge) {
    const bw = Math.round(ref * 0.3);
    const bh = Math.round(ref * 0.075);
    const bx = layout === 'story-stack' || !hasLogo ? Math.round((W - bw) / 2) : rtl ? content.x : content.x + content.width - bw;
    const by = layout === 'story-stack' && hasLogo ? content.y + Math.round(logoSize * 0.5) + Math.round(ref * 0.03) : content.y;
    const size = fitFontSize(brief.badge, bw - bh * 0.6, bh * 0.7, Math.round(bh * 0.5), Math.round(bh * 0.28), 1.1, input.language);
    layers.push({
      id: 'badge', role: 'badge', type: 'text', x: bx, y: by, width: bw, height: bh, rotation: 0, opacity: 1, visible: true, locked: false,
      text: brief.badge, fontFamily: headingFont, fontSize: size, fontWeight: 800, fill: contrastText(colors.accent), align: 'center', lineHeight: 1.1, letterSpacing: 0,
      direction: rtl ? 'rtl' : 'ltr', background: { fill: colors.accent, cornerRadius: Math.round(bh / 2), padding: Math.round(bh * 0.2) },
    });
  }

  // Footer (contact details) along the bottom of the safe area
  const footer = footerText(input.brand);
  const footerH = footer ? Math.round(ref * 0.06) : 0;
  if (footer) {
    const size = fitFontSize(footer, content.width, footerH, Math.round(ref * 0.03), Math.round(ref * 0.018), 1.2, 'en');
    layers.push({
      id: 'footer', role: 'footer', type: 'text', x: content.x, y: content.y + content.height - footerH, width: content.width, height: footerH, rotation: 0, opacity: 0.95, visible: true, locked: false,
      text: footer, fontFamily: bodyFont, fontSize: size, fontWeight: 500, fill: '#FFFFFF', align: 'center', lineHeight: 1.2, letterSpacing: 0, direction: 'ltr',
    });
  }

  const topReserved = Math.max(hasLogo ? Math.round(logoSize * 0.5) : 0, brief.badge ? Math.round(ref * 0.075) : 0) + (layout === 'story-stack' && hasLogo && brief.badge ? Math.round(ref * 0.105) : 0);
  const gap = Math.round(ref * 0.025);
  const textArea: Box = {
    x: content.x,
    y: content.y + (topReserved ? topReserved + gap * 2 : 0),
    width: content.width,
    height: content.height - (topReserved ? topReserved + gap * 2 : 0) - (footerH ? footerH + gap * 2 : 0),
  };

  const blocks: Block[] = [
    { role: 'headline', text: brief.headline, font: headingFont, weight: 800, max: 0.11, min: 0.045, share: 3, lineHeight: 1.12 },
    { role: 'subheadline', text: brief.subheadline, font: headingFont, weight: 600, max: 0.055, min: 0.03, share: 1.4, lineHeight: 1.2 },
    { role: 'body', text: brief.body, font: bodyFont, weight: 400, max: 0.04, min: 0.024, share: 1.6, lineHeight: 1.35 },
    { role: 'cta', text: brief.cta, font: headingFont, weight: 700, max: 0.045, min: 0.026, share: 1, lineHeight: 1.1, pill: { fill: colors.accent } },
  ];

  if (layout === 'split-left') {
    const column: Box = { ...textArea, width: Math.round(textArea.width * 0.6), x: rtl ? textArea.x + Math.round(textArea.width * 0.4) : textArea.x };
    const deco = Math.round(Math.min(textArea.height, textArea.width * 0.36));
    layers.push({
      id: 'decoration', role: 'decoration', type: 'shape', shape: 'ellipse', fill: colors.accent, strokeWidth: 0, cornerRadius: 0,
      x: rtl ? textArea.x : textArea.x + textArea.width - deco, y: textArea.y + Math.round((textArea.height - deco) / 2), width: deco, height: deco, rotation: 0, opacity: input.backgroundFileId ? 0 : 0.35, visible: !input.backgroundFileId, locked: false,
    });
    layers.push(...stackText(blocks, column, ref, { align: rtl ? 'right' : 'left', rtl, color: '#FFFFFF', language: input.language, gap }));
  } else if (layout === 'bottom-band') {
    const bandH = Math.round(H * 0.46);
    layers.push({
      id: 'band', role: 'decoration', type: 'shape', shape: 'rect', fill: colors.background, strokeWidth: 0, cornerRadius: 0,
      x: 0, y: H - bandH, width: W, height: bandH, rotation: 0, opacity: 0.88, visible: true, locked: false,
    });
    const column: Box = { x: textArea.x, y: Math.max(textArea.y, H - bandH + gap), width: textArea.width, height: textArea.y + textArea.height - Math.max(textArea.y, H - bandH + gap) };
    layers.push(...stackText(blocks, column, ref, { align: rtl ? 'right' : 'left', rtl, color: contrastText(colors.background), language: input.language, gap }));
  } else {
    layers.push(...stackText(blocks, textArea, ref, { align: 'center', rtl, color: '#FFFFFF', language: input.language, gap: layout === 'story-stack' ? gap * 2 : gap }));
  }

  // Draw order: decorations first, then text/images in reading order; clamp everything to the canvas.
  const order: Record<string, number> = { decoration: 0, logo: 1, badge: 2, headline: 3, subheadline: 4, body: 5, cta: 6, footer: 7 };
  const clamped = layers
    .map((l) => {
      const width = Math.min(l.width, W);
      const height = Math.min(l.height, H);
      return { ...l, width, height, x: Math.min(Math.max(0, l.x), W - width), y: Math.min(Math.max(0, l.y), H - height) };
    })
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));

  return { version: 1, width: W, height: H, background, layers: clamped as DesignLayer[] };
}

/** Empty, editable document for a blank design. */
export function blankDocument(preset: Pick<SizePreset, 'width' | 'height'>): DesignDocument {
  return { version: 1, width: preset.width, height: preset.height, background: { type: 'color', color: '#FFFFFF' }, layers: [] };
}
