/**
 * Player name normalization.
 *
 * The CSV records some players under more than one name. Add any new variant
 * here as `'Variant As Typed': 'Canonical Name'`. Canonicalisation runs AFTER
 * the `(Fill-in)` suffix is stripped, so map the plain name (no suffix).
 *
 * Extending for a new season: if a player shows up under a new spelling, add a
 * single line here — no other code changes required.
 */
export const NAME_ALIASES: Record<string, string> = {
  'Lachie Jenkin': 'Lachlan Jenkin',
  'James Papa': 'Jim Papa',
};

/** Rows whose Player is this sentinel are real match data but not a real player. */
export const SINGLES_PLAYER = 'SINGLES GAME';

/** Strip the "(Fill-in)" marker and surrounding whitespace. */
export function stripFillIn(raw: string): { name: string; isFillIn: boolean } {
  const isFillIn = /\(fill-?in\)/i.test(raw);
  const name = raw.replace(/\(fill-?in\)/i, '').replace(/\s+/g, ' ').trim();
  return { name, isFillIn };
}

/** Apply the alias map to a stripped name. */
export function canonicalName(strippedName: string): string {
  return NAME_ALIASES[strippedName] ?? strippedName;
}

/** Lowercase, hyphenated, URL-safe. The one slug rule the site has. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** URL/file slug for a canonical name, e.g. "Lachlan Jenkin" -> "lachlan-jenkin". */
export function playerSlug(canonical: string): string {
  return slugify(canonical);
}

/** URL slug for a team colour, e.g. "Light Blue" -> "light-blue". */
export function teamSlug(team: string): string {
  return slugify(team);
}

/** Broadcast-style short name: "Angus Hume" -> "A. Hume". */
export function shortName(canonical: string): string {
  const parts = canonical.split(' ').filter(Boolean);
  if (parts.length < 2) return canonical;
  const surname = parts.slice(1).join(' ');
  return `${parts[0][0]}. ${surname}`;
}
