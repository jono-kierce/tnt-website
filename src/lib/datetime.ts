/**
 * Formatting for the `Start` column — Melbourne wall time, stored as
 * `2026-08-18T18:30` (see StatRow.start).
 *
 * Everything here works on the string, character by character, and never
 * constructs a `Date` from it. That's deliberate: `new Date('2026-08-18T18:30')`
 * is parsed as *local* time by the JS spec, so the same CSV would render an hour
 * out on a build machine in another timezone — and this site is built by GitHub
 * Actions, which runs in UTC. A fixture list means the time on the sign at the
 * courts, so the safe thing is never to convert it at all.
 *
 * The one place a real `Date` is unavoidable is working out the weekday, which
 * takes a UTC-pinned copy so the arithmetic can't drift either.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `2026-08-18T18:30` -> `6:30pm`. Null in, null out. */
export function formatTime(start: string | null | undefined): string | null {
  if (!start) return null;
  const [h, m] = start.slice(11, 16).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

/** `2026-08-18` (or a full start) -> `Tue 18 Aug`. */
export function formatDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const [y, mo, d] = date.slice(0, 10).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const day = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${day} ${d} ${MONTHS[mo - 1]}`;
}

/** `Tue 18 Aug 2026` — for a heading that has to stand on its own. */
export function formatDateLong(date: string | null | undefined): string | null {
  const short = formatDate(date);
  return short && `${short} ${date!.slice(0, 4)}`;
}

/**
 * What a `<time datetime="…">` attribute should carry. The stored value is
 * already valid HTML datetime; this just makes the intent explicit at the call
 * site and keeps the null-handling in one place.
 */
export const datetimeAttr = (start: string | null | undefined) => start || undefined;
