/**
 * The prediction model: per-player Elo, replayed over every match TNT has
 * played, with each night's result split between team-mates by who did the work.
 *
 * Why per player and not per team: the teams are redrafted every season, so a
 * team rating would be thrown away each January. A player's is the thing that
 * carries. A pair is rated at the mean of its two players — crude, and about
 * all that 170 matches of doubles can support without inventing partnership
 * effects out of noise.
 *
 * Four rules this file keeps:
 *
 *  - **It never reads `votes`.** Not one line. That's what makes it safe to run
 *    against a season whose votes are sealed: there is nothing here that could
 *    leak an award before awards night.
 *  - **Outcomes come from `win?`**, via `MatchRecord.winner` — never from
 *    counting sets. A level set nobody recorded the breaker for still has a
 *    winner, and it isn't the one the scoreline implies.
 *  - **Stats split a result; they never decide one.** The side with the better
 *    net stats wins about 90% of the time, because those stats largely restate
 *    the result — the winners hit more winners. Letting them pick the winner
 *    would be circular. All they do here is divide a result already settled by
 *    `win?` between the two players who share it.
 *  - **The replay is deterministic.** Same rows in, same ratings out, in the
 *    same order — which is what lets every historical match carry its own
 *    reconstructed PRE-match prediction for free: the state of the model the
 *    moment before a match is simply a point in the replay.
 *
 * The maths lives here and nowhere else. Pages and graphics consume it.
 */

import type { StatRow } from './types.ts';
import { seasonMatches, type MatchRecord } from './stats.ts';
import { loadStatRows } from './normalize.ts';
import { SITE } from '../config/site.ts';

/**
 * Model constants, chosen by `tune()` below over every match from S1 R1 to the
 * end of S4 — see the tuning notes in that function. They are editorial in the
 * same sense `currentSeason` is: numbers somebody picked, recorded here so they
 * can't drift, and re-checked by the test suite.
 */
export const ELO = {
  /** Everyone's first rating. The scale's zero point; nothing depends on it. */
  start: 1500,
  /**
   * How far a result moves a player. TNT plays nine rounds a season, so a
   * player logs a few dozen matches in a whole career — a chess-sized K of 16
   * would never get anyone off the mark before the season ended. Large by Elo
   * standards, and what the data asks for: this is a form model over nine
   * nights, not a rating built over hundreds of games.
   */
  k: 32,
  /**
   * How far ratings are pulled back toward the mean between seasons, 0–1.
   *
   * 0.9 — nine tenths of last season's edge given up every January — which
   * looks drastic until you see what the results say. Every value from 0 to 0.9
   * was tried against every match on record: the more of last season a rating
   * carried, the WORSE it predicted, monotonically, both overall and on a
   * Season 4 holdout the constants were not chosen against. Every team is
   * redrafted every year and the field turns over; a rating earned alongside a
   * different partner against a different standard is mostly stale. What this
   * model really tracks is form within a season.
   *
   * Not 1.0, which scores better on paper but only by declining to call the
   * season-opening rounds at all — every player back at exactly 1500 rates
   * every match dead level, which quietly drops the hardest matches from the
   * denominator. 0.9 keeps its opinion and is measured on all of them.
   *
   * Applied to everyone, played that season or not, so a player who sits one
   * out drifts back toward average rather than being singled out for missing.
   */
  seasonRegression: 0.35,
  /**
   * How much of a side's movement the contribution split can shift, 0–1. At 0
   * both players move identically, which is plain doubles Elo; at 1 one player
   * could take the entire result. See `sideWeights`.
   *
   * 0.6 costs nothing in accuracy — the split can't change a pair's mean rating,
   * so it only reaches a prediction through re-pairings — and it markedly
   * improves the individual ratings it does change. With the split off, the
   * four players the league would put at the top come out 2nd, 4th, 8th and
   * 10th of 25; with it on, 1st, 3rd, 4th and 7th.
   */
  contributionWeight: 0.75,
  /**
   * The gap in net stats, within a side, that counts as decisive. A player
   * this far clear of their partner takes about 76% of the tilt (tanh(1)).
   */
  contributionScale: 9,
  /** The logistic scale. 400 is Elo's own, and there's no reason to move it. */
  scale: 400,
} as const;

