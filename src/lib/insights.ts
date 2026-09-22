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
  | 'partnership'
  | 'dominance'
  | 'milestone'
  | 'stakes'
  // The other side of the ledger. This is a social league and the losing
  // streaks get more airtime at the bar than the winning ones, so the panel
  // says them out loud too. Same discipline as everything above: a number the
  // CSV can back, said flatly. See NEGATIVE_KINDS.
  | 'cold-streak'
  | 'drought'
  | 'basement'
  | 'hoodoo'
  | 'errors'
  | 'mock-milestone';

export interface Insight {
  kind: InsightKind;
  /** Two or three words, for a chip: "Basement battle". */
  label: string;
  /** One sentence. The whole insight. */
  detail: string;
  /** The team it's about, when it's about one — for colour. */
  team?: string;
  /**
   * The player it's about, when it's about one. Not for display — every
   * detector already puts the name in `detail`. It exists so `matchInsights`
   * can enforce `MAX_PER_PLAYER`: a panel of three lines should be three
   * stories about three people, not one man's evening reported three ways.
   * Left undefined by the detectors that talk about teams.
   */
  subject?: string;
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
  /**
   * Teams that pulled out mid-season, so the ladder these detectors read is
   * the one the site shows. Passed in for the same reason `declaredTeams` is
   * — see `finalsCutoff` below.
   */
  withdrawnTeams?: string[];
  /**
   * How many teams the season's finals bracket takes, from the season config
   * (`finalsBerths`). Passed in for the same reason `declaredTeams` is: this
   * file can't import the configs — they're auto-discovered with
   * `import.meta.glob`, which doesn't exist in the Node process that renders
   * the Instagram graphics. Undefined means no bracket is declared, and
   * `stakesInsight` then says nothing about a cutoff rather than guessing one.
   */
  finalsCutoff?: number;
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

/** What a caller knows about the season that the CSV can't tell this file. */
export interface InsightOptions {
  /** The season's declared field — see `InsightContext.declaredTeams`. */
  declaredTeams?: string[];
  /** Teams that pulled out — see `InsightContext.withdrawnTeams`. */
  withdrawnTeams?: string[];
  /** How many teams the bracket takes — see `InsightContext.finalsCutoff`. */
  finalsCutoff?: number;
}

/**
 * Build the context for one match: everything played before it, and nothing
 * else. A scheduled fixture sees the whole history; a match from 2022 sees
 * only what came before it.
 */
export function insightContext(
  match: MatchRecord,
  allRows: StatRow[],
  opts: InsightOptions = {}
): InsightContext {
  const history = seasonMatches(allRows)
    .filter((m) => !m.scheduled && isBefore(m, match))
    .sort((a, b) => a.season - b.season || a.round - b.round || a.key.localeCompare(b.key));
  const historyRows = history.flatMap((m) => m.sides.flatMap((s) => s.players));
  return {
    match,
    history,
    historyRows,
    allRows,
    declaredTeams: opts.declaredTeams,
    withdrawnTeams: opts.withdrawnTeams,
    finalsCutoff: opts.finalsCutoff,
  };
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

/** This season's home-and-away matches for a team in the window, oldest first. */
function seasonTeamMatches(ctx: InsightContext, team: string): MatchRecord[] {
  return ctx.history.filter(
    (m) =>
      m.season === ctx.match.season &&
      !m.isFinals &&
      m.sides.some((s) => s.team === team)
  );
}

/** A match this team lost. A draw is not a loss. */
const lostBy = (m: MatchRecord, team: string): boolean =>
  m.winner !== null && m.winner !== team;

/**
 * A counting stat per set over a set of rows, or null when nobody recorded it.
 * Blank cells are skipped rather than counted as zero — the same rule as
 * everywhere else, and the reason a partial finals entry can't drag a rate down.
 */
function statPerSet(rows: StatRow[], stat: 'unforcedErrors' | 'doubleFaults'): number | null {
  const statted = rows.filter((r) => r[stat] !== null);
  if (!statted.length) return null;
  const sets = statted.reduce((n, r) => n + r.sets, 0);
  return sets ? statted.reduce((n, r) => n + r[stat]!, 0) / sets : null;
}

/** A total over rows, blanks skipped. */
const statTotal = (rows: StatRow[], stat: 'unforcedErrors' | 'doubleFaults'): number =>
  rows.reduce((n, r) => n + (r[stat] ?? 0), 0);

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Is this match the next one up, rather than one somewhere off in the draw?
 *
 * The window rule — a detector sees only what was played strictly before —
 * has a blind spot at the far end of a season that has been drawn but not
 * played. Every unplayed fixture shares one window, because there is nothing
 * played between them, so a round 10 page in August was reporting a round 2
 * ladder: "White are 0-2 for the season" seven weeks early, and "Yellow go top
 * of the ladder with a win" off a table two rounds deep. True to the letter of
 * the window, and nonsense to read.
 *
 * So anything that speaks in the present tense about the season — the ladder,
 * a team's record, a season leaderboard — is gated on this. A played match
 * always passes (its own round is the latest one in its window, or one past
 * it), so no historical page changes; a fixture passes only while it is the
 * round about to be played. Career-window detectors are deliberately not
 * gated: "on 11 straight wins" is just as true in October.
 */
function isNextUp(ctx: InsightContext): boolean {
  const { match } = ctx;
  if (match.isFinals) return true;
  let latest = 0;
  for (const m of ctx.history) {
    if (m.season === match.season && !m.isFinals && m.round > latest) latest = m.round;
  }
  return match.round <= latest + 1;
}

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
    subject: best.player,
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
  //
  // It was 3 for a long time, which fired on 40% of all matches — over the
  // per-detector cap, and grandfathered past it on the grounds that retuning
  // it wasn't part of a change about banter. That excuse expired: by S5 it was
  // firing on two thirds of played matches and was the only line on half the
  // fixture list, which makes it the noise floor rather than an insight.
  // 4 brings it to 22%, inside the cap, and puts it on the same bar as
  // `errorFormInsight` — same ledger, same idea of what a real move is.
  const MIN_LIFT = 4;

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
    subject: best.player,
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
 * How the last meeting between these two teams went — **this season**, and
 * only ahead of a final.
 *
 * This was "Revenge match", and it was wrong twice over.
 *
 * It was wrong across seasons, which is what the season filter fixes: every
 * team is redrafted every January, so "Navy lost to Pink last season" is a
 * fact about two sets of players who have since been dispersed. It wears the
 * colour of a grudge without being one, and it fired on 78% of all matches
 * when it looked back that far.
 *
 * The season filter then made it *dead*, which took longer to notice because
 * the frequency test measures every detector against all matches and this one
 * read a respectable 13%. Measured against the matches it can actually reach,
 * it fired on **28 of 28 finals and 0 of 179 home-and-away matches**. Both
 * numbers have the same cause: every season on record is a single round-robin,
 * so two teams meet exactly once before the bracket — never again in the
 * home-and-away, and always at least once before a final.
 *
 * So it is a finals line, and it is one on every final. That's tolerable for
 * what it now is and wasn't for what it was: "Revenge" claims a story, and a
 * story that is always there is not a story. "Last meeting" claims a fact, the
 * same way a scoreline does, and at weight 50 it sits below anything with an
 * actual angle. If TNT ever runs a double round-robin, drop the `isFinals`
 * guard — the rest of this works unchanged.
 */
export function lastMeetingInsight(ctx: InsightContext): Insight | null {
  if (!ctx.match.isFinals) return null;
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
    kind: 'h2h',
    label: 'Last meeting',
    detail: `${loser.team} lost the last meeting ${where}, ${scoreFrom(last)}.`,
    team: loser.team,
    weight: 50,
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
          subject: player,
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
          subject: player,
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
export function stakesInsight(ctx: InsightContext): Insight | null {
  const { match } = ctx;
  if (match.isFinals || match.round <= 2) return null;
  if (!isNextUp(ctx)) return null;

  const before = ctx.historyRows.filter((r) => r.season === match.season);
  if (!before.length) return null;
  const table = ladder(
    match.season,
    before,
    undefined,
    ctx.declaredTeams,
    ctx.withdrawnTeams
  );
  if (table.length < 4) return null;

  const rows = match.sides
    .map((s) => table.find((t) => t.team === s.team))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (rows.length !== 2) return null;

  const [high, low] = [...rows].sort((a, b) => a.rank - b.rank);
  const leader = table[0];

  // Two unbeaten sides. The best version of "this one matters", and the one
  // the ladder branches below couldn't see: they read rank, and two teams both
  // winning everything are simply first and second, which on its own reads as
  // an ordinary top-of-the-table game. Needs both to have actually played --
  // `declaredTeams` seeds an unplayed team at 0/0/0, and a team that has had
  // two byes is not unbeaten, it is unstarted.
  if (rows.every((r) => r.matchesPlayed >= 2 && r.losses === 0 && r.wins === r.matchesPlayed)) {
    return {
      kind: 'stakes',
      label: 'Unbeaten clash',
      detail:
        `${high.team} (${high.wins}–0) and ${low.team} (${low.wins}–0) both ` +
        `arrive with a perfect record — one of them leaves without it.`,
      weight: 78,
    };
  }
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
  // A scrap either side of the cutoff. The cutoff comes from the season's own
  // bracket (`finalsBerths`), not from a hardcoded 8: that was right for every
  // season so far by luck rather than by wiring, and it named "the eight" in
  // the sentence too, so the first season with a different bracket would have
  // been wrong twice in one line. No bracket declared, no claim made.
  const cutoff = ctx.finalsCutoff;
  if (
    cutoff !== undefined &&
    high.rank <= cutoff &&
    low.rank > cutoff &&
    low.rank - high.rank <= 3
  ) {
    return {
      kind: 'stakes',
      label: 'Finals race',
      detail:
        `${low.team} (${ordinal(low.rank)}) are chasing ${high.team} ` +
        `(${ordinal(high.rank)}) for a place in the top ${cutoff}.`,
      team: low.team,
      weight: 68,
    };
  }
  // Adjacent rungs near the top only (top three): a 4th-v-5th "winner takes the
  // higher rung" is true of too many mid-table games to be worth saying, and
  // keeping it pushed `stakes` over the 30% per-detector cap once S5 results
  // landed. Top-spot and finals-race stories still carry the panel.
  if (high.rank === low.rank - 1 && high.rank <= 3) {
    return {
      kind: 'stakes',
      label: 'Ladder scrap',
      detail: `${ordinal(high.rank)} plays ${ordinal(low.rank)} — the winner takes the higher rung.`,
      weight: 62,
    };
  }
  return null;
}

/**
 * How the two men on one side of the net have gone as a pair.
 *
 * `pairH2HInsight` covers the pairing *across* the net; this is the one nobody
 * had, and in a doubles league the partnership is the thing people actually
 * argue about. Career window rather than season: the pair is the pair whatever
 * colour they're wearing, and a redraft that puts two old team-mates back
 * together is exactly the case worth mentioning.
 *
 * There is deliberately no "first time these two have partnered" variant. It
 * would be true of nearly every pairing in round one of every season — the
 * draft remakes ten of them at a stroke — which is the trap that killed the
 * old `firstMeetingInsight`. A record needs a real sample to be a record, so
 * the bar is four nights together, which is also what keeps this stingy.
 *
 * Nor is there a "won one of six" variant, tempting as it is. It would be an
 * unflattering line under a kind `NEGATIVE_KINDS` doesn't cover, so it would
 * slip past `MAX_NEGATIVE` and let two roasts onto one panel; giving it a kind
 * of its own would instead put a seventh detector in the queue for the single
 * negative slot, crowding out `drought` and `basement`, which say more. The
 * bad-pair joke is already told, better, by whichever of those fires.
 */
export function partnershipInsight(ctx: InsightContext): Insight | null {
  const MIN = 4;
  let best: { pair: string[]; team: string; wins: number; played: number } | null = null;

  for (const side of ctx.match.sides) {
    const pair = names(side);
    if (pair.length < 2) continue;

    const together = ctx.history.filter((m) =>
      m.sides.some((s) => pair.every((p) => names(s).includes(p)))
    );
    if (together.length < MIN) continue;

    const wins = together.filter((m) => {
      const theirs = m.sides.find((s) => pair.every((p) => names(s).includes(p)))!;
      return m.winner === theirs.team;
    }).length;

    // Only worth a line if it says something: a pair at 50% has no record,
    // it has a coin. Two thirds is the bar, and it is one-directional — see
    // the note above on why the losing half of this isn't here.
    const rate = wins / together.length;
    if (rate < 2 / 3) continue;
    // The better record of the two, when both sides qualify.
    if (best && rate <= best.wins / best.played) continue;
    best = { pair, team: side.team, wins, played: together.length };
  }
  if (!best) return null;

  const label = best.pair.map(shortName).join(' & ');
  return {
    kind: 'partnership',
    label: 'Proven pair',
    detail: `${label} have won ${best.wins} of their ${best.played} matches together.`,
    team: best.team,
    weight: 56,
  };
}

/**
 * A team taking games off people at a rate nobody else in the league is.
 *
 * The ladder has carried `gamesFor`/`gamesAgainst` since the beginning and
 * nothing here read them: every team-level detector went off wins and losses,
 * so a side winning 6-0 every week read exactly like one scraping 6-4. The
 * ratio is the stat that separates them, and it's the one the ladder itself
 * breaks ties on.
 *
 * Present tense about a live ladder, so it's gated like the rest — see
 * `isNextUp`. The margin requirement is what keeps it rare: leading the league
 * is common, leading it by a distance is not.
 */
export function dominanceInsight(ctx: InsightContext): Insight | null {
  const { match } = ctx;
  if (match.isFinals || match.round < 4) return null;
  if (!isNextUp(ctx)) return null;
  // How far clear of second the leader has to be before it's worth a line.
  const MARGIN = 1.15;
  const MIN_PLAYED = 3;

  const before = ctx.historyRows.filter((r) => r.season === match.season);
  if (!before.length) return null;
  const table = ladder(
    match.season,
    before,
    undefined,
    ctx.declaredTeams,
    ctx.withdrawnTeams
  );

  // `ratio` is already guarded against a nil `gamesAgainst` — the ladder falls
  // back to `gamesFor` — so a side that has conceded nothing sorts top rather
  // than being dropped for dividing by zero, which is the case this is for.
  const field = table
    .filter((r) => r.matchesPlayed >= MIN_PLAYED)
    .sort((a, b) => b.ratio - a.ratio);
  if (field.length < 4) return null;

  const [top, second] = field;
  if (top.ratio < second.ratio * MARGIN) return null;

  const side = match.sides.find((s) => s.team === top.team);
  if (!side) return null;
  return {
    kind: 'dominance',
    label: 'Steamrolling',
    detail:
      `${top.team} have won ${top.gamesFor} games to ${top.gamesAgainst} this ` +
      `season — comfortably the best return in the league.`,
    team: top.team,
    weight: 63,
  };
}

// ---------------------------------------------------------------------------
// Detectors — the other side of the ledger
// ---------------------------------------------------------------------------
//
// Everything below says something unflattering, which is the point: this is a
// social league and a night that went badly is the night people talk about.
// Three rules keep it the right side of funny:
//
//   1. **Deadpan.** The number does the work. No detector calls anybody
//      anything — it reports what happened and stops.
//   2. **A real bar.** Every threshold here was set against the whole CSV so
//      that it fires on a fifth of matches at most (there's a test). A roast
//      that lands every week is just weather.
//   3. **One per match.** `matchInsights` drops all but the top-weighted
//      negative, so nobody gets a three-line pile-on, and a genuine ladder
//      story still leads the panel.
//
// None of them read `votes` or BOG, deliberately: these lines go onto an
// Instagram preview card, and S5's votes are sealed.

/**
 * A player carrying a run of four or more losses into the match — **this
 * season**.
 *
 * Two differences from `winStreakInsight`, both of them tuning rather than
 * principle, which is worth saying plainly because the comment here used to
 * claim otherwise.
 *
 * The bar is one higher: three straight losses fires on 38% of all matches on
 * record and is just a fortnight of tennis, where four is 23% and is a slump.
 *
 * And the run has to be inside the current season, which is why this can't
 * fire before round five. The old reason given for that was the redraft — "a
 * fact about a team that no longer exists" — and it was borrowed from
 * `lastMeetingInsight`, where it is true, and wrong here: this is a *player's*
 * streak, and a redraft scatters his team-mates, not his own record. Angus
 * Hume's eleven straight wins span three seasons and `winStreakInsight` says
 * so. The real reason is the frequency, same as the bar above: unbounded, a
 * losing run reaches back far enough to catch somebody most weeks. The
 * asymmetry with win streaks is a choice about how often each line should
 * land, not a claim that the two facts are different in kind.
 */
export function lossStreakInsight(ctx: InsightContext): Insight | null {
  const MIN = 4;
  let worst: { player: string; team: string; streak: number } | null = null;

  for (const side of ctx.match.sides) {
    for (const player of names(side)) {
      const past = playerHistory(ctx, player).filter(
        (r) => r.season === ctx.match.season
      );
      let streak = 0;
      for (let i = past.length - 1; i >= 0; i--) {
        if (past[i].win) break;
        streak++;
      }
      if (streak >= MIN && (!worst || streak > worst.streak)) {
        worst = { player, team: side.team, streak };
      }
    }
  }
  if (!worst) return null;
  return {
    kind: 'cold-streak',
    label: 'Cold snap',
    detail: `${worst.player} arrives on ${worst.streak} straight losses.`,
    team: worst.team,
    subject: worst.player,
    weight: 54 + worst.streak,
  };
}

/**
 * A team still looking for its first win of the season, or one that has lost
 * its last three.
 *
 * Winless wins the tie: "0–4 for the season" already says everything "lost the
 * last three" would, and the two would otherwise print together. Home-and-away
 * only — a knockout bracket is not a form guide.
 */
export function droughtInsight(ctx: InsightContext): Insight | null {
  if (ctx.match.isFinals) return null;
  // "0-2 for the season" is a claim about now. See `isNextUp` — without this
  // it was being printed on a round 10 fixture in August.
  if (!isNextUp(ctx)) return null;
  const found: Insight[] = [];

  for (const side of ctx.match.sides) {
    const past = seasonTeamMatches(ctx, side.team);
    const lost = past.filter((m) => lostBy(m, side.team));

    if (past.length >= 2 && lost.length === past.length) {
      found.push({
        kind: 'drought',
        label: 'Still hunting',
        detail: `${side.team} are 0–${past.length} for the season and still chasing a first win.`,
        team: side.team,
        weight: 64,
      });
      continue;
    }
    // The whole run, not just the three that trip it — a team five deep in a
    // slide shouldn't read the same as one three deep, week after week.
    let run = 0;
    for (let i = past.length - 1; i >= 0; i--) {
      if (!lostBy(past[i], side.team)) break;
      run++;
    }
    if (run >= 3) {
      found.push({
        kind: 'drought',
        label: 'Slide',
        detail: `${side.team} have lost ${run} in a row.`,
        team: side.team,
        weight: 48,
      });
    }
  }
  return found.sort((a, b) => b.weight - a.weight)[0] ?? null;
}

/**
 * Both teams in the bottom three going in — the ladder story nobody puts on a
 * poster.
 *
 * Needs a table with something in it: from round four, in a field of at least
 * six, with both sides having actually played three times. That last condition
 * matters because `declaredTeams` seeds unplayed teams at 0/0/0, and a team
 * that has had two byes is not in the cellar, it's just early.
 */
export function basementInsight(ctx: InsightContext): Insight | null {
  const { match } = ctx;
  if (match.isFinals || match.round < 4) return null;
  if (!isNextUp(ctx)) return null;

  const before = ctx.historyRows.filter((r) => r.season === match.season);
  if (!before.length) return null;
  const table = ladder(
    match.season,
    before,
    undefined,
    ctx.declaredTeams,
    ctx.withdrawnTeams
  );
  if (table.length < 6) return null;

  const rows = match.sides
    .map((s) => table.find((t) => t.team === s.team))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (rows.length !== 2) return null;
  if (rows.some((r) => r.matchesPlayed < 3)) return null;
  if (!rows.every((r) => r.rank > table.length - 3)) return null;

  const [high, low] = [...rows].sort((a, b) => a.rank - b.rank);
  return {
    kind: 'basement',
    label: 'Basement battle',
    detail:
      `${high.team} (${ordinal(high.rank)}) and ${low.team} (${ordinal(low.rank)}) ` +
      `meet at the bottom of the ladder.`,
    weight: 66,
  };
}

/**
 * A player who has never beaten somebody standing across the net tonight.
 *
 * Three meetings minimum, and it has to be a clean sweep — 0–3 is a hoodoo,
 * 1–3 is a Tuesday. Player-against-player rather than team-against-team, which
 * is what survives the annual redraft: the colours change every January, the
 * bloke who keeps beating you does not.
 */
export function hoodooInsight(ctx: InsightContext): Insight | null {
  const MIN = 3;
  const [a, b] = ctx.match.sides;
  let worst: { loser: string; team: string; winner: string; meetings: number } | null = null;

  const meetingsOf = (p: string, q: string): MatchRecord[] =>
    ctx.history.filter((m) => {
      const [x, y] = m.sides;
      const xs = names(x);
      const ys = names(y);
      return (
        (xs.includes(p) && ys.includes(q)) || (ys.includes(p) && xs.includes(q))
      );
    });

  for (const p of names(a)) {
    for (const q of names(b)) {
      const meetings = meetingsOf(p, q);
      if (meetings.length < MIN) continue;
      for (const [loser, winner, team] of [
        [p, q, a.team],
        [q, p, b.team],
      ] as const) {
        const sweep = meetings.every((m) => {
          const side = m.sides.find((s) => names(s).includes(loser));
          return side ? lostBy(m, side.team) : false;
        });
        if (sweep && (!worst || meetings.length > worst.meetings)) {
          worst = { loser, team, winner, meetings: meetings.length };
        }
      }
    }
  }
  if (!worst) return null;
  return {
    kind: 'hoodoo',
    label: 'Hoodoo',
    detail: `${worst.loser} has never beaten ${worst.winner} — 0–${worst.meetings} when they've met.`,
    team: worst.team,
    subject: worst.loser,
    weight: 51,
  };
}

/**
 * The error detectors: three of them, and they mean three different things.
 *
 * - `errorFormInsight` compares a player to **their own** career rate.
 * - `errorLeaderInsight` compares them to **the field**, this season.
 * - `waywardInsight` compares them to **nothing** — it's a raw recent number
 *   that's high enough to be worth reading out.
 *
 * All three lead on unforced errors, because that's the stat that actually
 * gets discussed; double faults appear only as `waywardInsight`'s fallback and
 * as the mock milestone's, and both are set rare enough that UE lines outnumber
 * DF lines roughly two to one across the archive.
 */
const RECENT = 4;

/** Recent unforced errors well above a player's own career rate. */
export function errorFormInsight(ctx: InsightContext): Insight | null {
  const MIN_CAREER = 10;
  // Per set. Four more errors a set than your own norm is a bad month; three
  // is within the noise of a social league and fired twice as often.
  const MIN_LIFT = 4;

  let worst: { player: string; team: string; lift: number } | null = null;
  for (const side of ctx.match.sides) {
    for (const player of names(side)) {
      const past = playerHistory(ctx, player);
      if (past.length < MIN_CAREER) continue;
      const career = statPerSet(past, 'unforcedErrors');
      const recent = statPerSet(past.slice(-RECENT), 'unforcedErrors');
      if (career === null || recent === null) continue;
      const lift = recent - career;
      if (lift >= MIN_LIFT && (!worst || lift > worst.lift)) {
        worst = { player, team: side.team, lift };
      }
    }
  }
  if (!worst) return null;
  return {
    kind: 'errors',
    label: 'Off the boil',
    detail:
      `${worst.player} has made ${worst.lift.toFixed(1)} more unforced errors a set ` +
      `than the career average over the last ${RECENT} matches.`,
    team: worst.team,
    subject: worst.player,
    weight: 44,
  };
}

/** Leading the season for unforced errors per set, and playing tonight. */
export function errorLeaderInsight(ctx: InsightContext): Insight | null {
  const MIN_MATCHES = 4;
  const { match } = ctx;
  if (match.round < 4) return null;
  // "leads the season" — a present-tense claim about a live leaderboard.
  if (!isNextUp(ctx)) return null;

  const season = ctx.historyRows.filter(
    (r) => r.season === match.season && !r.isSingles && r.unforcedErrors !== null
  );
  if (!season.length) return null;

  const byPlayer = new Map<string, StatRow[]>();
  for (const r of season) byPlayer.set(r.player, [...(byPlayer.get(r.player) ?? []), r]);

  const field = [...byPlayer.entries()]
    .filter(([, rs]) => rs.length >= MIN_MATCHES)
    .map(([player, rs]) => ({ player, rate: statPerSet(rs, 'unforcedErrors')! }))
    .sort((x, y) => y.rate - x.rate);
  const top = field[0];
  if (!top) return null;

  const side = match.sides.find((s) => names(s).includes(top.player));
  if (!side) return null;
  return {
    kind: 'errors',
    label: 'Generous',
    detail:
      `${top.player} leads the season for unforced errors — ` +
      `${top.rate.toFixed(1)} a set.`,
    team: side.team,
    subject: top.player,
    weight: 46,
  };
}

/** A raw recent number: errors by the set, or double faults by the handful. */
export function waywardInsight(ctx: InsightContext): Insight | null {
  const MIN_MATCHES = 3;
  // Both bars sit around the 98th percentile of the archive. UE is a rate
  // because everybody makes them; DF is a count because most weeks are zero.
  const UE_PER_SET = 13;
  const DF_TOTAL = 10;

  let ue: { player: string; team: string; rate: number } | null = null;
  let df: { player: string; team: string; total: number } | null = null;

  for (const side of ctx.match.sides) {
    for (const player of names(side)) {
      const recent = playerHistory(ctx, player).slice(-RECENT);

      const ueRows = recent.filter((r) => r.unforcedErrors !== null);
      if (ueRows.length >= MIN_MATCHES) {
        const rate = statPerSet(ueRows, 'unforcedErrors')!;
        if (rate >= UE_PER_SET && (!ue || rate > ue.rate)) {
          ue = { player, team: side.team, rate };
        }
      }
      const dfRows = recent.filter((r) => r.doubleFaults !== null);
      if (dfRows.length >= MIN_MATCHES) {
        const total = statTotal(dfRows, 'doubleFaults');
        if (total >= DF_TOTAL && (!df || total > df.total)) {
          df = { player, team: side.team, total };
        }
      }
    }
  }

  if (ue) {
    return {
      kind: 'errors',
      label: 'Wayward',
      detail:
        `${ue.player} has made ${ue.rate.toFixed(1)} unforced errors a set ` +
        `across the last ${RECENT} matches.`,
      team: ue.team,
      subject: ue.player,
      weight: 42,
    };
  }
  if (df) {
    return {
      kind: 'errors',
      label: 'Wayward',
      detail: `${df.player} has served ${df.total} double faults in the last ${RECENT} matches.`,
      team: df.team,
      subject: df.player,
      weight: 42,
    };
  }
  return null;
}

/**
 * The milestone nobody wants: a round number of career unforced errors, or
 * failing that, of double faults.
 *
 * UE first and DF only when no UE mark is close, which is what keeps the ratio
 * between them honest — errors are what get talked about.
 */
export function mockMilestoneInsight(ctx: InsightContext): Insight | null {
  const UE_MARKS = [100, 200, 300, 400, 500, 750, 1000];
  const DF_MARKS = [25, 50, 75, 100];
  // How close counts as "about to". Wider for errors (a bad night is 15 of
  // them) than for double faults, where three would cover half a season.
  const UE_WITHIN = 2;
  const DF_WITHIN = 1;

  const near = (
    stat: 'unforcedErrors' | 'doubleFaults',
    marks: number[],
    within: number
  ): { player: string; team: string; have: number; mark: number } | null => {
    let best: { player: string; team: string; have: number; mark: number } | null = null;
    for (const side of ctx.match.sides) {
      for (const player of names(side)) {
        const have = statTotal(playerHistory(ctx, player), stat);
        if (have <= 0) continue;
        const mark = marks.find((m) => have < m);
        if (mark === undefined || mark - have > within) continue;
        if (!best || mark - have < best.mark - best.have) {
          best = { player, team: side.team, have, mark };
        }
      }
    }
    return best;
  };

  const ue = near('unforcedErrors', UE_MARKS, UE_WITHIN);
  if (ue) {
    return {
      kind: 'mock-milestone',
      label: 'Unwanted milestone',
      detail:
        `${ue.player} is ${plural(ue.mark - ue.have, 'unforced error', 'unforced errors')} ` +
        `away from ${ue.mark} for a TNT career.`,
      team: ue.team,
      subject: ue.player,
      weight: 40,
    };
  }
  const df = near('doubleFaults', DF_MARKS, DF_WITHIN);
  if (df) {
    return {
      kind: 'mock-milestone',
      label: 'Unwanted milestone',
      detail:
        `${df.player} is ${plural(df.mark - df.have, 'double fault', 'double faults')} ` +
        `away from ${df.mark} for a TNT career.`,
      team: df.team,
      subject: df.player,
      weight: 40,
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
  dominanceInsight,
  formInsight,
  partnershipInsight,
  pairH2HInsight,
  lastMeetingInsight,
  basementInsight,
  droughtInsight,
  lossStreakInsight,
  hoodooInsight,
  errorLeaderInsight,
  errorFormInsight,
  waywardInsight,
  mockMilestoneInsight,
] as const;

/**
 * The kinds that say something unflattering. Not part of `Insight` — a caller
 * has no business styling these differently, and a chip that announced itself
 * as The Mean One would kill the joke. It exists for exactly one purpose,
 * `MAX_NEGATIVE`.
 */
const NEGATIVE_KINDS: ReadonlySet<InsightKind> = new Set<InsightKind>([
  'cold-streak',
  'drought',
  'basement',
  'hoodoo',
  'errors',
  'mock-milestone',
]);

/**
 * How many unflattering lines one match may carry. One. Seven detectors can
 * fire on the same bad month and three of them are about errors; printing the
 * lot turns a bit of banter into a pile-on, and squeezes out the ladder story
 * that's the reason anyone opened the page.
 */
const MAX_NEGATIVE = 1;

/**
 * How many lines one player may carry. One.
 *
 * Fourteen detectors read the same career, so a single good — or bad — month
 * lights several of them up about the same man, and the panel then spends all
 * three of its slots on him. At best that's repetitive; at worst it argues
 * with itself, which it did:
 *
 *   Jonathan Kierce arrives on 9 straight wins.
 *   Jonathan Kierce has made 5.7 more unforced errors a set than the career
 *   average over the last 4 matches.
 *
 * Both true, both from the same window, and printed together in S2 R1. Over
 * the archive, 26% of multi-line panels named one player twice. Weight order
 * decides which of his lines survives, and the rest of the panel goes to
 * somebody else — which is the point of having three slots.
 *
 * Team-level lines (`stakes`, `drought`, `basement`, `dominance`, the h2h
 * pair) carry no `subject` and are never dropped by this.
 */
const MAX_PER_PLAYER = 1;

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
  // Weight order first, so of the lines a cap discards, the ones that survive
  // are the best rather than whichever detector happens to run first.
  const kept: Insight[] = [];
  let negatives = 0;
  const perPlayer = new Map<string, number>();
  for (const insight of found.sort((a, b) => b.weight - a.weight)) {
    const negative = NEGATIVE_KINDS.has(insight.kind);
    if (negative && negatives >= MAX_NEGATIVE) continue;
    const spoken = insight.subject ? (perPlayer.get(insight.subject) ?? 0) : 0;
    if (insight.subject && spoken >= MAX_PER_PLAYER) continue;
    // Both budgets are spent only by a line that actually makes the panel, so
    // one dropped for talking about the wrong player doesn't also cost the
    // match its single unflattering line.
    if (negative) negatives++;
    if (insight.subject) perPlayer.set(insight.subject, spoken + 1);
    kept.push(insight);
    if (kept.length === limit) break;
  }
  return kept;
}

/** Convenience: build the window and run the detectors in one call. */
export function insightsFor(
  match: MatchRecord,
  allRows: StatRow[],
  opts: InsightOptions = {},
  limit = 3
): Insight[] {
  return matchInsights(insightContext(match, allRows, opts), limit);
}
