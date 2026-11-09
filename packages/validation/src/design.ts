import { z } from 'zod';

// ───────────── Size presets ─────────────

export interface SizePreset {
  id: SizePresetId;
  label: string;
  platform: string;
  width: number;
  height: number;
  /** Insets (px) kept clear of important content, e.g. the Instagram Story UI. */
  safe: { top: number; right: number; bottom: number; left: number };
}

export const SIZE_PRESET_IDS = [
  'instagram_post',
  'instagram_story',
  'facebook_post',
  'facebook_cover',
  'linkedin_post',
  'youtube_thumbnail',
  'whatsapp_status',
] as const;
export type SizePresetId = (typeof SIZE_PRESET_IDS)[number];

const pad = (v: number) => ({ top: v, right: v, bottom: v, left: v });

export const SIZE_PRESETS: Record<SizePresetId, SizePreset> = {
  instagram_post: { id: 'instagram_post', label: 'Instagram Post', platform: 'Instagram', width: 1080, height: 1080, safe: pad(60) },
  instagram_story: { id: 'instagram_story', label: 'Instagram Story', platform: 'Instagram', width: 1080, height: 1920, safe: { top: 250, right: 64, bottom: 250, left: 64 } },
  facebook_post: { id: 'facebook_post', label: 'Facebook Post', platform: 'Facebook', width: 1200, height: 630, safe: pad(48) },
  facebook_cover: { id: 'facebook_cover', label: 'Facebook Cover', platform: 'Facebook', width: 820, height: 312, safe: { top: 24, right: 40, bottom: 24, left: 200 } },
  linkedin_post: { id: 'linkedin_post', label: 'LinkedIn Post', platform: 'LinkedIn', width: 1200, height: 627, safe: pad(48) },
  youtube_thumbnail: { id: 'youtube_thumbnail', label: 'YouTube Thumbnail', platform: 'YouTube', width: 1280, height: 720, safe: { top: 48, right: 200, bottom: 80, left: 48 } },
  whatsapp_status: { id: 'whatsapp_status', label: 'WhatsApp Status', platform: 'WhatsApp', width: 1080, height: 1920, safe: { top: 220, right: 64, bottom: 220, left: 64 } },
};

// ───────────── Fonts ─────────────

export const FONT_CATALOG = [
  { family: 'Inter', scripts: ['latin'] },
  { family: 'Poppins', scripts: ['latin', 'devanagari'] },
  { family: 'Montserrat', scripts: ['latin'] },
  { family: 'Playfair Display', scripts: ['latin'] },
  { family: 'Bebas Neue', scripts: ['latin'] },
  { family: 'Noto Sans Malayalam', scripts: ['malayalam', 'latin'] },
  { family: 'Noto Sans Arabic', scripts: ['arabic', 'latin'] },
  { family: 'Noto Sans Devanagari', scripts: ['devanagari', 'latin'] },
  { family: 'Noto Sans Tamil', scripts: ['tamil', 'latin'] },
  { family: 'Noto Sans Kannada', scripts: ['kannada', 'latin'] },
  { family: 'Noto Sans Telugu', scripts: ['telugu', 'latin'] },
] as const;
export type FontFamily = (typeof FONT_CATALOG)[number]['family'];
export const FONT_FAMILIES = FONT_CATALOG.map((f) => f.family) as [FontFamily, ...FontFamily[]];

/** Default heading/body font that can render the language's script. */
export const LANGUAGE_FONTS: Record<string, { heading: FontFamily; body: FontFamily; rtl: boolean }> = {
  en: { heading: 'Poppins', body: 'Inter', rtl: false },
  ml: { heading: 'Noto Sans Malayalam', body: 'Noto Sans Malayalam', rtl: false },
  ar: { heading: 'Noto Sans Arabic', body: 'Noto Sans Arabic', rtl: true },
  hi: { heading: 'Noto Sans Devanagari', body: 'Noto Sans Devanagari', rtl: false },
  ta: { heading: 'Noto Sans Tamil', body: 'Noto Sans Tamil', rtl: false },
  kn: { heading: 'Noto Sans Kannada', body: 'Noto Sans Kannada', rtl: false },
  te: { heading: 'Noto Sans Telugu', body: 'Noto Sans Telugu', rtl: false },
};

// ───────────── Design document ─────────────

const hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use a #RRGGBB colour');
const coord = z.number().finite().min(-10_000).max(10_000);
const size = z.number().finite().min(1).max(10_000);
const fileId = z.uuid();

