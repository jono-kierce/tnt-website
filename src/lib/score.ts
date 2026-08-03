/**
 * Scoreline display helpers.
 *
 * The CSV writes a tiebreak the long way — `7-6(4)`, `6(3)-7` — which is the
 * clearest form to type but the widest to print: those three characters push a
 * set score past the column it lives in. Tennis has always set the breaker
 * points small and high instead, so that's what the site shows: `7-6⁴`.
 */

/** A run of scoreline text, optionally followed by tiebreak points. */
export type ScorePart = { text: string; tb: string | null };

/**
 * Split a scoreline into parts, lifting every `(n)` out as tiebreak points.
 * Works on a single set (`6(3)-7`) or a whole line (`4-6 7-6(4) 6-1`), and
 * leaves anything without brackets as one plain part.
 */
export function scoreParts(score: string): ScorePart[] {
  const parts: ScorePart[] = [];
  const re = /\((\d+)\)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(score)) !== null) {
    parts.push({ text: score.slice(at, m.index), tb: m[1] });
    at = m.index + m[0].length;
  }
  if (at < score.length || parts.length === 0) {
    parts.push({ text: score.slice(at), tb: null });
  }
  return parts;
}