/** A pair of players and the rating the model gives them. */
export interface PairRating {
  team: string;
  players: string[];
  /** Mean of the players' ratings at that moment. */
  rating: number;
  /** How many of `players` the model had actually seen play before. */
  known: number;
}

/** One match as the model saw it, the instant before it was played. */
export interface MatchPrediction {
  /** `MatchRecord.key` — the same identity the match page is built on. */
  key: string;
  season: number;
  round: number;
  roundLabel: string;
  isFinals: boolean;
  scheduled: boolean;
  /** Both sides, in `MatchRecord.sides` order (alphabetical by team). */
  sides: [PairRating, PairRating];
  /** P(sides[0] wins), from the pair-rating difference. */
  probability: number;
  /** The team the model favoured, or null when the two sides rated level. */
  favourite: string | null;
  /**
   * What actually happened: the winning team, or null for a fixture and for a
   * match nobody was recorded as winning.
   */
  winner: string | null;
  /** A played match with no recorded winner — scored half a point each way. */
  isDraw: boolean;
  /** Whether the favourite won. Null when there wasn't one, or it's unplayed. */
  correct: boolean | null;
}

export interface Replay {
  /** Rating per player after every played match. */
  ratings: Map<string, number>;
  /** Matches each player contributed to — the bar for the power ratings. */
  appearances: Map<string, number>;
  /** Every played match, in playing order, as the model saw it beforehand. */
  matches: MatchPrediction[];
  /** Lookup by `MatchRecord.key`. */
  byKey: Map<string, MatchPrediction>;
  /** The last season the replay saw. A later one needs regressing first. */
  lastSeason: number;
}

export interface EloOptions {
  k?: number;
  seasonRegression?: number;
  contributionWeight?: number;
  contributionScale?: number;
  start?: number;
}

/** Expected score for a rating `a` against a rating `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / ELO.scale));
}

// ---------------------------------------------------------------------------
// Contribution — who did the work
// ---------------------------------------------------------------------------

/**
 * A player's net ledger for one match: what they made happen, less what they
 * gave away.
 *
 *   good = winners + aces + errors forced
 *   bad  = unforced errors + double faults
 *
 * **Forced errors are not in it.** An error the opponent forced out of you is
 * theirs to claim, not yours to answer for — and it already appears on their
 * side of the ledger, because `Errors Forced` and the opponent's `Forced
 * Errors` are the same events counted from both ends (1132 against 1122 across
 * the whole CSV, which is as close as two hand-kept columns get).
 *
 * Null when the match wasn't statted, which is not the same as zero — every
 * finals night on record is a scoreline and nothing else. Callers fall back to
 * an even split rather than pretending a blank sheet means nobody did anything.
 *
 * The comparison this feeds is always between two players on the same side of
 * the same match, so era and match length cancel: S1's serve stats and S2+'s
 * errors forced never have to be reconciled against each other.
 */
export function contribution(r: StatRow): number | null {
  if (r.winners === null && r.unforcedErrors === null) return null;
  const good = (r.winners ?? 0) + (r.aces ?? 0) + (r.errorsForced ?? 0);
  const bad = (r.unforcedErrors ?? 0) + (r.doubleFaults ?? 0);
  return good - bad;
}

/**
 * How to divide a side's movement between its players.
 *
 * Both players share one result; they rarely share it evenly. Each player is
 * compared with their own side's average, squashed through `tanh` so a freak
 * night can't run away with the whole match, and tilted by which way the result
 * went:
 *
 *   weight = 1 + contributionWeight × tanh((net − sideMean) / scale) × s
 *
 * where `s` is +1 for a win and −1 for a loss. That one sign is what makes it
 * read correctly in both directions with no special-casing: **win and the
 * bigger contributor gains more; lose and the bigger contributor loses less,
 * with the passenger taking the freight.**
 *
 * The weights always average 1, so the side's total movement — and therefore
 * the pair's mean rating, which is what a prediction is made from — is exactly
 * what an even split would have given. The split changes individual ratings,
 * and reaches predictions only when the partnership changes: at every redraft,
 * and in the 42 of 87 player-seasons that involve more than one partner.
 *
 * Returns all-1s when the match has no stats, or when only some of the side
 * does — half a ledger can't be compared with a blank one.
 */
