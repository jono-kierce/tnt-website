import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 5 (2026) — scaffold, not yet live.
 *
 * The season goes live when the first S5 rows land in the CSV: flip
 * `currentSeason` to 5 in `src/config/site.ts` at that point (and add 5 to
 * `sealedVoteSeasons` if votes stay hidden until awards night). Until there
 * are rows, no /seasons/5/ page is generated and this config is inert.
 *
 * Fill `teams` as the draft settles — captain-first, draftee-second — and
 * `honours`/`finals` at season's end.
 */
const season5: SeasonConfig = {
  season: 5,
  year: 2026,

  teams: {},

  honours: [],
};

export default season5;
