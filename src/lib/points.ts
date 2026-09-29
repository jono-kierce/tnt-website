import type { StatRow } from './types.ts';
import { seasonMatches, type MatchRecord, type StatScope, inScope } from './stats.ts';

/**
 * POINTS IN A MATCH — rebuilt from the box score.
 *
 * Every point ends in exactly one of: a winner, an ace, an unforced error, a
 * double fault, or a forced error. The first four are recorded once, on the
 * player who hit them, so they simply sum. A forced error is recorded TWICE —
 * as `errorsForced` on the player who forced it and as `forcedErrors` on the
 * player who missed — so summing both would count the point twice.
 *
 * For each direction (A forcing B, B forcing A) we therefore take the two
 * ledgers separately — A's errors forced, B's forced errors — and keep the
 * MAX. They should agree; about a third of team-directions don't, because a
 * scorer missed one side of the ledger, and the larger figure is the one that
 * lost nothing. Season 1 never recorded `errorsForced`, so there the
 * forced-error ledger alone carries the count.
 *
 * Nothing here is stored: it's derived from the CSV like everything else.
 */

/** One side of a match, as points won. */
export interface SidePoints {
  team: string;
  /**
   * Points this side won: its own winners and aces, the opposition's unforced
   * errors and double faults, and the errors this side forced.
   */
  won: number;
  winners: number;
  aces: number;
  opponentUnforcedErrors: number;
  opponentDoubleFaults: number;
  /** Errors this side forced — the MAX of the two ledgers below. */
  forced: number;
  /**
   * The two records of the same points: this side's `errorsForced` and the
   * opposition's `forcedErrors`. null when that ledger wasn't kept (S1 has no
   * `errorsForced`). Unequal means a scorer missed some on one side.
   */
  ledger: { errorsForced: number | null; forcedErrors: number | null };
}

/** A whole match, counted in points. */
export interface MatchPoints {
  match: MatchRecord;
  /** Same order as `match.sides` (alphabetical by team). */
  sides: [SidePoints, SidePoints];
  /** Total points played. `sides[0].won + sides[1].won`. */
  total: number;
  /** Games played, off the scoreline — a tiebreak set counts its breaker as one game. */
  games: number;
  pointsPerGame: number;
  /** Share of the points won by the match winner. Null when nobody won. */
  winnerShare: number | null;
}

/** One player's part in a match's points. */
export interface PlayerPoints {
  player: string;
  team: string;
  isFillIn: boolean;
  row: StatRow;
  /** Points ended in this player's favour: winners + aces + errors forced. */
  won: number;
  /** Points ended against this player: unforced errors + double faults + forced errors. */
  lost: number;
  /**
   * Every point-ending shot this player was party to (`won + lost`). A forced
   * error counts for both the player who forced it and the one who missed, so
   * the four players' involvement sums to more than the match's points.
   */
  involvement: number;
  /**
   * This player's share of their pair's involvement — 0.5 is an even split.
   * The "ball heavy" number: comparing partners within a match means both
   * sides of the ratio were scored by the same sheet, in the same era.
   */
  pairShare: number;
  /** Involvement as a share of the match's total points. */
  matchShare: number;
}

const COUNTED = ['winners', 'aces', 'unforcedErrors', 'doubleFaults'] as const;
type Ledger = 'errorsForced' | 'forcedErrors';

const sum = (rows: StatRow[], f: (r: StatRow) => number | null) =>
  rows.reduce((t, r) => t + (f(r) ?? 0), 0);

/** A ledger's total for one side, or null if nobody on it was recorded. */
function ledgerTotal(rows: StatRow[], stat: Ledger): number | null {
  return rows.some((r) => r[stat] != null) ? sum(rows, (r) => r[stat]) : null;
}

/**
 * Whether a match's stats are good enough to count points from. Anything less
 * and the total is an undercount that reads as a short match, so it's refused
 * rather than guessed at (blank is never 0 — see normalize.ts).
 *
 * - winners, aces, UEs and double faults on every row (S2 has four matches
 *   with no double faults recorded; finals are often scorelines only);
 * - each forced-error ledger either on every row or on none — a stat kept for
 *   one partner and not the other would skew the pair split;
 * - and at least one ledger per direction, so forced points are countable.
 */
function countable(m: MatchRecord): boolean {
  const rows = m.sides.flatMap((s) => s.players);
  if (rows.length < 2 || m.sides.some((s) => !s.players.length)) return false;
  if (!rows.every((r) => COUNTED.every((k) => r[k] != null))) return false;
  for (const k of ['errorsForced', 'forcedErrors'] as const) {
    const n = rows.filter((r) => r[k] != null).length;
    if (n !== 0 && n !== rows.length) return false;
  }
  return rows.some((r) => r.errorsForced != null) || rows.some((r) => r.forcedErrors != null);
}

