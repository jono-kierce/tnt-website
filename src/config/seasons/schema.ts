/**
 * Per-season configuration schema.
 *
 * Everything the CSV can't tell us about a season lives in one of these files:
 * the finals bracket structure, the honours (champions, MVP, etc.), team
 * captains, and any manual correction to the derived pairing. Adding Season 5
 * is: drop new CSV rows + create `season-5.ts` + (optionally) a recap markdown.
 * No other code changes.
 */

/** A finals matchup, referencing teams by seed or by the winner of an earlier tie. */
export interface FinalsMatch {
  /** Stable id used to reference the winner of this match, e.g. "QF1". */
  id: string;
  /** Human label, e.g. "Qualifying Final". */
  label?: string;
  /**
   * Each slot is either a seed number (1 = ladder winner) or a reference to the
   * winner/loser of an earlier match id, e.g. { winnerOf: 'QF1' }.
   */
  home: FinalsSlot;
  away: FinalsSlot;
  /** Optional recorded result. Scores are set strings, e.g. ["6-4", "7-6"]. */
  result?: {
    /** Team name (colour) that won, or seed if you prefer. */
    winner: 'home' | 'away';
    homeScore?: string[];
    awayScore?: string[];
  };
}

export type FinalsSlot =
  | { seed: number }
  | { winnerOf: string }
  | { loserOf: string };

export interface FinalsRound {
  /** e.g. "Qualifying Round", "Semi Finals", "Final". */
  name: string;
  matches: FinalsMatch[];
}

export interface Honour {
  title: string; // e.g. "Champions", "Season MVP", "Finals MVP"
  /** Team colour, if this honour belongs to a team. */
  team?: string;
  /** Free text — pairing name, player name, vote tally, etc. */
  detail: string;
}

export interface TeamConfig {
  /** Manual override of the derived pairing/roster label (optional). */
  pair?: string[];
  /** Team captain (not in the CSV). */
  captain?: string;
}

export interface SeasonConfig {
  season: number;
  year?: number;
  /** Finals bracket, rendered in seed order. Optional for in-progress seasons. */
  finals?: FinalsRound[];
  /** Champions / Runners-up / MVP / Finals MVP etc. */
  honours: Honour[];
  /** Per-team captain + optional pairing override, keyed by colour. */
  teams?: Record<string, TeamConfig>;
}
