import { isRtlLanguage, REWRITE_ACTION_LABELS, REWRITE_ACTIONS, type LimitCheck, type RewriteAction } from '@zatma/validation';

export type LimitTone = 'neutral' | 'warning' | 'danger';

/** Human-readable length status for a piece of copy. */
export function limitStatus(l: LimitCheck): { label: string; tone: LimitTone; detail: string | null } {
  // Show the tighter of the recommendation and the hard platform limit.
  const cap = l.recommended !== null && (l.max === null || l.recommended < l.max) ? l.recommended : l.max;
  const label = cap ? `${l.count.toLocaleString()} / ${cap.toLocaleString()}` : `${l.count.toLocaleString()} characters`;
  const details: string[] = [];
  if (l.max !== null && l.count > l.max) details.push(`Over the ${l.max.toLocaleString()}-character platform limit`);
  if (l.maxHashtags !== null && l.hashtagCount > l.maxHashtags) details.push(`${l.hashtagCount} hashtags; the platform allows ${l.maxHashtags}`);
  if (!l.overLimit && l.long && l.recommended) details.push(`Longer than the recommended ${l.recommended}`);
  if (l.sms) details.push(`${l.sms.segments} SMS segment${l.sms.segments === 1 ? '' : 's'} (${l.sms.encoding})`);
  return { label, tone: l.overLimit ? 'danger' : l.long ? 'warning' : 'neutral', detail: details.length ? details.join(' · ') : null };
}

export const textDirection = (language: string): 'rtl' | 'ltr' => (isRtlLanguage(language) ? 'rtl' : 'ltr');

/** Rewrite menu entries (custom is handled with its own input). */
export const REWRITE_MENU: Array<{ action: Exclude<RewriteAction, 'custom'>; label: string }> = REWRITE_ACTIONS.filter((a): a is Exclude<RewriteAction, 'custom'> => a !== 'custom').map((action) => ({
  action,
  label: REWRITE_ACTION_LABELS[action],
}));

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Text placed on the clipboard: copy plus hashtags on their own line. */
export const clipboardText = (text: string, hashtags: string[]) => (hashtags.length ? `${text}\n\n${hashtags.join(' ')}` : text);