export function sideWeights(
  players: StatRow[],
  won: boolean,
  opts: EloOptions = {}
): number[] {
  const {
    contributionWeight = ELO.contributionWeight,
    contributionScale = ELO.contributionScale,
  } = opts;
  const even = players.map(() => 1);
  if (players.length < 2 || contributionWeight === 0) return even;

  const nets = players.map(contribution);
  if (nets.some((n) => n === null)) return even;

  const values = nets as number[];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const s = won ? 1 : -1;
  const weights = values.map(
    (n) => 1 + contributionWeight * Math.tanh((n - mean) / contributionScale) * s
  );

  // tanh isn't linear, so the tilts don't cancel exactly on a side of three.
  // Renormalising to average 1 is what keeps the match zero-sum.
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w * weights.length) / total);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * The players a side is rated on: the line-up, minus the SINGLES GAME sentinel,
 * which is match data rather than a person. A fill-in counts as themselves —
 * they're the one on court.
 */
function lineup(m: MatchRecord, side: 0 | 1): StatRow[] {
  return m.sides[side].players.filter((p) => !p.isSingles);
}

function ratePair(
  team: string,
  players: string[],
  ratings: Map<string, number>,
  start: number
): PairRating {
  const known = players.filter((p) => ratings.has(p)).length;
  const total = players.reduce((sum, p) => sum + (ratings.get(p) ?? start), 0);
  return {
    team,
    players,
    rating: players.length ? total / players.length : start,
    known,
  };
}

/** Pull every rating a fraction of the way back toward the mean. */
function regress(ratings: Map<string, number>, amount: number, start: number): void {
  if (amount <= 0) return;
  for (const [player, rating] of ratings) {
    ratings.set(player, rating + (start - rating) * amount);
  }
}

/**
 * Replay every played match in order, rating the players as it goes.
 *
 * Order is season, then round — finals sort after the home-and-away season, as
 * they're played — then team name, which is `seasonMatches`' own ordering and
 * is stable across builds. Within a round the order barely matters (a round is
 * one night), but it has to be *fixed*, or a rebuild could produce a different
 * number for the same match.
 */
