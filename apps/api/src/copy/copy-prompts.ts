import type { z } from 'zod';
import {
  COPY_KIND_INFO,
  COPY_PLATFORM_LABELS,
  hardLimit,
  MAX_HASHTAGS,
  type CopyKind,
  type CopyPlatform,
  type GenerateCopyInput,
  type RewriteAction,
  type TranslateCopyInput,
} from '@zatma/validation';
import { LANGUAGE_NAMES } from '../ai/ai-provider.interfaces.js';

/** Brand facts the model may use (and nothing else). */
export interface BrandFacts {
  name: string;
  tagline: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  guidelines: string | null;
}

const LANGUAGE_GUIDANCE: Record<string, string> = {
  en: 'Write in clear, natural English suited to India and the Gulf.',
  ml: 'Write in natural, conversational Kerala Malayalam in Malayalam script, as used in local advertising. Well-known English brand or product words (ERP, WhatsApp, app names) may stay in English. Never transliterate Malayalam into Latin letters.',
  ar: 'Write in Modern Standard Arabic suited to GCC audiences, in Arabic script, with natural marketing phrasing (not a literal translation). Keep brand names in their original form.',
  hi: 'Write in natural Hindi in Devanagari script; common English business words may stay in English.',
  ta: 'Write in natural Tamil in Tamil script; common English business words may stay in English.',
  kn: 'Write in natural Kannada in Kannada script; common English business words may stay in English.',
  te: 'Write in natural Telugu in Telugu script; common English business words may stay in English.',
};

export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? 'English';
export const languageGuidance = (code: string) => LANGUAGE_GUIDANCE[code] ?? LANGUAGE_GUIDANCE.en!;

const FACT_RULE =
  'Use ONLY facts given in the request or the brand details. Never invent prices, discounts, dates, phone numbers, addresses, URLs, statistics, awards or guarantees. If a detail is missing, write around it.';

function brandBlock(brand: BrandFacts | null): string {
  if (!brand) return 'Brand details: none provided.';
  const lines = [
    `Brand name: ${brand.name}`,
    brand.tagline && `Tagline: ${brand.tagline}`,
    brand.website && `Website: ${brand.website}`,
    brand.phone && `Phone: ${brand.phone}`,
    brand.whatsapp && `WhatsApp: ${brand.whatsapp}`,
    brand.email && `Email: ${brand.email}`,
    brand.address && `Address: ${brand.address}`,
    brand.guidelines && `Brand guidelines (follow them): ${brand.guidelines}`,
  ].filter(Boolean);
  return `Brand details:\n${lines.join('\n')}`;
}

function lengthRule(kind: CopyKind, platform: CopyPlatform): string {
  const rec = COPY_KIND_INFO[kind].recommended;
  const max = hardLimit(kind, platform);
  const parts: string[] = [];
  if (rec) parts.push(`aim for at most ${rec} characters`);
  if (max) parts.push(`never exceed ${max} characters`);
  if (kind === 'sms') parts.push('keep it to one SMS (160 characters in English, 70 in other scripts) if possible');
  return parts.length ? `Length: ${parts.join('; ')}.` : '';
}

const KIND_RULES: Partial<Record<CopyKind, string>> = {
  headline: 'One line, no hashtags, no trailing full stop.',
  caption: 'Open with a hook, give the key benefit or offer, end with a clear call to action. Short paragraphs; line breaks allowed.',
  hashtags: 'Each variant is a set of hashtags only: put them space-separated in "text" and also as a list in "hashtags". Mix popular, local (Kerala/India/GCC where relevant) and niche tags.',
  ad_primary_text: 'Lead with the benefit in the first line; one call to action. Follow advertising policies: no personal attributes, no exaggerated claims.',
  ad_headline: 'Very short and specific; no hashtags.',
  ad_description: 'One short supporting phrase; no hashtags.',
  product_description: 'Benefits first, then key features; scannable short sentences.',
  cta: 'A short button label or closing line, verb first.',
  whatsapp_message: 'Warm, personal and concise, like a message from the business owner. Use line breaks; at most a few emojis; end with how to reply or order.',
  email_subject: 'No clickbait, no ALL CAPS, no spammy words like FREE!!!.',
  sms: 'Plain text, include the brand name, one call to action.',
};

export function copySystemPrompt(): string {
  return [
    'You are an expert marketing copywriter for small and medium businesses in India (especially Kerala) and the Gulf (UAE, Saudi Arabia, Qatar, Oman, Kuwait, Bahrain).',
    'You write copy that sounds native in the requested language, never like a machine translation.',
    FACT_RULE,
    'Each variant must take a clearly different angle (benefit, urgency, emotion, social proof from given facts, question hook, etc.).',
    'Reply with only a JSON object: {"variants":[{"text":"...","hashtags":["#tag", ...]}]}. Hashtags start with # and contain no spaces. No markdown, no commentary.',
  ].join('\n');
}

