/** Finals stage, as written in the CSV's Round column. */
export type FinalsStage = 'QF' | 'SF' | 'F';

/** One set of a match, from one team's point of view. */
export interface SetScore {
  /** Games won by this row's team. */
  for: number;
  /** Games won by the opposition. */
  against: number;
  /**
   * Tiebreak points, when the set went to a breaker. Only ever set on the
   * losing side — 7-6(4) is `{for: 7, against: 6, tiebreakAgainst: 4}`.
   */
  tiebreakFor: number | null;
  tiebreakAgainst: number | null;
  won: boolean;
}

/**
 * One player's stat line in one match, after normalization.
 *
 * Every counting stat is nullable: a blank cell means "not recorded", which is
 * NOT the same as zero. Finals results are often scored before anyone writes
 * the stats down (and a scrape off an Instagram post might only yield winners
 * and unforced errors), so aggregates track their own denominators per stat
 * rather than assuming every game contributes to every total.
 */
export interface StatRow {
  team: string;
  opponent: string;
  season: number;
  /**
   * Sort key, not a label — finals sort after the home-and-away season.
   * Use `roundLabel` for display and `stage` to test for finals.
   */
  round: number;
  /** Finals stage, or null for a home-and-away round. */
  stage: FinalsStage | null;
  /** Display label: "5", "QF", "SF", "Final". */
  roundLabel: string;
  isFinals: boolean;
  /** Raw scoreline as written in the CSV, e.g. "6-4" or "4-6 7-6(4) 6-1". */
  score: string;
  /** The scoreline parsed out, set by set, from this team's point of view. */
  setScores: SetScore[];
  /**
   * Sets played in this match. One for every home-and-away round and for the
   * qualifying finals; two or three for semis and the final. This is the
   * denominator for every per-set rate, so a three-set final doesn't inflate a
   * player's numbers against a one-set Tuesday night.
   */
  sets: number;
  setsWon: number;
  setsLost: number;
  /** Canonical player name (aliases merged, "(Fill-in)" stripped). */
  player: string;
  slug: string;
  isFillIn: boolean;
  /** True for the SINGLES GAME sentinel — valid match data, not a real player. */
  isSingles: boolean;
  /**
   * A fixture: a match that has been drawn but not played. Entered as four rows
   * sharing Team/Opponent/Season/Round with the two players a side, and EVERY
   * other column blank.
   *
   * The discriminator is a blank `win?`, and nothing else. It works because a
   * played row always carries one — even a finals result reconstructed from a
   * scoreline with no player stats says who won. `win` itself can't be the test:
   * blank and FALSE both read as `false` by the time it's a boolean.
   *
   * A fixture has no result to count, so it stays out of every total (see
   * `playedRows` in stats.ts). When the night's stats and a `win?` are typed in,
   * the row becomes an ordinary played row with no other change anywhere.
   */
  scheduled: boolean;

  aces: number | null;
  unforcedErrors: number | null;
  forcedErrors: number | null;
  doubleFaults: number | null;
  winners: number | null;

  /** Season 1 only; null otherwise. */
  firstServeIn: number | null;
  firstServeOut: number | null;
  /** Season 2 onward only; null for Season 1. */
  errorsForced: number | null;

  win: boolean;
  teamScore: number;
  opponentScore: number;

  /** null when the vote is blank (sealed season or simply unrecorded). */
  votes: number | null;
  /**
   * `votes` on the modern two-voter 3-2-1 scale: an S1 home-and-away vote is
   * mapped 2 -> 6, 1 -> 4 (see SITE.voteEraMap); every other row keeps its
   * value. Cross-era windows (career totals, the all-time boards) count this;
   * single-season windows, the MVP tally and BOG use `votes` as cast.
   */
  adjustedVotes: number | null;
  bog: boolean;
}

/** One side of one match (rows collapsed to the team result). Played only. */
export interface MatchSide {
  season: number;
  round: number;
  stage: FinalsStage | null;
  roundLabel: string;
  score: string;
  setScores: SetScore[];
  sets: number;
  team: string;
  opponent: string;
  teamScore: number;
  opponentScore: number;
  win: boolean;
}

export interface LadderRow {
  team: string;
  pairingName: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  gamesFor: number;
  gamesAgainst: number;
  /** gamesFor / gamesAgainst, e.g. 1.67. Infinity guarded to gamesFor. */
  ratio: number;
  rank: number;
}
