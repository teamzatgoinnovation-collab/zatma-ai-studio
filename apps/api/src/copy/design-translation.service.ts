import { HttpStatus, Injectable } from '@nestjs/common';
import {
  countGraphemes,
  designDocumentSchema,
  designTranslationOutputSchema,
  FONT_CATALOG,
  LANGUAGE_FONTS,
  normalizeHashtags,
  type DesignDetail,
  type DesignDocument,
  type DesignLayer,
  type FontFamily,
  type TextLayer,
} from '@zatma/validation';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fitFontSize } from '../design/composer.js';
import { DesignService } from '../design/design.service.js';
import { CopyService } from './copy.service.js';
import { designTranslateSystemPrompt, designTranslateUserPrompt, languageName, type DesignTextForTranslation } from './copy-prompts.js';

const LANGUAGE_SCRIPT: Record<string, string> = { en: 'latin', ml: 'malayalam', ar: 'arabic', hi: 'devanagari', ta: 'tamil', kn: 'kannada', te: 'telugu' };
const HEADING_ROLES = new Set(['headline', 'badge', 'cta', 'subheadline']);

/** A font that can render the target script: keep the current one if it can, else the language default. */
export function fontForLanguage(current: FontFamily, role: string, language: string): FontFamily {
  const script = LANGUAGE_SCRIPT[language] ?? 'latin';
  const font = FONT_CATALOG.find((f) => f.family === current);
  if (font && (font.scripts as readonly string[]).includes(script)) return current;
  const defaults = LANGUAGE_FONTS[language] ?? LANGUAGE_FONTS.en!;
  return HEADING_ROLES.has(role) ? defaults.heading : defaults.body;
}

/** Re-targets one text layer: new text, script-capable font, direction, alignment and a size that fits its box. */
export function localiseTextLayer(layer: TextLayer, text: string, language: string): TextLayer {
  const rtl = (LANGUAGE_FONTS[language] ?? LANGUAGE_FONTS.en!).rtl;
  const align = layer.align === 'center' ? 'center' : rtl ? (layer.align === 'left' ? 'right' : layer.align) : layer.align === 'right' && layer.direction === 'rtl' ? 'left' : layer.align;
  const pad = layer.background?.padding ?? 0;
  const innerW = Math.max(1, layer.width - pad * 2);
  const innerH = Math.max(1, layer.height - pad * 2);
  const fontSize = fitFontSize(text, innerW, innerH, layer.fontSize, Math.max(6, Math.round(layer.fontSize * 0.45)), layer.lineHeight, language);
  return {
    ...layer,
    text,
    fontFamily: fontForLanguage(layer.fontFamily, layer.role, language),
    direction: rtl ? 'rtl' : 'ltr',
    align,
    fontSize,
  };
}

/** Creates a translated copy of a design: every text layer is localised in one AI call, layout and images are kept. */
@Injectable()
export class DesignTranslationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly designs: DesignService,
    private readonly copy: CopyService,
  ) {}

  async translate(designId: string, language: string): Promise<DesignDetail> {
    const src = await this.designs.getEntity(designId);
    if (src.status === 'GENERATING') throw new AppException(HttpStatus.CONFLICT, 'DESIGN_GENERATING', 'This design is still being generated');
    if (src.language === language) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'SAME_LANGUAGE', `This design is already in ${languageName(language)}`);
    const doc = designDocumentSchema.parse(src.document);
    const textLayers = doc.layers.filter((l): l is TextLayer => l.type === 'text' && l.text.trim().length > 0);
    if (textLayers.length === 0 && !src.caption) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'NOTHING_TO_TRANSLATE', 'This design has no text to translate');

    const items: DesignTextForTranslation[] = textLayers.map((l) => ({ id: l.id, role: l.role, text: l.text, maxChars: Math.max(8, Math.ceil(countGraphemes(l.text) * 1.3)) }));
    const res = await this.copy.runJson(
      designTranslateSystemPrompt(),
      designTranslateUserPrompt(language, items, src.caption, src.hashtags),
      designTranslationOutputSchema,
      Math.min(6000, 400 + items.reduce((n, i) => n + i.maxChars * 4, 0) + (src.caption ? 800 : 0)),
    );
    const translated = new Map(res.data.layers.map((l) => [l.id, l.text.trim()]));

    const layers: DesignLayer[] = doc.layers.map((l) => {
      if (l.type !== 'text') return l;
      const text = translated.get(l.id);
      return text ? localiseTextLayer(l, text, language) : l;
    });
    const document: DesignDocument = designDocumentSchema.parse({ ...doc, layers });

    const created = await this.prisma.tenant.design.create({
      data: {
        organizationId: src.organizationId,
        workspaceId: src.workspaceId,
        brandKitId: src.brandKitId,
        title: `${src.title} (${languageName(language)})`.slice(0, 120),
        prompt: src.prompt,
        sizePreset: src.sizePreset,
        width: src.width,
        height: src.height,
        language,
        document: document as unknown as Prisma.InputJsonValue,
        caption: res.data.caption || src.caption,
        hashtags: res.data.hashtags.length ? normalizeHashtags(res.data.hashtags) : src.hashtags,
        status: 'READY',
        revision: 1,
        createdById: TenantContext.get()?.userId ?? null,
      },
    });
    await this.prisma.tenant.designVersion.create({
      data: { organizationId: src.organizationId, designId: created.id, revision: 1, document: document as unknown as Prisma.InputJsonValue, note: `Translated from ${languageName(src.language)}`, createdById: created.createdById },
    });
    return this.designs.get(created.id);
  }
}
