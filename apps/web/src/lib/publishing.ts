import { zonedParts, zonedToUtc, type PostStatus, type TargetStatus } from '@zatma/validation';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary';

export const POST_TONE: Record<PostStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  SCHEDULED: 'primary',
  PUBLISHING: 'primary',
  PUBLISHED: 'success',
  PARTIALLY_PUBLISHED: 'warning',
  FAILED: 'danger',
  CANCELED: 'neutral',
};

export const TARGET_LABEL: Record<TargetStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Waiting', tone: 'neutral' },
  PUBLISHING: { label: 'Publishing', tone: 'primary' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELED: { label: 'Canceled', tone: 'neutral' },
};

// ── Day keys ("YYYY-MM-DD") are calendar days in the organization's time zone ──

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parseKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return { y, m, d };
};

export function addDays(key: string, days: number): string {
  const { y, m, d } = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return dayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Day of week of a day key (0 = Sunday). */
export const weekday = (key: string) => {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export function todayKey(timeZone: string, now = new Date()): string {
  const p = zonedParts(now, timeZone);
  return dayKey(p.year, p.month, p.day);
}

export const keyOf = (iso: string, timeZone: string) => {
  const p = zonedParts(new Date(iso), timeZone);
  return dayKey(p.year, p.month, p.day);
};

/** Monday-first weeks covering the month of `anchor` (6 rows max). */
export function monthGrid(anchor: string): Array<Array<{ key: string; inMonth: boolean }>> {
  const { y, m } = parseKey(anchor);
  const first = dayKey(y, m, 1);
  const start = addDays(first, -((weekday(first) + 6) % 7));
  const weeks: Array<Array<{ key: string; inMonth: boolean }>> = [];
  for (let w = 0, k = start; w < 6; w++) {
    const row = Array.from({ length: 7 }, (_, i) => addDays(k, i)).map((key) => ({ key, inMonth: parseKey(key).m === m }));
    if (w > 3 && !row.some((c) => c.inMonth)) break;
    weeks.push(row);
    k = addDays(k, 7);
  }
  return weeks;
}

/** Monday of the week containing `key`. */
export const weekStart = (key: string) => addDays(key, -((weekday(key) + 6) % 7));

export type CalendarView = 'month' | 'week' | 'day' | 'list';

/** UTC range to fetch for a view (whole days in the org time zone). */
export function viewRange(view: CalendarView, anchor: string, timeZone: string): { from: string; to: string; days: string[] } {
  let days: string[];
  if (view === 'month') days = monthGrid(anchor).flat().map((c) => c.key);
  else if (view === 'week') days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
  else if (view === 'day') days = [anchor];
  else days = Array.from({ length: 30 }, (_, i) => addDays(anchor, i));
  const startKey = parseKey(days[0]!);
  const endKey = parseKey(addDays(days.at(-1)!, 1));
  return {
    from: zonedToUtc({ year: startKey.y, month: startKey.m, day: startKey.d }, timeZone).toISOString(),
    to: zonedToUtc({ year: endKey.y, month: endKey.m, day: endKey.d }, timeZone).toISOString(),
    days,
  };
}

/** Moves the anchor by one unit of the view. */
export function shiftAnchor(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === 'month') {
    const { y, m } = parseKey(anchor);
    const t = new Date(Date.UTC(y, m - 1 + dir, 1));
    return dayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
  }
  return addDays(anchor, dir * (view === 'week' ? 7 : view === 'day' ? 1 : 30));
}

/** Same wall-clock time on another day (drag to reschedule). */
export function moveToDay(iso: string, timeZone: string, key: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  const { y, m, d } = parseKey(key);
  return zonedToUtc({ year: y, month: m, day: d, hour: p.hour, minute: p.minute }, timeZone).toISOString();
}

/** `<input type="datetime-local">` value for an instant shown in `timeZone`. */
export function toLocalInput(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${dayKey(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Instant for a `datetime-local` value interpreted in `timeZone`. */
export function fromLocalInput(value: string, timeZone: string): string {
  const [date, time = '00:00'] = value.split('T');
  const { y, m, d } = parseKey(date!);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return zonedToUtc({ year: y, month: m, day: d, hour: hh, minute: mm }, timeZone).toISOString();
}

export function formatInZone(iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, ...opts }).format(new Date(iso));
}

export function groupByDay<T extends { at: string }>(entries: T[], timeZone: string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const e of [...entries].sort((a, b) => a.at.localeCompare(b.at))) (out[keyOf(e.at, timeZone)] ??= []).push(e);
  return out;
}

/** Suggested first slot: the next full hour at least 15 minutes away. */
export function nextSlot(now = new Date()): string {
  const t = new Date(now.getTime() + 15 * 60_000);
  t.setUTCMinutes(0, 0, 0);
  return new Date(t.getTime() + 3_600_000).toISOString();
}
