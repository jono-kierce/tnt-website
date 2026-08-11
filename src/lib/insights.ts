/**
 * Match insights — the things worth saying about a fixture before it's played.
 *
 * Each detector is a small pure function that either finds something or
 * returns null, and `matchInsights` collects whatever fired. **Silence is a
 * valid answer.** Most Tuesday nights are just a Tuesday night, and a panel
 * that manufactures a talking point for every match teaches people to ignore
 * it. Nothing here is required to produce output.
 *
 * The rule that keeps them honest: a detector only ever sees matches played
 * STRICTLY BEFORE the one being described. That's what makes an insight on a
 * 2023 match read as the preview it would have been, rather than hindsight
 * dressed up as foresight — and it's the same discipline the prediction model
 * follows in `predict.ts`.
 *
 * Everything is derived from `stats.ts`. No detector counts a row itself.
 */

import type { StatRow } from './types.ts';
import {
  ladder,
  seasonMatches,
  type MatchLineup,
  type MatchRecord,
} from './stats.ts';
import { shortName } from '../config/aliases.ts';

export type InsightKind =
  | 'streak'
  | 'form'
  | 'h2h'
  | 'revenge'
  | 'first-meeting'
  | 'milestone'
  | 'stakes';

export interface Insight {
  kind: InsightKind;
  /** Two or three words, for a chip: "Revenge match". */
  label: string;
  /** One sentence. The whole insight. */
  detail: string;
  /** The team it's about, when it's about one — for colour. */
  team?: string;
  /**
   * Ordering only. Higher goes first, on the rough principle that a fact about
   * this match beats a fact about a player's career.
   */
  weight: number;
}