export const backgroundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('color'), color: hex }).strict(),
  z.object({ type: z.literal('gradient'), from: hex, to: hex, angle: z.number().min(0).max(360) }).strict(),
  z
    .object({
      type: z.literal('image'),
      fileId,
      fit: z.enum(['cover', 'contain']),
      fallbackColor: hex,
      overlay: z.object({ color: hex, opacity: z.number().min(0).max(1) }).strict().optional(),
    })
    .strict(),
]);
export type DesignBackground = z.infer<typeof backgroundSchema>;

export const LAYER_ROLES = ['headline', 'subheadline', 'body', 'cta', 'footer', 'logo', 'product', 'decoration', 'badge'] as const;
export type LayerRole = (typeof LAYER_ROLES)[number];

const layerBase = {
  id: z.string().min(1).max(64),
  role: z.enum(LAYER_ROLES),
  name: z.string().max(80).optional(),
  x: coord,
  y: coord,
  width: size,
  height: size,
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
};

export const textLayerSchema = z
  .object({
    ...layerBase,
    type: z.literal('text'),
    text: z.string().max(2000),
    fontFamily: z.enum(FONT_FAMILIES),
    fontSize: z.number().min(6).max(600),
    fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]),
    fill: hex,
    align: z.enum(['left', 'center', 'right']),
    lineHeight: z.number().min(0.7).max(3),
    letterSpacing: z.number().min(-20).max(50).default(0),
    direction: z.enum(['ltr', 'rtl']).default('ltr'),
    /** Pill behind the text (CTA buttons, badges). */
    background: z.object({ fill: hex, cornerRadius: z.number().min(0).max(500), padding: z.number().min(0).max(200) }).strict().optional(),
  })
  .strict();

export const imageLayerSchema = z
  .object({ ...layerBase, type: z.literal('image'), fileId, fit: z.enum(['cover', 'contain']), cornerRadius: z.number().min(0).max(2000).default(0) })
  .strict();

export const shapeLayerSchema = z
  .object({
    ...layerBase,
    type: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse']),
    fill: hex,
    stroke: hex.optional(),
    strokeWidth: z.number().min(0).max(100).default(0),
    cornerRadius: z.number().min(0).max(2000).default(0),
  })
  .strict();

export const layerSchema = z.discriminatedUnion('type', [textLayerSchema, imageLayerSchema, shapeLayerSchema]);
export type TextLayer = z.infer<typeof textLayerSchema>;
export type ImageLayer = z.infer<typeof imageLayerSchema>;
export type ShapeLayer = z.infer<typeof shapeLayerSchema>;
export type DesignLayer = z.infer<typeof layerSchema>;

export const MAX_LAYERS = 60;

export const designDocumentSchema = z
  .object({
    version: z.literal(1),
    width: z.number().int().min(100).max(5000),
    height: z.number().int().min(100).max(5000),
    background: backgroundSchema,
    layers: z.array(layerSchema).max(MAX_LAYERS),
  })
  .strict()
  .refine((d) => new Set(d.layers.map((l) => l.id)).size === d.layers.length, { message: 'Layer ids must be unique', path: ['layers'] });
export type DesignDocument = z.infer<typeof designDocumentSchema>;

/** All stored-file ids a document references (for ownership checks and signed URL resolution). */
export function documentFileIds(doc: DesignDocument): string[] {
  const ids = new Set<string>();
  if (doc.background.type === 'image') ids.add(doc.background.fileId);
  for (const l of doc.layers) if (l.type === 'image') ids.add(l.fileId);
  return [...ids];
}

// ───────────── AI brief (model output) ─────────────

export const LAYOUT_STYLES = ['hero-center', 'split-left', 'bottom-band', 'story-stack'] as const;
export type LayoutStyle = (typeof LAYOUT_STYLES)[number];

/** What the language model returns for a design request. Lenient on lengths; trimmed by the composer. */
export const designBriefSchema = z.object({
  headline: z.string().trim().min(1).max(140),
  subheadline: z.string().trim().max(200).optional().default(''),
  body: z.string().trim().max(400).optional().default(''),
  cta: z.string().trim().max(40).optional().default(''),
  badge: z.string().trim().max(30).optional().default(''),
  caption: z.string().trim().max(2200).optional().default(''),
  hashtags: z.array(z.string().trim().max(60)).max(30).optional().default([]),
  layout: z.enum(LAYOUT_STYLES).optional().catch(undefined),
  palette: z
    .object({ primary: hex.optional().catch(undefined), accent: hex.optional().catch(undefined), background: hex.optional().catch(undefined) })
    .partial()
    .optional()
    .catch(undefined),
  backgroundPrompt: z.string().trim().max(1000).optional().default(''),
});
export type DesignBrief = z.infer<typeof designBriefSchema>;

