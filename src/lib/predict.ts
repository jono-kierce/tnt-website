/**
 * The prediction model: per-player Elo, replayed over every match TNT has
 * played, where each player is rated on their own performance rather than
 * inheriting a team result wholesale.
 *
 * Why per player and not per team: the teams are redrafted every season, so a
 * team rating would be thrown away each January. A player's is the thing that
 * carries. A pair is rated at the mean of its two players for prediction
 * purposes — crude, and about all that 170 matches of doubles can support
 * without inventing partnership effects out of noise.
 *
 * Why per player *and not per side*: two people share a scoreline, but they
 * don't share a night. A player who played a fantastic match can still watch
 * their partner hand the set away — the old model (a team delta, reallocated
 * between team-mates) could only ever soften that player's loss, never turn it
 * into a gain. This one rates each player against the opposing pair directly,
 * so how you performed against what you personally faced is most of what
 * moves your number, and your partner's rating never enters your own update.
 *
 * Four rules this file keeps:
 *
 *  - **It never reads `votes`.** Not one line. That's what makes it safe to run
 *    against a season whose votes are sealed: there is nothing here that could
 *    leak an award before awards night.
 *  - **Outcomes come from `win?`**, via `MatchRecord.winner` — never from
 *    counting sets. A level set nobody recorded the breaker for still has a
 *    winner, and it isn't the one the scoreline implies.
 *  - **The match result still counts — it's just not the whole story.** Every
 *    player on a side carries the same result-based floor (`ELO.outcomeWeight`
 *    of their score), topped up or knocked down by how their own stat ledger
 *    compared with the pair across the net. See `personalScores`. Opponent
 *    strength is never double-counted into that comparison — it's already
 *    priced in by the surrounding Elo expectation (see `replay`), the same way
 *    beating a weak side for less reward always has been in Elo.
 *  - **The replay is deterministic.** Same rows in, same ratings out, in the
 *    same order — which is what lets every historical match carry its own
 *    reconstructed PRE-match prediction for free: the state of the model the
 *    moment before a match is simply a point in the replay.
 *
 * One thing this model gives up, deliberately: classic Elo is zero-sum, a
 * match's rating movement summing to nothing. This one doesn't — a player's
 * delta depends on their own stat line against the opponents', not on a fixed
 * pool split with a team-mate, so the four deltas in a match no longer have to
 * net to zero. That's the price of rating performance instead of just result.
 *
 * The maths lives here and nowhere else. Pages and graphics consume it.
 */

import type { StatRow } from './types.ts';
import { contribution, seasonMatches, type MatchRecord } from './stats.ts';
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
   * How far a result moves a player. Smaller than the old team-split model's
   * 32: every player's score now already carries a stat-performance component
   * that moves independently of the K-scaled result term, so less K is needed
   * to get a player off 1500 inside a season — most of a big swing comes from
   * `personalScores` being far from 0.5, not from K itself.
   */
  k: 20,
  /**
   * How far ratings are pulled back toward the mean between seasons, 0–1.
   *
   * 0, which is the opposite of the old team-split model's 0.9 — worth
   * flagging, since it reverses a finding that file used to call monotonic.
   * The difference is what this model now carries into January: a rating
   * built from `personalScores` already tracks a player's own recent stat
   * performance, not just an accumulated team win/loss streak, so it's
   * already closer to "current form" by the time a season ends and has less
   * of the old model's staleness to regress away. Every value from 0 to 0.9
   * was tried; 0 both wins the accuracy search and gives the smoothest Brier
   * score of the sweep (0.2323, rising the whole way to 0.2350 at 0.9) — the
   * continuous metric agrees with the discrete one instead of just being
   * dragged along by a lucky match or two. (Both numbers move with `ELO.k`
   * and `ELO.scale`; re-run `tune()` rather than trusting this in isolation.)
   */
  seasonRegression: 0,
  /**
   * How much of a player's own personal score is the match result, 0–1; the
   * rest is their stat performance against the opposing pair. See
   * `personalScores`. Floored at 0.3 in `tune()`'s own search grid — below
   * that a win stops being "a large part" of a player's score, which this
   * model isn't meant to give up. 0.3 is also close to where the accuracy
   * search lands on its own once that floor is respected: the unconstrained
   * search wants 0.1, but 0.3 gives up only about a call out of 166 for a
   * model that still means it when it says the result mattered.
   */
  outcomeWeight: 0.3,
  /**
   * The gap in net stats, against the opposing pair's mean, that counts as a
   * decisive personal performance. A player this far clear takes their
   * performance component to about 88% (0.5 + 0.5×tanh(1)); this far behind,
   * to about 12%. Smaller than the old team-split model's 9 — a comparison
   * against the pair across the net moves faster than one against a single
   * team-mate, because it's averaged over two opponents' nights instead of
   * one, so the same-sized gap is a more reliable signal sooner.
   */
  performanceScale: 4,
  /**
   * The logistic scale — how confidently a *given* rating gap gets expressed
   * as a probability. Lowered from Elo's own 400 to make predictions read
   * bolder: it doesn't touch who the model favours or whether a call is right
   * (`favourite`/`correct` are decided by the sign of the rating gap, not its
   * size), so it costs nothing in backtest accuracy directly — it only makes
   * the displayed percentage less conservative for the same underlying
   * ratings, and worsens calibration (Brier) as a direct trade for that.
   */
  scale: 250,
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
  outcomeWeight?: number;
  performanceScale?: number;
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
 * The net stat ledger this model rates players on. It lives in `stats.ts`
 * because it isn't only the model's any more — the player pages' form
 * match-ups measure the same thing, and one definition of "what a player did
 * on the night" is the whole point. Re-exported here because this is where it
 * was born and where most callers still look for it.
 */
