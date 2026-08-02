/** One player's stat line in one match, after normalization. */
export interface StatRow {
  team: string;
  opponent: string;
  season: number;
  round: number;
  /** Canonical player name (aliases merged, "(Fill-in)" stripped). */
  player: string;
  slug: string;
  isFillIn: boolean;
  /** True for the SINGLES GAME sentinel — valid match data, not a real player. */
  isSingles: boolean;

  aces: number;
  unforcedErrors: number;
  forcedErrors: number;
  doubleFaults: number;
  winners: number;

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
  bog: boolean;
}

/** One side of one match (rows collapsed to the team result). */
export interface MatchSide {
  season: number;
  round: number;
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