/** Everything a detector is allowed to look at. */
export interface InsightContext {
  match: MatchRecord;
  /** Every match played strictly before this one, in playing order. */
  history: MatchRecord[];
  /** Rows for those matches — the same window, per player. */
  historyRows: StatRow[];
  /** All rows, for a detector that needs the season's declared field. */
  allRows: StatRow[];
  declaredTeams?: string[];
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/** Sort key for "before": season, then round (finals sort last), then teams. */
const order = (m: { season: number; round: number; key: string }) =>
  [m.season, m.round, m.key] as const;

const isBefore = (a: MatchRecord, b: MatchRecord): boolean => {
  const [as, ar, ak] = order(a);
  const [bs, br, bk] = order(b);
  return as !== bs ? as < bs : ar !== br ? ar < br : ak < bk;
};

/**
 * Build the context for one match: everything played before it, and nothing
 * else. A scheduled fixture sees the whole history; a match from 2022 sees
 * only what came before it.
 */
export function insightContext(
  match: MatchRecord,
  allRows: StatRow[],
  declaredTeams?: string[]
): InsightContext {
  const history = seasonMatches(allRows)
    .filter((m) => !m.scheduled && isBefore(m, match))
    .sort((a, b) => a.season - b.season || a.round - b.round || a.key.localeCompare(b.key));
  const historyRows = history.flatMap((m) => m.sides.flatMap((s) => s.players));
  return { match, history, historyRows, allRows, declaredTeams };
}

// ---------------------------------------------------------------------------
// Small helpers shared by the detectors
// ---------------------------------------------------------------------------

const realPlayers = (side: MatchLineup): StatRow[] =>
  side.players.filter((p) => !p.isSingles);

const names = (side: MatchLineup): string[] =>
  realPlayers(side).map((p) => p.player);

const pairLabel = (side: MatchLineup): string =>
  names(side).map(shortName).join(' & ');

/** A player's matches in the window, oldest first. */
function playerHistory(ctx: InsightContext, player: string): StatRow[] {
  return ctx.historyRows.filter((r) => !r.isSingles && r.player === player);
}

/** Did these two teams meet in this match of the window? */
const involves = (m: MatchRecord, a: string, b: string): boolean => {
  const teams = m.sides.map((s) => s.team);
  return teams.includes(a) && teams.includes(b);
};

/** The exact same two players, in any order. */
const samePair = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/** A player carrying a run of three or more wins into the match. */
export function winStreakInsight(ctx: InsightContext): Insight | null {
  const MIN = 3;
  let best: { player: string; team: string; streak: number } | null = null;

  for (const side of ctx.match.sides) {
    for (const player of names(side)) {
      const past = playerHistory(ctx, player);
      let streak = 0;
      for (let i = past.length - 1; i >= 0; i--) {
        if (!past[i].win) break;
        streak++;
      }
      if (streak >= MIN && (!best || streak > best.streak)) {
        best = { player, team: side.team, streak };
      }
    }
  }
  if (!best) return null;
  return {
    kind: 'streak',
    label: 'On a run',
    detail: `${best.player} arrives on ${best.streak} straight wins.`,
    team: best.team,
    weight: 60 + best.streak,
  };
}

/**
 * A player whose recent nights are clearly better than their own career norm.
 *
 * Measured per set on the contribution ledger the rating model uses — winners,
 * aces and errors forced, less unforced errors and double faults — so "form"
 * means the same thing here as it does there. Needs a real career to compare
 * against and a real run to compare with, or it says nothing.
 */
export function formInsight(ctx: InsightContext): Insight | null {
  const RECENT = 4;
  const MIN_CAREER = 10;
  // Per set, on the net ledger. Set where it is because a smaller lift is
  // within the week-to-week noise of a social league: at 1.5 this fired on
  // more than half of all matches, which is not what "in form" should mean.
  const MIN_LIFT = 3;

  const net = (r: StatRow): number | null => {
    if (r.winners === null && r.unforcedErrors === null) return null;
    return (
      (r.winners ?? 0) +
      (r.aces ?? 0) +
      (r.errorsForced ?? 0) -
      ((r.unforcedErrors ?? 0) + (r.doubleFaults ?? 0))
    );
  };
  const perSet = (rows: StatRow[]): number | null => {
    const statted = rows.filter((r) => net(r) !== null);
    if (!statted.length) return null;
    const sets = statted.reduce((n, r) => n + r.sets, 0);
    return sets ? statted.reduce((n, r) => n + net(r)!, 0) / sets : null;
  };

  let best: { player: string; team: string; lift: number; recent: number } | null = null;

  for (const side of ctx.match.sides) {
    for (const player of names(side)) {
      const past = playerHistory(ctx, player);
      if (past.length < MIN_CAREER) continue;
      const career = perSet(past);
      const recent = perSet(past.slice(-RECENT));
      if (career === null || recent === null) continue;
      const lift = recent - career;
      if (lift >= MIN_LIFT && (!best || lift > best.lift)) {
        best = { player, team: side.team, lift, recent };
      }
    }
  }
  if (!best) return null;
  return {
    kind: 'form',
    label: 'In form',
    detail:
      `${best.player} has been well above his own career average over the ` +
      `last ${RECENT} matches — ${best.lift.toFixed(1)} more winners than errors per set.`,
    team: best.team,
    weight: 55,
  };
}

/** These exact two pairs have met before. */
export function pairH2HInsight(ctx: InsightContext): Insight | null {
  const [a, b] = ctx.match.sides;
  const ours = names(a);
  const theirs = names(b);
  if (ours.length < 2 || theirs.length < 2) return null;

  const meetings = ctx.history.filter((m) => {
    const [x, y] = m.sides;
    const xs = names(x);
    const ys = names(y);
    return (
      (samePair(xs, ours) && samePair(ys, theirs)) ||
      (samePair(xs, theirs) && samePair(ys, ours))
    );
  });
  if (!meetings.length) return null;

  let wins = 0;
  for (const m of meetings) {
    const won = m.sides.find((s) => samePair(names(s), ours));
    if (won && m.winner === won.team) wins++;
  }
  const losses = meetings.length - wins;
  if (wins === losses) {
    return {
      kind: 'h2h',
      label: 'Even history',
      detail:
        `These two pairings have met ${meetings.length} time${meetings.length === 1 ? '' : 's'} ` +
        `and there is nothing between them — ${wins} apiece.`,
      weight: 50,
    };
  }
  const leader = wins > losses ? a : b;
  return {
    kind: 'h2h',
    label: 'Familiar foes',
    detail:
      `${pairLabel(leader)} lead this exact pairing ${Math.max(wins, losses)}–` +
      `${Math.min(wins, losses)} from ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}.`,
    team: leader.team,
    weight: 52,
  };
}

/**
 * One side lost the last time these two teams met — **this season**.
 *
 * Deliberately not across seasons. Every team is redrafted every January, so
 * "Navy lost to Pink last season" is a fact about two sets of players who have
 * since been dispersed; it wears the colour of a grudge without being one. It
 * also fired on 78% of all matches when it looked back that far, and a label
 * that's nearly always true tells a reader nothing.
 */
export function revengeInsight(ctx: InsightContext): Insight | null {
  const [a, b] = ctx.match.sides;
  const previous = ctx.history.filter(
    (m) => m.season === ctx.match.season && involves(m, a.team, b.team)
  );
  if (!previous.length) return null;
  const last = previous[previous.length - 1];
  if (!last.winner) return null;

  const loser = last.sides.find((s) => s.team !== last.winner)!;
  const where = last.isFinals ? `in the ${last.roundLabel}` : `in round ${last.roundLabel}`;
  return {
    kind: 'revenge',
    label: 'Revenge',
    detail: `${loser.team} lost the last meeting ${where}, ${scoreFrom(last)}.`,
    team: loser.team,
    weight: 58,
  };
}

/**
 * The winner's scoreline, for a sentence. The scoreline lives on each side of
 * a `MatchRecord`, written from that side's point of view — there is no
 * match-level one, because the two sides read it in opposite directions.
 */
function scoreFrom(m: MatchRecord): string {
  const winner = m.sides.find((s) => s.team === m.winner);
  return winner?.score ? `${winner.score} to ${winner.team}` : 'score unrecorded';
}

/** These two teams have never played each other. */
export function firstMeetingInsight(ctx: InsightContext): Insight | null {
  const [a, b] = ctx.match.sides;
  if (ctx.history.some((m) => involves(m, a.team, b.team))) return null;
  // In the very first round on record everything is a first meeting, which is
  // true and not worth printing five times.
  if (ctx.history.length < 10) return null;
  return {
    kind: 'first-meeting',
    label: 'First meeting',
    detail: `${a.team} and ${b.team} have never played each other.`,
    weight: 45,
  };
}

/** Somebody is one match away from a round number. */
export function milestoneInsight(ctx: InsightContext): Insight | null {
  const MATCH_MARKS = [25, 50, 75, 100, 150, 200];
  const WINNER_MARKS = [100, 250, 500, 1000];

  const found: Insight[] = [];
  for (const side of ctx.match.sides) {
    for (const player of names(side)) {
      const past = playerHistory(ctx, player);
      const n = past.length + 1;
      if (MATCH_MARKS.includes(n)) {
        found.push({
          kind: 'milestone',
          label: 'Milestone',
          detail: `${player} plays his ${ordinal(n)} TNT match.`,
          team: side.team,
          weight: 70,
        });
      }
      const winners = past.reduce((sum, r) => sum + (r.winners ?? 0), 0);
      const next = WINNER_MARKS.find((m) => winners < m);
      if (next !== undefined && next - winners <= 5 && winners > 0) {
        found.push({
          kind: 'milestone',
          label: 'Milestone',
          detail: `${player} needs ${next - winners} more for ${next} career winners.`,
          team: side.team,
          weight: 65,
        });
      }
    }
  }
  return found.sort((a, b) => b.weight - a.weight)[0] ?? null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * What the match is worth on the ladder — "winner goes top", or a fight for
 * the finals cutoff.
 *
 * Home-and-away only, and only where there's a ladder to speak of: the ladder
 * is rebuilt from the window, so this is where the two teams stood going in.
 */
export function stakesInsight(ctx: InsightContext, finalsCutoff = 8): Insight | null {
  const { match } = ctx;
  if (match.isFinals || match.round <= 2) return null;

  const before = ctx.historyRows.filter((r) => r.season === match.season);
  if (!before.length) return null;
  const table = ladder(match.season, before, undefined, ctx.declaredTeams);
  if (table.length < 4) return null;

  const rows = match.sides
    .map((s) => table.find((t) => t.team === s.team))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (rows.length !== 2) return null;

  const [high, low] = [...rows].sort((a, b) => a.rank - b.rank);
  const leader = table[0];

  // Winner goes top: the better-placed side is first or second, and one win
  // separates them from the summit.
  if (high.rank <= 2 && high.wins + 1 > leader.wins) {
    return {
      kind: 'stakes',
      label: 'Top spot',
      detail: `${high.team} go top of the ladder with a win.`,
      team: high.team,
      weight: 75,
    };
  }
  // A scrap either side of the cutoff.
  if (high.rank <= finalsCutoff && low.rank > finalsCutoff && low.rank - high.rank <= 3) {
    return {
      kind: 'stakes',
      label: 'Finals race',
      detail:
        `${low.team} (${ordinal(low.rank)}) are chasing ${high.team} ` +
        `(${ordinal(high.rank)}) for a place in the eight.`,
      team: low.team,
      weight: 68,
    };
  }
  if (high.rank === low.rank - 1 && high.rank <= 4) {
    return {
      kind: 'stakes',
      label: 'Ladder scrap',
      detail: `${ordinal(high.rank)} plays ${ordinal(low.rank)} — the winner takes the higher rung.`,
      weight: 62,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

const DETECTORS = [
  stakesInsight,
  milestoneInsight,
  winStreakInsight,
  revengeInsight,
  formInsight,
  pairH2HInsight,
  firstMeetingInsight,
] as const;

/**
 * Everything worth saying about a match, best first — and an empty list when
 * there is nothing, which is the common case and entirely fine.
 *
 * `limit` caps how many reach a page. Three is plenty: past that they stop
 * being insights and start being a wall.
 */
export function matchInsights(ctx: InsightContext, limit = 3): Insight[] {
  const found: Insight[] = [];
  for (const detect of DETECTORS) {
    const insight = detect(ctx);
    if (insight) found.push(insight);
  }
  return found.sort((a, b) => b.weight - a.weight).slice(0, limit);
}

/** Convenience: build the window and run the detectors in one call. */
export function insightsFor(
  match: MatchRecord,
  allRows: StatRow[],
  declaredTeams?: string[],
  limit = 3
): Insight[] {
  return matchInsights(insightContext(match, allRows, declaredTeams), limit);
}