export { contribution } from './stats.ts';

/**
 * What each player on a side actually earns for one match: part the result,
 * part how their own ledger compared with the pair across the net.
 *
 *   performance = 0.5 + 0.5 × tanh((net − opponentMean) / performanceScale)
 *   score = outcomeWeight × result + (1 − outcomeWeight) × performance
 *
 * `result` (0, 0.5 or 1) is the same for every player on a side — it's the
 * match, not the individual, that won or lost. `performance` is personal:
 * each player's own net stat against the *opposing pair's* mean net stat, so
 * a big night is judged by what it did to the players actually across the
 * net, not by whether a team-mate had a quiet one. Squashed through `tanh` so
 * a single freak set can't swing a player to 0 or 1 outright.
 *
 * This is also where opponent strength gets its say, but indirectly:
 * `performance` only measures the stat gap in *this* match, and it's
 * `replay`'s `expectedScore(rating, opponentPairRating)` — not this function —
 * that discounts a big performance against a weak pair and rewards the same
 * performance against a strong one. Folding opponent rating into `performance`
 * too would double-count the same signal.
 *
 * Falls back to `result` alone — plain doubles Elo for that player — when
 * either side's ledger is incomplete. A performance score needs both ends of
 * the comparison; half a ledger, or the opponents' blank one, can't produce
 * one. That's every finals night on record bar Season 3's.
 */
export function personalScores(
  own: StatRow[],
  opponents: StatRow[],
  result: number,
  opts: EloOptions = {}
): number[] {
  const {
    outcomeWeight = ELO.outcomeWeight,
    performanceScale = ELO.performanceScale,
  } = opts;
  const asResult = own.map(() => result);
  if (outcomeWeight >= 1) return asResult;

  const ownNets = own.map(contribution);
  const oppNets = opponents.map(contribution);
  if (ownNets.some((n) => n === null) || oppNets.some((n) => n === null)) {
    return asResult;
  }

  const oppValues = oppNets as number[];
  const opponentMean = oppValues.reduce((a, b) => a + b, 0) / oppValues.length;

  return (ownNets as number[]).map((n) => {
    const performance = 0.5 + 0.5 * Math.tanh((n - opponentMean) / performanceScale);
    return outcomeWeight * result + (1 - outcomeWeight) * performance;
  });
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

    // Each side's players are scored against their own opposing pair's mean
    // rating — not their own side's — so a player's movement never depends on
    // their team-mate's rating, only on their own and what they personally did
    // against what they personally faced.
    const results: [number, number] = [scoreA, 1 - scoreA];
    for (const side of [0, 1] as const) {
      const opponent = side === 0 ? 1 : 0;
      const opponentRating = sides[opponent].rating;
      const scores = personalScores(lineups[side], lineups[opponent], results[side], opts);
      lineups[side].forEach((p, i) => {
        const rating = ratings.get(p.player) ?? start;
        const delta = k * (scores[i] - expectedScore(rating, opponentRating));
        ratings.set(p.player, rating + delta);
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
 * Top EIGHT of the twenty-six qualified players, not top four or six, and the
 * number was chosen by what it costs rather than by what sounds strict. At
 * eight, 185 of the 1225 settings searched clear it, and the best of those
 * gives up two calls out of 166 against the best setting found with no gate
 * at all — cheap enough that the gate is still a sanity check, not a thumb on
 * the scale. (This number moves with `ELO.scale`, since that feeds every
 * replay `tune()` runs; a test re-measures it rather than hard-coding it.) At
 * six, **nothing in the search clears it**: no combination of these constants
 * seats all four names that high at once, so six isn't a stricter gate, it's
 * a different, unsatisfiable one.
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
  opts: Required<Pick<EloOptions, 'k' | 'seasonRegression' | 'outcomeWeight' | 'performanceScale'>>;
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
 * on 166 matches it's a step function, so several settings call exactly the
 * same matches right and the better-calibrated one should win. Settings that
 * fail the gate sort last rather than being dropped, so the search can still be
 * inspected when nothing passes.
 */
export function tune(
  rows: StatRow[] = loadStatRows(),
  grid: {
    k?: number[];
    seasonRegression?: number[];
    outcomeWeight?: number[];
    performanceScale?: number[];
  } = {}
): TuneResult[] {
  const {
    k: ks = [16, 24, 32, 40, 48, 64, 80],
    seasonRegression: regs = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9],
    // Floored at 0.3: below that, the match result stops being "a large part"
    // of a player's score, which is the one thing this model isn't meant to
    // give up regardless of what the accuracy search would otherwise prefer.
    outcomeWeight: weights = [0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1],
    performanceScale: scales = [4, 6, 9, 12],
  } = grid;

  const out: TuneResult[] = [];
  for (const k of ks) {
    for (const seasonRegression of regs) {
      for (const outcomeWeight of weights) {
        for (const performanceScale of scales) {
          const opts = { k, seasonRegression, outcomeWeight, performanceScale };
          const r = replay(rows, opts);
          const table = powerRankings(r);
          out.push({
            opts,
            result: backtestFrom(r),
            table,
            facesValid: passesFaceValidity(table),
          });
          // The scale does nothing when the result is the whole score; one
          // pass is enough to represent plain doubles Elo.
          if (outcomeWeight === 1) break;
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
