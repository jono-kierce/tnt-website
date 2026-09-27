/**
 * Editorial lines for the streak story — the part of a match the CSV can't
 * hold. Keyed by `MatchRecord.key`, and printed under that match wherever the
 * story shows it. Every line here should be checkable against a season recap
 * in `content/seasons/`; nothing numeric belongs here, that's `stats.ts`'s job.
 */
export const STREAK_NOTES: Record<string, string> = {
  // content/seasons/season-3.md — the semi that ran over two nights.
  '3|101|Orange|Red':
    'Suspended under council lighting rules with six match points saved. It took Orange a second night to finish it.',
};