/**
 * Count a match in points. Null for a fixture, the SINGLES GAME sentinel, and
 * any match whose stats don't pass `countable`.
 */
export function matchPoints(m: MatchRecord): MatchPoints | null {
  if (m.scheduled || m.isSingles || !countable(m)) return null;

  const side = (i: 0 | 1): SidePoints => {
    const own = m.sides[i].players;
    const opp = m.sides[1 - i].players;
    const ledger = {
      errorsForced: ledgerTotal(own, 'errorsForced'),
      forcedErrors: ledgerTotal(opp, 'forcedErrors'),
    };
    const forced = Math.max(ledger.errorsForced ?? 0, ledger.forcedErrors ?? 0);
    const winners = sum(own, (r) => r.winners);
    const aces = sum(own, (r) => r.aces);
    const opponentUnforcedErrors = sum(opp, (r) => r.unforcedErrors);
    const opponentDoubleFaults = sum(opp, (r) => r.doubleFaults);
    return {
      team: m.sides[i].team,
      won: winners + aces + opponentUnforcedErrors + opponentDoubleFaults + forced,
      winners,
      aces,
      opponentUnforcedErrors,
      opponentDoubleFaults,
      forced,
      ledger,
    };
  };

  const sides: [SidePoints, SidePoints] = [side(0), side(1)];
  const total = sides[0].won + sides[1].won;
  const games = m.sides[0].setScores.reduce((t, s) => t + s.for + s.against, 0);
  const winning = sides.find((s) => s.team === m.winner);
  return {
    match: m,
    sides,
    total,
    games,
    pointsPerGame: games ? total / games : 0,
    winnerShare: winning && total ? winning.won / total : null,
  };
}

/** Each player's part in a counted match, in `match.sides` order. */
export function playerPoints(mp: MatchPoints): PlayerPoints[] {
  return mp.match.sides.flatMap((side) => {
    const lines = side.players.map((r) => {
      const won = (r.winners ?? 0) + (r.aces ?? 0) + (r.errorsForced ?? 0);
      const lost = (r.unforcedErrors ?? 0) + (r.doubleFaults ?? 0) + (r.forcedErrors ?? 0);
      return { r, won, lost, involvement: won + lost };
    });
    const pair = lines.reduce((t, l) => t + l.involvement, 0);
    return lines.map(({ r, won, lost, involvement }) => ({
      player: r.player,
      team: side.team,
      isFillIn: r.isFillIn,
      row: r,
      won,
      lost,
      involvement,
      pairShare: pair ? involvement / pair : 0.5,
      matchShare: mp.total ? involvement / mp.total : 0,
    }));
  });
}

export interface PointsOptions {
  season?: number;
  /** Default 'all' — finals included; per-point numbers don't care how many sets. */
  scope?: StatScope;
}

/** Every countable played match, in playing order. */
export function allMatchPoints(rows: StatRow[], opts: PointsOptions = {}): MatchPoints[] {
  const { season, scope = 'all' } = opts;
  return seasonMatches(rows, season)
    .filter((m) => !m.scheduled && inScope(m.sides[0].players[0], scope))
    .map(matchPoints)
    .filter((mp): mp is MatchPoints => mp !== null);
}

/** A team's points across a season. */
export interface TeamPoints {
  team: string;
  /** Countable matches — see `matchPoints`. */
  matches: number;
  won: number;
  lost: number;
  /** won / (won + lost). */
  share: number;
}

/**
 * Every team's points won and lost in one season, best share first. Defaults to
 * the home-and-away scope, the same window as the ladder it gets compared with.
 * A team with no countable match is left out rather than printed at 0%.
 */
export function teamPoints(
  rows: StatRow[],
  season: number,
  opts: { scope?: StatScope } = {}
): TeamPoints[] {
  const acc = new Map<string, { matches: number; won: number; lost: number }>();
  for (const mp of allMatchPoints(rows, { season, scope: opts.scope ?? 'regular' })) {
    mp.sides.forEach((side, i) => {
      const a = acc.get(side.team) ?? { matches: 0, won: 0, lost: 0 };
      a.matches++;
      a.won += side.won;
      a.lost += mp.sides[1 - i].won;
      acc.set(side.team, a);
    });
  }
  return [...acc]
    .map(([team, a]) => ({ team, ...a, share: a.won / (a.won + a.lost) }))
    .sort((x, y) => y.share - x.share || x.team.localeCompare(y.team));
}

