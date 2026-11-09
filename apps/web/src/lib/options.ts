import { CURRENCIES, LANGUAGES } from '@zatma/validation';

export const LANGUAGE_LABELS: Record<(typeof LANGUAGES)[number], string> = {
  en: 'English',
  ml: 'Malayalam (മലയാളം)',
  ar: 'Arabic (العربية)',
  hi: 'Hindi (हिन्दी)',
  ta: 'Tamil (தமிழ்)',
  kn: 'Kannada (ಕನ್ನಡ)',
  te: 'Telugu (తెలుగు)',
};

export { CURRENCIES, LANGUAGES };

/** IANA time zones supported by the browser, with common ones for our markets first. */
export function timeZones(): string[] {
  const preferred = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Muscat', 'Asia/Kuwait', 'Asia/Bahrain', 'UTC'];
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...preferred, ...all.filter((z) => !preferred.includes(z))];
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