export function copyUserPrompt(input: GenerateCopyInput, brand: BrandFacts | null): string {
  const info = COPY_KIND_INFO[input.kind];
  const maxTags = MAX_HASHTAGS[input.platform as CopyPlatform];
  const wantsTags = input.kind === 'hashtags' || (input.includeHashtags && ['caption', 'ad_primary_text', 'whatsapp_message', 'product_description'].includes(input.kind));
  return [
    `Write ${input.variants} variant(s) of: ${info.label} (${info.description}).`,
    `Platform: ${COPY_PLATFORM_LABELS[input.platform as CopyPlatform]}.`,
    `Request: ${input.brief}`,
    `Goal: ${input.goal}. Tone: ${input.tone}.`,
    input.audience ? `Audience: ${input.audience}.` : '',
    input.keywords.length ? `Include these keywords naturally where they fit: ${input.keywords.join(', ')}.` : '',
    `Language: ${languageName(input.language)}. ${languageGuidance(input.language)}`,
    lengthRule(input.kind, input.platform as CopyPlatform),
    KIND_RULES[input.kind] ?? '',
    input.includeEmojis ? 'Emojis: a few, where they add meaning.' : 'Emojis: none.',
    wantsTags
      ? `Hashtags: put ${input.kind === 'hashtags' ? '10-20' : '3-8'} relevant hashtags in "hashtags"${maxTags ? ` (platform maximum ${maxTags})` : ''}; hashtags may be English or ${languageName(input.language)}. Do not repeat them inside "text".`
      : 'Hashtags: none (return an empty "hashtags" list).',
    brandBlock(brand),
  ]
    .filter(Boolean)
    .join('\n');
}

export function translateSystemPrompt(): string {
  return [
    'You are a professional marketing localiser for India and the Gulf.',
    'Adapt the copy so it reads as if written natively in each target language: keep the meaning, offer, tone and call to action, but use natural phrasing rather than a literal translation.',
    'Keep brand names, product names, prices, percentages, numbers, phone numbers, email addresses and URLs exactly as in the source (Western digits).',
    'Translate hashtags only when a natural local hashtag exists; otherwise keep the original.',
    'Reply with only a JSON object: {"translations":[{"language":"<code>","text":"...","hashtags":["#..."]}]} with one entry per target language, in the order given.',
  ].join('\n');
}

export function translateUserPrompt(input: TranslateCopyInput): string {
  return [
    `Target languages: ${input.targetLanguages.map((l) => `${l} (${languageName(l)})`).join(', ')}.`,
    ...input.targetLanguages.map((l) => `- ${l}: ${languageGuidance(l)}`),
    input.sourceLanguage ? `Source language: ${languageName(input.sourceLanguage)}.` : '',
    input.tone ? `Tone: ${input.tone}.` : '',
    `Source text:\n"""\n${input.text}\n"""`,
    input.hashtags.length ? `Source hashtags: ${input.hashtags.join(' ')}` : 'Source hashtags: none.',
  ]
    .filter(Boolean)
    .join('\n');
}

const REWRITE_INSTRUCTIONS: Record<Exclude<RewriteAction, 'custom'>, string> = {
  shorter: 'Make it noticeably shorter (about half the length) while keeping the key message and call to action.',
  longer: 'Make it somewhat longer and more descriptive, adding no new facts.',
  more_formal: 'Make the tone more formal and professional.',
  more_casual: 'Make the tone more casual and friendly.',
  more_persuasive: 'Make it more persuasive, with a stronger benefit and call to action, adding no new facts.',
  add_emojis: 'Add a few fitting emojis without changing the wording much.',
  remove_emojis: 'Remove all emojis without changing the wording otherwise.',
};

export function rewriteSystemPrompt(): string {
  return [
    'You edit marketing copy. Apply the requested change and keep everything else: language and script, meaning, facts, numbers, URLs and brand names.',
    FACT_RULE,
    'Reply with only a JSON object: {"text":"..."}.',
  ].join('\n');
}

export function rewriteUserPrompt(text: string, language: string, action: RewriteAction, instruction?: string): string {
  const change = action === 'custom' ? `Change requested by the user: ${instruction}` : REWRITE_INSTRUCTIONS[action];
  return [change, `Language: ${languageName(language)}. ${languageGuidance(language)}`, `Text:\n"""\n${text}\n"""`].join('\n');
}

export interface DesignTextForTranslation {
  id: string;
  role: string;
  text: string;
  maxChars: number;
}

export function designTranslateSystemPrompt(): string {
  return [
    'You localise the text layers of a marketing graphic.',
    'Translate each layer naturally into the target language, keeping its role (headline stays punchy, call to action stays a short button label).',
    'Stay within each layer\'s maxChars so the text fits its box. Keep brand names, numbers, prices, phone numbers and URLs unchanged (Western digits).',
    'Return only JSON: {"layers":[{"id":"<same id>","text":"..."}],"caption":"...","hashtags":["#..."]} with every layer id from the input.',
  ].join('\n');
}

export function designTranslateUserPrompt(target: string, layers: DesignTextForTranslation[], caption: string | null, hashtags: string[]): string {
  return [
    `Target language: ${languageName(target)}. ${languageGuidance(target)}`,
    `Layers (JSON): ${JSON.stringify(layers)}`,
    `Caption: ${caption ? JSON.stringify(caption) : '(none, return "")'}`,
    `Hashtags: ${hashtags.length ? hashtags.join(' ') : '(none, return [])'}`,
  ].join('\n');
}

// ───────────── Output parsing ─────────────

export class OutputParseError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid AI output: ${reason}`);
    this.name = 'OutputParseError';
  }
}

/** Extracts the first JSON object from model output (tolerating fences and prose) and validates it. */
export function parseJsonOutput<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new OutputParseError('no JSON object found');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped.slice(start, end + 1));
  } catch (e) {
    throw new OutputParseError(`malformed JSON (${(e as Error).message})`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new OutputParseError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