/** How two partners split their shots, over the matches they played together. */
export interface PairSplit {
  players: [string, string];
  /** Countable matches the two played on the same side. */
  matches: number;
  /**
   * Each player's mean `pairShare` across those matches — a per-match average,
   * so one long three-set night can't outweigh a season of Tuesdays. Sums to 1.
   */
  shares: [number, number];
}

/**
 * How `a` and `b` split their point-ending shots when they played together.
 * Null when they never shared a countable match. A night one of them spent
 * filling in beside the other still counts: they were on court as a pair.
 */
export function pairSplit(
  rows: StatRow[],
  a: string,
  b: string,
  opts: PointsOptions = {}
): PairSplit | null {
  let matches = 0;
  let shareA = 0;
  for (const mp of allMatchPoints(rows, opts)) {
    const lines = playerPoints(mp);
    const pa = lines.find((p) => p.player === a);
    const pb = lines.find((p) => p.player === b);
    if (!pa || !pb || pa.team !== pb.team) continue;
    matches++;
    shareA += pa.pairShare;
  }
  if (!matches) return null;
  return { players: [a, b], matches, shares: [shareA / matches, 1 - shareA / matches] };
}

/** A player's points profile across a window. */
export interface PlayerPointsAgg {
  player: string;
  /** Countable matches in the window. */
  matches: number;
  /** Mean share of their pair's involvement — above 0.5 means ball heavy. */
  pairShare: number;
  /** Point-ending shots per match. */
  involvementPerMatch: number;
  /** Points won off their racquet, less points lost off it, per match. */
  netPerMatch: number;
  /**
   * On-court points: every point played while this player was on court, won
   * or lost by their side — their own and their partner's winners, aces and
   * forced errors, plus the opposition's errors and double faults. Pooled
   * across the window, so a long match counts for its length.
   */
  pointsWon: number;
  pointsLost: number;
  /** pointsWon / (pointsWon + pointsLost) — the on-court points win %. */
  onCourtShare: number;
  /** Matches won out of `matches`, the same countable set, for comparison. */
  wins: number;
}

/**
 * Per-player points profiles. Fill-in matches are left out unless asked for,
 * matching the leaderboards' default.
 */
export function playerPointsAgg(
  rows: StatRow[],
  opts: PointsOptions & { includeFillIns?: boolean; minMatches?: number } = {}
): PlayerPointsAgg[] {
  const { includeFillIns = false, minMatches = 1 } = opts;
  const acc = new Map<
    string,
    { n: number; share: number; inv: number; net: number; won: number; lost: number; wins: number }
  >();
  for (const mp of allMatchPoints(rows, opts)) {
    for (const p of playerPoints(mp)) {
      if (p.row.isSingles || (p.isFillIn && !includeFillIns)) continue;
      const side = mp.sides.find((s) => s.team === p.team)!;
      const a =
        acc.get(p.player) ?? { n: 0, share: 0, inv: 0, net: 0, won: 0, lost: 0, wins: 0 };
      a.n++;
      a.share += p.pairShare;
      a.inv += p.involvement;
      a.net += p.won - p.lost;
      a.won += side.won;
      a.lost += mp.total - side.won;
      if (mp.match.winner === p.team) a.wins++;
      acc.set(p.player, a);
    }
  }
  return [...acc]
    .filter(([, a]) => a.n >= minMatches)
    .map(([player, a]) => ({
      player,
      matches: a.n,
      pairShare: a.share / a.n,
      involvementPerMatch: a.inv / a.n,
      netPerMatch: a.net / a.n,
      pointsWon: a.won,
      pointsLost: a.lost,
      onCourtShare: a.won + a.lost ? a.won / (a.won + a.lost) : 0,
      wins: a.wins,
    }));
}

/** A match's place in the length table. */
export interface RankedMatchPoints extends MatchPoints {
  /** 1 = the most points. Ties share a rank (1, 1, 3). */
  rank: number;
}

/**
 * Every countable match ranked by points played, longest first; ties share a
 * rank and keep playing order. Home and away by default: a final runs to three
 * sets, so ranking one beside a one-set Tuesday measures the format, not the
 * night. Pass `scope: 'all'` to rank them anyway.
 */
export function longestMatches(rows: StatRow[], opts: PointsOptions = {}): RankedMatchPoints[] {
  const sorted = allMatchPoints(rows, { ...opts, scope: opts.scope ?? 'regular' }).sort(
    (a, b) => b.total - a.total
  );
  return sorted.map((mp) => ({ ...mp, rank: 1 + sorted.filter((o) => o.total > mp.total).length }));
}