// ───────────── API inputs ─────────────

export const brandKitSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    workspaceId: z.uuid().nullable().optional(),
    logoFileId: z.uuid().nullable().optional(),
    colors: z.object({ primary: hex, secondary: hex, accent: hex, background: hex, text: hex }).strict(),
    fonts: z.object({ heading: z.enum(FONT_FAMILIES), body: z.enum(FONT_FAMILIES) }).strict(),
    tagline: z.string().trim().max(140).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    whatsapp: z.string().trim().max(40).nullable().optional(),
    email: z.email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
    address: z.string().trim().max(300).nullable().optional(),
    guidelines: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();
export type BrandKitInput = z.infer<typeof brandKitSchema>;
export const updateBrandKitSchema = brandKitSchema.partial().strict();
export type UpdateBrandKitInput = z.infer<typeof updateBrandKitSchema>;

export const DESIGN_LANGUAGES = ['en', 'ml', 'ar', 'hi', 'ta', 'kn', 'te'] as const;

export const generateDesignSchema = z
  .object({
    prompt: z.string().trim().min(8, 'Describe the design in a sentence or two').max(2000),
    sizePreset: z.enum(SIZE_PRESET_IDS).default('instagram_post'),
    language: z.enum(DESIGN_LANGUAGES).default('en'),
    brandKitId: z.uuid().nullable().optional(),
    workspaceId: z.uuid().optional(),
    aiBackground: z.boolean().default(true),
    occasion: z.string().trim().max(60).optional(),
  })
  .strict();
export type GenerateDesignInput = z.infer<typeof generateDesignSchema>;

export const createDesignSchema = z
  .object({
    title: z.string().trim().min(1).max(120).default('Untitled design'),
    sizePreset: z.enum(SIZE_PRESET_IDS).default('instagram_post'),
    workspaceId: z.uuid().optional(),
    templateId: z.uuid().optional(),
  })
  .strict();
export type CreateDesignInput = z.infer<typeof createDesignSchema>;

export const updateDesignSchema = z
  .object({
    revision: z.number().int().min(0),
    title: z.string().trim().min(1).max(120).optional(),
    document: designDocumentSchema.optional(),
  })
  .strict();
export type UpdateDesignInput = z.infer<typeof updateDesignSchema>;

export const saveVersionSchema = z.object({ note: z.string().trim().max(120).optional() }).strict();
export const saveTemplateSchema = z.object({ name: z.string().trim().min(2).max(80), category: z.string().trim().max(40).default('General') }).strict();
export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;
export const setThumbnailSchema = z.object({ fileId: z.uuid() }).strict();

export const listDesignsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  q: z.string().trim().max(100).optional(),
  workspaceId: z.uuid().optional(),
});
export type ListDesignsInput = z.infer<typeof listDesignsSchema>;

// ───────────── API response shapes ─────────────

export interface BrandKitDto {
  id: string;
  name: string;
  workspaceId: string | null;
  isDefault: boolean;
  logoFileId: string | null;
  logoUrl: string | null;
  colors: BrandKitInput['colors'];
  fonts: BrandKitInput['fonts'];
  tagline: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  guidelines: string | null;
  updatedAt: string;
}

export type DesignStatus = 'DRAFT' | 'GENERATING' | 'READY' | 'FAILED';

export interface DesignSummary {
  id: string;
  title: string;
  sizePreset: string;
  width: number;
  height: number;
  language: string;
  status: DesignStatus;
  thumbnailUrl: string | null;
  workspaceId: string;
  updatedAt: string;
  createdAt: string;
}

export interface DesignDetail extends DesignSummary {
  prompt: string | null;
  brandKitId: string | null;
  revision: number;
  document: DesignDocument;
  caption: string | null;
  hashtags: string[];
  generationJobId: string | null;
  error: { code: string; message: string } | null;
  /** Short-lived signed URLs for every file the document references. */
  assets: Record<string, string>;
}

export interface DesignVersionSummary {
  id: string;
  revision: number;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface TemplateSummary {
  id: string;
  name: string;
  category: string;
  sizePreset: string;
  width: number;
  height: number;
  thumbnailUrl: string | null;
  createdAt: string;
}
