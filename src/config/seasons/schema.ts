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
  /**
   * Optional recorded result. Each score array is that side's games per set, in
   * order — one entry for a single-set tie, up to three for a first-to-two tie.
   * A set decided by a tiebreak puts the *loser's* tiebreak points in
   * parentheses on the loser's side, tennis-style: 7-6(4) is
   * `homeScore: ['7'], awayScore: ['6(4)']`.
   */
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
  /**
   * Match length for this round, shown under the round heading. TNT plays the
   * qualifying round over one set and the semis + final as first to two sets.
   */
  format?: string;
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
  /**
   * The pair as it was drafted, when that is no longer `pair`.
   *
   * `pair` is the present tense — it labels the ladder row and the team's
   * fixtures, so it has to follow a mid-season change. The draft board is the
   * past tense: it reports one night in August and must not be retconned when
   * somebody moves. Only a team whose line-up changed needs this; everyone
   * else's draft is their `pair`, which is what the board falls back to.
   */
  drafted?: string[];
  /** Team captain (not in the CSV). */
  captain?: string;
  /**
   * The team pulled out mid-season and plays no further rounds.
   *
   * The rows it did play stand: its opponents keep the results they earned and
   * its players keep those matches on their career pages. What changes is the
   * season's *field* — a withdrawn team drops off the ladder, and it is not on
   * a bye for the rounds it isn't drawn in, because it isn't resting, it's
   * gone. It keeps its entry here, and its place in `draftOrder`, so the
   * rounds it did play still print a pairing label instead of a bare colour.
   */
  withdrawn?: boolean;
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
  /**
   * Team colours in draft order — the captain with the number one pick first.
   * The CSV can't know this, and `teams` above can't carry it either: its key
   * order is incidental, and something that only reads right by accident is a
   * thing that silently stops reading right.
   *
   * Only the draft graphic uses it. Omit it and there's no draft graphic;
   * nothing else on the site or in the renderer cares.
   */
  draftOrder?: string[];
}

/**
 * Teams that pulled out mid-season — see `TeamConfig.withdrawn`.
 *
 * This is carried separately from the declared field rather than subtracted
 * out of it, because subtracting doesn't work: `ladder` and `seasonRounds`
 * both build their field by *unioning* the declared teams with whoever turns
 * up in the CSV, so a team that played four rounds walks straight back in
 * however the config is edited. The only way to drop one is to name it.
 */
export function withdrawnTeams(cfg: SeasonConfig | undefined): string[] {
  return Object.entries(cfg?.teams ?? {})
    .filter(([, team]) => team.withdrawn)
    .map(([colour]) => colour);
}

/**
 * How many teams the season's bracket takes — the highest seed it names.
 *
 * The finals cutoff is a fact about the bracket, and the bracket is right here.
 * `insights.ts` used to hardcode 8, which has been correct every season so far
 * (S1–S4 took 8 of 9, S5 takes 8 of 10) and was correct by luck: nothing tied
 * the number to the config, so the first season with a different bracket would
 * have quietly kept talking about "the eight".
 *
 * Undefined for a season with no bracket declared — the caller then has no
 * business claiming anything about a cutoff.
 */
export function finalsBerths(cfg: SeasonConfig | undefined): number | undefined {
  const seeds = (cfg?.finals ?? [])
    .flatMap((round) => round.matches)
    .flatMap((m) => [m.home, m.away])
    .filter((slot): slot is { seed: number } => 'seed' in slot)
    .map((slot) => slot.seed);
  return seeds.length ? Math.max(...seeds) : undefined;
}
