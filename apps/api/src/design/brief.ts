import { designBriefSchema, LAYOUT_STYLES, type DesignBrief } from '@zatma/validation';
import { LANGUAGE_NAMES } from '../ai/ai-provider.interfaces.js';

export interface BriefContext {
  prompt: string;
  language: string;
  platform: string;
  width: number;
  height: number;
  occasion?: string;
  brand?: { name: string; tagline: string | null; guidelines: string | null; website: string | null } | null;
}

/** System prompt: the model plans copy and a text-free background; layout and typography are ours. */
export function briefSystemPrompt(): string {
  return [
    'You are a senior marketing designer and copywriter for small businesses in India and the Gulf.',
    'Plan ONE marketing graphic. Return only a JSON object with these keys:',
    '- "headline": the main message, at most 8 words, punchy.',
    '- "subheadline": one supporting line, at most 14 words (may be empty).',
    '- "body": one or two short sentences with the key details or offer (may be empty).',
    '- "cta": a call to action button label, at most 4 words.',
    '- "badge": a short offer tag such as "50% OFF" or "1 MONTH FREE", or empty.',
    '- "caption": a social media caption for the post, 1-3 sentences.',
    '- "hashtags": 5-10 relevant hashtags without spaces, each starting with #.',
    `- "layout": one of ${LAYOUT_STYLES.map((l) => `"${l}"`).join(', ')}.`,
    '- "palette": optional { "primary", "accent", "background" } hex colours suited to the request.',
    '- "backgroundPrompt": an English description of a background photo or illustration for the graphic.',
    'The background must contain NO text, letters, numbers, words, logos or watermarks, and should leave calm space for text overlays.',
    'Use only facts present in the request or brand details. Never invent prices, phone numbers, dates or claims.',
  ].join('\n');
}

export function briefUserPrompt(ctx: BriefContext): string {
  const lang = LANGUAGE_NAMES[ctx.language] ?? 'English';
  const lines = [
    `Request: ${ctx.prompt}`,
    `Platform/size: ${ctx.platform} (${ctx.width}x${ctx.height}).`,
    `Write headline, subheadline, body, cta, badge and caption in ${lang}${ctx.language === 'en' ? '' : ' (native script)'}; hashtags and backgroundPrompt in English.`,
  ];
  if (ctx.occasion) lines.push(`Occasion: ${ctx.occasion}.`);
  if (ctx.brand) {
    lines.push(`Brand: ${ctx.brand.name}${ctx.brand.tagline ? ` (tagline: ${ctx.brand.tagline})` : ''}${ctx.brand.website ? `, website ${ctx.brand.website}` : ''}.`);
    if (ctx.brand.guidelines) lines.push(`Brand guidelines: ${ctx.brand.guidelines.slice(0, 1500)}`);
  }
  return lines.join('\n');
}

export class BriefParseError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid design brief: ${reason}`);
    this.name = 'BriefParseError';
  }
}

/** Parses model output into a validated brief. Tolerates code fences and surrounding prose. */
export function parseBrief(text: string): DesignBrief {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new BriefParseError('no JSON object found');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped.slice(start, end + 1));
  } catch (e) {
    throw new BriefParseError(`malformed JSON (${(e as Error).message})`);
  }
  const result = designBriefSchema.safeParse(raw);
  if (!result.success) throw new BriefParseError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const brief = result.data;
  return {
    ...brief,
    hashtags: brief.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')).filter((h) => h.length > 1),
  };
}

/** Prompt for the background image: text-free by construction. */
export function backgroundImagePrompt(brief: DesignBrief, fallbackPrompt: string): string {
  const subject = brief.backgroundPrompt || fallbackPrompt;
  return `${subject}\n\nStyle: high-quality marketing visual. Absolutely no text, letters, numbers, words, signage, logos or watermarks anywhere in the image. Leave uncluttered areas suitable for overlaying text.`;
}
