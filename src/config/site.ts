/**
 * Site-wide configuration. The values here are DELIBERATELY not inferred from
 * the data — they encode editorial decisions (which season is live, which
 * season's votes are sealed) that the CSV can't tell us on its own.
 */

export interface TeamMeta {
  /** CSV team name (the colour). */
  name: string;
  /** Primary accent colour. */
  color: string;
  /** Secondary colour for gradients. */
  color2: string;
  /** Text colour that reads on top of `color`. */
  ink: string;
}

/** Ordered team palette. Matches the Instagram standings graphics. */
export const TEAMS: Record<string, TeamMeta> = {
  Pink: { name: 'Pink', color: '#ff2d9b', color2: '#e6007e', ink: '#0d0d0d' },
  Navy: { name: 'Navy', color: '#26346f', color2: '#161f45', ink: '#f5f5f0' },
  Orange: { name: 'Orange', color: '#f26522', color2: '#c74a10', ink: '#0d0d0d' },
  'Light Blue': { name: 'Light Blue', color: '#44b8e8', color2: '#2b8fc4', ink: '#0d0d0d' },
  Green: { name: 'Green', color: '#2fae5f', color2: '#1c7a40', ink: '#0d0d0d' },
  Black: { name: 'Black', color: '#8b8f99', color2: '#4a4e57', ink: '#0d0d0d' },
  Red: { name: 'Red', color: '#e23b3b', color2: '#b32020', ink: '#f5f5f0' },
  Yellow: { name: 'Yellow', color: '#eac53b', color2: '#c9a11c', ink: '#0d0d0d' },
  White: { name: 'White', color: '#e8e8e0', color2: '#b8b8ae', ink: '#0d0d0d' },
};

export function teamMeta(name: string): TeamMeta {
  return (
    TEAMS[name] ?? { name, color: '#8b8f99', color2: '#4a4e57', ink: '#0d0d0d' }
  );
}

export const SITE = {
  title: 'Tuesday Night Tennis',
  short: 'TNT',
  description:
    'Tuesday Night Tennis — a social doubles tennis league in Melbourne. Stats, ladders, records and honours across every season.',
  instagram: 'https://www.instagram.com/tuesday_night_tennis/',
  /** Root path when deployed to GitHub Pages. Set to '/<repo>' for project pages. */
  base: '/',

  /** The season currently being played. Drives the "current ladder" everywhere. */
  currentSeason: 4,

  /**
   * Seasons whose `votes` column is intentionally blank until awards night.
   * The site shows "votes sealed" instead of zeros for these. When you commit
   * the real votes, remove the season from this list.
   */
  sealedVoteSeasons: [],

  /** Map season number -> calendar year for labelling ("Season 4 (2025)"). */
  seasonYears: { 1: 2022, 2: 2023, 3: 2024, 4: 2025 } as Record<number, number>,

  /** Serve stats were only recorded in Season 1. */
  serveStatsSeason: 1,
  /** Errors Forced was recorded from this season onward. */
  errorsForcedFromSeason: 2,

  /** Minimum games for a player to qualify on per-game leaderboards. */
  perGameMinGames: 4,

  /**
   * Rank badges on the player stat panel.
   *
   * `rankMinMatches` is the bar for being ranked at all, in either mode: a
   * two-match cameo shouldn't be able to top a board, and a percentile drawn
   * off cameos means nothing for anyone else either. Players below it get no
   * badges and are left out of everyone else's field.
   *
   * `rankMinField` is the smallest field worth splitting into tiers — below
   * that a badge shows the bare rank with no colour.
   *
   * `rankTiers` are cumulative shares of the field, best-first: the top 10% are
   * elite, the top 35% above average, and so on to the bottom 10%.
   */
  rankMinMatches: 5,
  rankMinField: 6,
  rankTiers: { elite: 0.1, above: 0.35, average: 0.65, below: 0.9 },
  /** On a tiered board, ranks this good are shown as a number, not a tier. */
  rankPodium: 3,
  /** On the untiered totals boards, the only badge worth showing. */
  rankTopTotals: 5,

  /**
   * Best/worst-opponent tiles. Nobody in TNT has faced the same opponent more
   * than a handful of times, so the qualifying bar is adaptive: we use
   * `h2hPreferredMeetings` when the player has at least two opponents they've
   * met that often, otherwise we step down one meeting at a time to
   * `h2hMinMeetings`. Below that a "record" is noise, and the tiles are hidden.
   */
  h2hPreferredMeetings: 3,
  h2hMinMeetings: 2,

  /**
   * A player counts as a "core" member of a team in a season when their
   * non-fill-in games for that team reach this share of the team's matches.
   * Separates the regular pairing from one-off subs the CSV didn't flag.
   */
  coreMemberMinShare: 0.5,
};

export function seasonLabel(season: number): string {
  const year = SITE.seasonYears[season];
  return year ? `Season ${season} (${year})` : `Season ${season}`;
}

export function isVotesSealed(season: number): boolean {
  return SITE.sealedVoteSeasons.includes(season);
}