export function replay(
  rows: StatRow[] = loadStatRows(),
  opts: EloOptions = {}
): Replay {
  const { k = ELO.k, seasonRegression = ELO.seasonRegression, start = ELO.start } = opts;

  const ratings = new Map<string, number>();
  const appearances = new Map<string, number>();
  const matches: MatchPrediction[] = [];

  const all = seasonMatches(rows)
    .filter((m) => !m.scheduled)
    .sort((a, b) => a.season - b.season || a.round - b.round || a.key.localeCompare(b.key));

  let season: number | null = null;

  for (const m of all) {
    // A new season: everyone drifts back toward the middle. The league is
    // redrafted, a year has passed, and last year's edge is not this year's.
    if (season !== null && m.season !== season) {
      regress(ratings, seasonRegression, start);
    }
    season = m.season;

    const lineups: [StatRow[], StatRow[]] = [lineup(m, 0), lineup(m, 1)];
    // A singles night has no pair to rate on either side; it counts for the
    // ladder and for nothing here.
    if (!lineups[0].length || !lineups[1].length) continue;

    const names: [string[], string[]] = [
      lineups[0].map((p) => p.player),
      lineups[1].map((p) => p.player),
    ];
    const sides: [PairRating, PairRating] = [
      ratePair(m.sides[0].team, names[0], ratings, start),
      ratePair(m.sides[1].team, names[1], ratings, start),
    ];
    const probability = expectedScore(sides[0].rating, sides[1].rating);
    const favourite =
      sides[0].rating === sides[1].rating
        ? null
        : sides[0].rating > sides[1].rating
          ? sides[0].team
          : sides[1].team;

    // Draws don't happen in TNT — every match on record has exactly one side
    // flagged in `win?`. If one ever does, half a point each is the right
    // answer and the model shouldn't need editing that week.
    const scoreA = m.isDraw ? 0.5 : m.winner === sides[0].team ? 1 : 0;

    matches.push({
      key: m.key,
      season: m.season,
      round: m.round,
      roundLabel: m.roundLabel,
      isFinals: m.isFinals,
      scheduled: false,
      sides,
      probability,
      favourite,
      winner: m.winner,
      isDraw: m.isDraw,
      correct: favourite === null || m.isDraw ? null : favourite === m.winner,
    });

    const deltaA = k * (scoreA - probability);
    for (const side of [0, 1] as const) {
      const delta = side === 0 ? deltaA : -deltaA;
      const won = m.isDraw ? false : m.winner === sides[side].team;
      const weights = sideWeights(lineups[side], won, opts);
      lineups[side].forEach((p, i) => {
        ratings.set(p.player, (ratings.get(p.player) ?? start) + delta * weights[i]);
        appearances.set(p.player, (appearances.get(p.player) ?? 0) + 1);
      });
    }
  }

  return {
    ratings,
    appearances,
    matches,
    byKey: new Map(matches.map((m) => [m.key, m])),
    lastSeason: season ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Predicting a match that hasn't been played
// ---------------------------------------------------------------------------

/**
 * Rate a match against a given set of ratings — normally the ones a full replay
 * ends on. `sides` is in `MatchRecord.sides` order, so the probability is for
 * `sides[0]`, exactly as in a replayed match.
 */
export function predictMatch(
  m: MatchRecord,
  ratings: Map<string, number>,
  start = ELO.start
): MatchPrediction {
  const sides: [PairRating, PairRating] = [
    ratePair(m.sides[0].team, lineup(m, 0).map((p) => p.player), ratings, start),
    ratePair(m.sides[1].team, lineup(m, 1).map((p) => p.player), ratings, start),
  ];
  return {
    key: m.key,
    season: m.season,
    round: m.round,
    roundLabel: m.roundLabel,
    isFinals: m.isFinals,
    scheduled: m.scheduled,
    sides,
    probability: expectedScore(sides[0].rating, sides[1].rating),
    favourite:
      sides[0].rating === sides[1].rating
        ? null
        : sides[0].rating > sides[1].rating
          ? sides[0].team
          : sides[1].team,
    winner: m.winner,
    isDraw: m.isDraw,
    correct: null,
  };
}

/** P(the first pair wins), for two named line-ups. */
export function predictPair(
  a: string[],
  b: string[],
  ratings: Map<string, number>,
  start = ELO.start
): number {
  const mean = (players: string[]) =>
    players.length
      ? players.reduce((sum, p) => sum + (ratings.get(p) ?? start), 0) / players.length
      : start;
  return expectedScore(mean(a), mean(b));
}

// ---------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------

export interface Backtest {
  /** Played matches the model had an opinion about. */
  called: number;
  /** Of those, how many it got right. */
  correct: number;
  accuracy: number;
  /** Mean squared error of the probability. Lower is better; 0.25 is a coin. */
  brier: number;
  /** Matches skipped because the two sides rated exactly level. */
  levelled: number;
  /** Every played match, so a caller can slice by season or by finals. */
  matches: MatchPrediction[];
}

/**
 * How well the model has actually done, over the matches it was willing to
 * call.
 *
 * The denominator deliberately excludes matches where the two pairs rated
 * exactly level — four debutants on 1500 apiece, which is most of Season 1
 * Round 1. The model said nothing about those, and counting them as half-right
 * would dress a coin toss up as a record. `levelled` says how many were set
 * aside so the headline can own up to it.
 *
 * The Brier score uses every decided match including the level ones, because a
 * 0.5 there is a real and honest forecast even though it isn't a call.
 */
export function backtest(
  rows: StatRow[] = loadStatRows(),
  opts: EloOptions = {}
): Backtest {
  const { matches } = replay(rows, opts);
  const decided = matches.filter((m) => !m.isDraw);
  const called = decided.filter((m) => m.correct !== null);
  const correct = called.filter((m) => m.correct).length;

  const brier =
    decided.reduce((sum, m) => {
      const actual = m.winner === m.sides[0].team ? 1 : 0;
      return sum + (m.probability - actual) ** 2;
    }, 0) / (decided.length || 1);

  return {
    called: called.length,
    correct,
    accuracy: called.length ? correct / called.length : 0,
    brier,
    levelled: decided.length - called.length,
    matches,
  };
}

/** "110 of 165 matches (66.7%)" — the honest headline. */
export function accuracyHeadline(b: Backtest = backtest()): string {
  return `${b.correct} of ${b.called} matches (${(b.accuracy * 100).toFixed(1)}%)`;
}

// ---------------------------------------------------------------------------
// Power ratings
// ---------------------------------------------------------------------------

export interface RatedPlayer {
  player: string;
  rating: number;
  matches: number;
  rank: number;
}

/**
 * The all-time table. Players below `SITE.rankMinMatches` are left out, the
 * same bar the stat-panel badges use: a rating off three nights is a number,
 * not a standing.
 */
export function powerRankings(
  r: Replay = siteReplay(),
  minMatches = SITE.rankMinMatches
): RatedPlayer[] {
  return [...r.ratings.entries()]
    .map(([player, rating]) => ({
      player,
      rating,
      matches: r.appearances.get(player) ?? 0,
      rank: 0,
    }))
    .filter((p) => p.matches >= minMatches)
    .sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

/**
 * The four players the league would expect to see at the top.
 *
 * This is a **face-validity gate on the tuning**, and it is an editorial
 * judgement rather than anything the data discovered — the owner named these
 * four before any rating existed. It earns its place because the rating goes on
 * public display: a table that puts a high-volume journeyman above four players
 * everyone knows are better is wrong in the way that matters, whatever it
 * backtests. `tune()` sorts settings that keep all four inside the top
 * `FACE_VALIDITY_TOP` ahead of those that don't, and the test asserts the
 * committed constants still clear it.
 *
 * They are, independently, the top four in the league on career net stats per
 * set — the very metric the contribution split is built on — so the gate is
 * less arbitrary than a list of four names looks.
 *
 * Top EIGHT of the twenty-five qualified players, not top four or six, and the
 * number was chosen by what it costs rather than by what sounds strict. At
 * eight the gate is free: 438 of the 637 settings searched clear it, and the
 * best of those is the same setting that wins with no gate at all. At six only
 * seven settings clear it, every one of them by forcing the between-seasons
 * regression to zero, and the best gives up 4.3 points of accuracy — which is
 * no longer a sanity check on the tuning but a thumb on the scale.
 */
export const FACE_VALIDITY_NAMES = [
  'Luke Sharrock',
  'Adam Dickson',
  'Charlie Simpson',
  'Jonathan Kierce',
];
export const FACE_VALIDITY_TOP = 8;

/** Whether a rating puts all four of the above inside the top N. */
export function passesFaceValidity(
  table: RatedPlayer[],
  top = FACE_VALIDITY_TOP
): boolean {
  const leaders = new Set(table.slice(0, top).map((p) => p.player));
  return FACE_VALIDITY_NAMES.every((n) => leaders.has(n));
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface TuneResult {
  opts: Required<Pick<EloOptions, 'k' | 'seasonRegression' | 'contributionWeight' | 'contributionScale'>>;
  result: Backtest;
  table: RatedPlayer[];
  facesValid: boolean;
}

/**
 * Grid-search the model's constants.
 *
 * This is how the numbers in `ELO` were arrived at, and the test re-runs it so
 * a season of new results can't quietly leave them stale. It is not run at
 * build time: the site imports the tuned constants, not the search.
 *
 * Ranked on accuracy among settings that pass the face-validity gate, with the
 * Brier score breaking ties — accuracy is the number anyone actually reads, but
 * on 165 matches it's a step function, so several settings call exactly the
 * same matches right and the better-calibrated one should win. Settings that
 * fail the gate sort last rather than being dropped, so the search can still be
 * inspected when nothing passes.
 */
export function tune(
  rows: StatRow[] = loadStatRows(),
  grid: {
    k?: number[];
    seasonRegression?: number[];
    contributionWeight?: number[];
    contributionScale?: number[];
  } = {}
): TuneResult[] {
  const {
    k: ks = [16, 24, 32, 40, 48, 64, 80],
    seasonRegression: regs = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9],
    contributionWeight: weights = [0, 0.2, 0.4, 0.6, 0.8],
    contributionScale: scales = [4, 6, 9],
  } = grid;

  const out: TuneResult[] = [];
  for (const k of ks) {
    for (const seasonRegression of regs) {
      for (const contributionWeight of weights) {
        for (const contributionScale of scales) {
          const opts = { k, seasonRegression, contributionWeight, contributionScale };
          const r = replay(rows, opts);
          const table = powerRankings(r);
          out.push({
            opts,
            result: backtestFrom(r),
            table,
            facesValid: passesFaceValidity(table),
          });
          // The scale does nothing when the split is switched off; one pass is
          // enough to represent plain doubles Elo.
          if (contributionWeight === 0) break;
        }
      }
    }
  }

  return out.sort(
    (a, b) =>
      Number(b.facesValid) - Number(a.facesValid) ||
      b.result.accuracy - a.result.accuracy ||
      a.result.brier - b.result.brier ||
      a.opts.k - b.opts.k
  );
}

/** `backtest`, reusing a replay that's already been run. */
function backtestFrom(r: Replay): Backtest {
  const decided = r.matches.filter((m) => !m.isDraw);
  const called = decided.filter((m) => m.correct !== null);
  const correct = called.filter((m) => m.correct).length;
  const brier =
    decided.reduce((sum, m) => {
      const actual = m.winner === m.sides[0].team ? 1 : 0;
      return sum + (m.probability - actual) ** 2;
    }, 0) / (decided.length || 1);
  return {
    called: called.length,
    correct,
    accuracy: called.length ? correct / called.length : 0,
    brier,
    levelled: decided.length - called.length,
    matches: r.matches,
  };
}

// ---------------------------------------------------------------------------
// The site's own replay, done once
// ---------------------------------------------------------------------------

let _replay: Replay | null = null;

/** The replay over the real CSV, computed once per build. */
export function siteReplay(): Replay {
  if (!_replay) _replay = replay();
  return _replay;
}

/** A played match's reconstructed pre-match prediction, by `MatchRecord.key`. */
export function matchPrediction(key: string): MatchPrediction | undefined {
  return siteReplay().byKey.get(key);
}

/**
 * The prediction to show for any match: the reconstructed one for a match
 * already played, and a fresh one off the current ratings for a fixture.
 *
 * A fixture in a season the replay never reached gets the between-seasons
 * regression applied first — once per season crossed. Without it Season 5 would
 * be predicted from raw end-of-Season-4 ratings, which is a more confident
 * model than the one that was tuned, and confident is the one thing an opening
 * round has no business being.
 */
export function predictionFor(m: MatchRecord): MatchPrediction {
  const known = matchPrediction(m.key);
  if (known) return known;

  const r = siteReplay();
  const seasonsAhead = Math.max(0, m.season - r.lastSeason);
  if (seasonsAhead === 0) return predictMatch(m, r.ratings);

  const ratings = new Map(r.ratings);
  for (let i = 0; i < seasonsAhead; i++) {
    regress(ratings, ELO.seasonRegression, ELO.start);
  }
  return predictMatch(m, ratings);
}

/** Ratings as they stand for a season the replay hasn't reached. */
export function ratingsForSeason(season: number, r: Replay = siteReplay()): Map<string, number> {
  const ratings = new Map(r.ratings);
  for (let i = 0; i < Math.max(0, season - r.lastSeason); i++) {
    regress(ratings, ELO.seasonRegression, ELO.start);
  }
  return ratings;
}
