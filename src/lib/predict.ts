/**
 * The prediction model: a per-player skill rating fit as one regularised,
 * globally-optimal estimate rather than accumulated match by match.
 *
 * Why this and not Elo: Elo is an online tracker with a fixed step size, so it
 * never settles — a genuinely strong player keeps clearing expectation and
 * drifts upward for as long as they keep playing, and a weak one sinks, which
 * means a rating ends up half-explained by how many matches someone has played
 * rather than how well. This model instead finds the single set of player
 * skills that best explains every result at once, under a ridge penalty that
 * pulls a thin sample back toward the league average. A three-match fill-in
 * sits near the middle because the data can't argue otherwise; a hundred-match
 * regular sits where their record puts them and goes no further. The estimate
 * is the optimum, so it doesn't drift, and it's the same whatever order the
 * rows arrive in.
 *
 * Two signals feed the same skill:
 *
 *  - **who won** — a Bradley-Terry (logistic) term: a pair rates at the mean of
 *    its two players, and the model prefers skills under which the winners were
 *    likely to win.
 *  - **how the night went** — a least-squares term on each *player's own*
 *    net-stat output per set (`contribution` below), net of the pair they
 *    faced, so a player who was the best on court in a losing side still earns
 *    for it, and one carried to a win by a partner doesn't bank the full
 *    result. This is the direct fix for Elo's old "good player, bad team-mates"
 *    blind spot: two team-mates who shared a result have different box scores,
 *    so they're separate rows in the fit, never a shared team delta.
 *
 * Recent matches count for more (`halfLife`, in matches): a static fit that
 * weighs a debut season and last month alike loses the thing that makes a
 * rating worth reading — current form — so observations decay with age. That
 * one ingredient is what keeps this level with the old Elo on raw call
 * accuracy while fixing the drift underneath it.
 *
 * Rules this file keeps, unchanged from the Elo version:
 *
 *  - **It never reads `votes`.** Not one line — the grep test proves it, and
 *    that's what makes it safe to run against a season whose votes are sealed.
 *  - **Outcomes come from `win?`**, via `MatchRecord.winner`, never from
 *    counting sets. A match nobody was recorded as winning scores half each way.
 *  - **The estimate is deterministic.** The objective is convex (a logistic
 *    term, a quadratic term and a quadratic penalty), so it has one minimum and
 *    the fit lands on it regardless of row order — a stronger guarantee than
 *    the old replay's "same order in, same numbers out".
 *  - **Every match still carries its own PRE-match prediction.** A played match
 *    is rated by a fit over only the matches strictly before it (`history`
 *    below), so a 2023 result reads as the forecast it would have been.
 *
 * The maths lives here and nowhere else. Pages and graphics consume it.
 */

import type { StatRow } from './types.ts';
import { seasonMatches, type MatchRecord } from './stats.ts';
import { loadStatRows } from './normalize.ts';
import { SITE } from '../config/site.ts';
import { solveSPD } from './linalg.ts';

/**
 * Model constants, chosen by `tune()` below over every match from S1 R1 to the
 * end of S4. Editorial in the same sense `currentSeason` is: numbers somebody
 * picked, recorded here so they can't drift, and re-checked by the test suite.
 */
export const MODEL = {
  /**
   * The win channel's temperature inside the fit. Higher makes the logistic
   * term insist harder that a favourite should have won, so results pull skills
   * apart faster relative to the stat channel. It sets the *scale* the skills
   * are solved on; `probScale` then reads a probability off that scale, and the
   * two are deliberately separate (see `probScale`).
   */
  winWeight: 6,
  /**
   * How much the net-stat margin counts, against the win result. At 1 the two
   * channels carry comparable weight. Zero would be plain regularised
   * Bradley-Terry (win/loss only), which backtests a little worse and loses the
   * "good player on a bad night's team" separation the stat term is here for.
   */
  statWeight: 1,
  /**
   * The ridge penalty — how hard a skill is pulled back toward the league mean
   * (zero, before the display shift). This is the sample-size fix: it costs the
   * fit `ridge × skill²` to move anyone off the mean, so a player only leaves it
   * as far as their matches actually justify. A thin sample can't pay the
   * penalty and stays near the middle; a heavy one barely feels it.
   */
  ridge: 4,
  /**
   * Recency, in matches: an observation `halfLife` matches back counts half as
   * much as the newest one. ~100 is a bit over two seasons (a season is ~43
   * matches), so last year still speaks nearly as loudly as this one while the
   * deep past fades. This is what recovers the in-season form that a flat global
   * fit throws away, and why the model beats the old Elo on accuracy instead of
   * merely matching it.
   */
  halfLife: 100,
  /**
   * The probability temperature — how confidently a skill gap is read as a
   * win chance, `P = σ(probScale × (skillA − skillB))`. Kept separate from
   * `winWeight` on purpose: which side is favoured, and whether a call is
   * right, depend only on the *sign* of the gap, so this never touches
   * accuracy. It only sets how bold the printed percentage is, and is tuned for
   * calibration (Brier) rather than for calls — the same split the old model
   * drew between `k` and `scale`.
   */
  probScale: 2,
  /** Display anchor: the rating a league-average skill is shown as. */
  displayMean: 1500,
  /**
   * Display spread: one standard deviation of the rated field is shown as this
   * many rating points, so the numbers read on a familiar ~1500 scale. Cosmetic
   * — it scales the printed rating and nothing the model decides.
   */
  displaySpread: 70,
} as const;

export interface FitOptions {
  winWeight?: number;
  statWeight?: number;
  ridge?: number;
  halfLife?: number | null;
}

/** A pair of players and the rating the model gives them. */
export interface PairRating {
  team: string;
  players: string[];
  /** Mean of the players' display ratings at that moment. */
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
  /** P(sides[0] wins), from the pair-skill difference. */
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

/** The fitted model: final ratings, and every match's pre-match prediction. */
export interface Model {
  /** Final raw skill per player, from a fit over the whole history. */
  skills: Map<string, number>;
  /** Display rating per player (the ~1500-scale number). */
  ratings: Map<string, number>;
  /** Matches each player contributed to — the bar for the power ratings. */
  appearances: Map<string, number>;
  /** Every played match, in playing order, as the model saw it beforehand. */
  matches: MatchPrediction[];
  /** Lookup by `MatchRecord.key`. */
  byKey: Map<string, MatchPrediction>;
  /** Affine map from raw skill to display rating: mean and sd of the field. */
  display: { mean: number; sd: number };
  /** The last season the fit saw. */
  lastSeason: number;
}

/** Logistic. */
function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/** P(a beats b) for two raw skills, on the model's probability scale. */
export function expectedScore(a: number, b: number): number {
  return sigmoid(MODEL.probScale * (a - b));
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
 * Errors` are the same events counted from both ends.
 *
 * Null when the match wasn't statted, which is not the same as zero — every
 * finals night on record bar Season 3's is a scoreline and nothing else. The
 * stat channel simply skips those matches rather than reading a blank as a nil.
 */
export function contribution(r: StatRow): number | null {
  if (r.winners === null && r.unforcedErrors === null) return null;
  const good = (r.winners ?? 0) + (r.aces ?? 0) + (r.errorsForced ?? 0);
  const bad = (r.unforcedErrors ?? 0) + (r.doubleFaults ?? 0);
  return good - bad;
}

// ---------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------

/**
 * One player's stat-channel observation: their own net-stat output for a match
 * should track their skill, net of the pair they faced.
 *
 *   z ≈ skill[self] − ½(skill[opp0] + skill[opp1])
 *
 * `self` is +1 in the design, each opponent −½, and `z` is the player's own
 * `contribution` per set, standardised. This is what separates two team-mates
 * who shared a result: their box scores differ, so their targets differ, so the
 * fit can rate the one who did the work above the one who was carried — the
 * direct fix for Elo's old "good player, bad team-mates" blind spot. Opponent
 * strength is priced through the opponents' own skills, not their box score, so
 * a big night against a strong pair means more than the same against a weak one
 * — the same signal the win channel uses, kept consistent between the two.
 */
interface StatObs {
  self: number;
  opp: [number, number];
  z: number;
}

/**
 * A match reduced to what the fit needs: the four player indices (two a side),
 * the win result, and each player's own stat-channel observation. Sides follow
 * `MatchRecord.sides` order — side A is the alphabetically-first team, so `y` is
 * P(that side won).
 */
interface FitMatch {
  a: [number, number];
  b: [number, number];
  /** 1 side A won, 0 side B won, 0.5 a match nobody was recorded as winning. */
  y: number;
  /** Per-player stat observations, one per statted player (0–4 of them). */
  stats: StatObs[];
}

/** The line-up a side is rated on: its players, minus the SINGLES sentinel. */
function lineup(m: MatchRecord, side: 0 | 1): StatRow[] {
  return m.sides[side].players.filter((p) => !p.isSingles);
}

/**
 * Everything the fit reads, built once: the global player index and the played,
 * two-a-side matches in playing order. Singles nights (no pair to rate) and
 * fixtures (no result) are left out here, so nothing downstream has to remember.
 */
interface Design {
  players: string[];
  index: Map<string, number>;
  matches: FitMatch[];
  records: MatchRecord[];
}

function buildDesign(rows: StatRow[]): Design {
  const all = seasonMatches(rows)
    .filter((m) => !m.scheduled)
    .sort((a, b) => a.season - b.season || a.round - b.round || a.key.localeCompare(b.key));

  const index = new Map<string, number>();
  const players: string[] = [];
  const idOf = (name: string): number => {
    let i = index.get(name);
    if (i === undefined) {
      i = players.length;
      players.push(name);
      index.set(name, i);
    }
    return i;
  };

  const matches: FitMatch[] = [];
  const records: MatchRecord[] = [];
  for (const m of all) {
    const la = lineup(m, 0);
    const lb = lineup(m, 1);
    // A pair a side, or it isn't a doubles result the model can rate.
    if (la.length !== 2 || lb.length !== 2) continue;

    const a: [number, number] = [idOf(la[0].player), idOf(la[1].player)];
    const b: [number, number] = [idOf(lb[0].player), idOf(lb[1].player)];
    const y = m.isDraw ? 0.5 : m.winner === m.sides[0].team ? 1 : 0;

    // One stat observation per statted player: their own net per set, against
    // the two players they faced. `RAW_STAT` is standardised into skill units
    // in `fitSkills`, once the training window's spread is known.
    const sets = m.sides[0].players[0]?.sets ?? 1;
    const stats: StatObs[] = [];
    const addStats = (own: StatRow[], self: [number, number], opp: [number, number]) => {
      own.forEach((r, i) => {
        const c = contribution(r);
        if (c !== null) stats.push({ self: self[i], opp, z: c / sets });
      });
    };
    addStats(la, a, b);
    addStats(lb, b, a);

    matches.push({ a, b, y, stats });
    records.push(m);
  }
  return { players, index, matches, records };
}

/** The spread of per-player net-stat outputs, to put the stat channel on skill units. */
function statScale(matches: FitMatch[]): number {
  const xs: number[] = [];
  for (const m of matches) for (const s of m.stats) xs.push(s.z);
  if (xs.length < 4) return 6;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varc = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  const sd = Math.sqrt(varc);
  return sd > 1e-6 ? sd : 6;
}

/**
 * Fit skills over `matches[0..upto)` by Newton's method, weighting recent
 * matches more heavily. `refPoint` is where "recent" is measured from — the
 * index just past the training window for a walk-forward prediction, and the
 * end of history for the final ratings.
 *
 * Every Newton step solves `H x = g` for the SPD Hessian `H` (the ridge term
 * `λI` guarantees definiteness), so the objective's single minimum is reached
 * in a handful of iterations. Because the problem is convex, the starting point
 * doesn't matter and neither does row order.
 */
function fitSkills(
  design: Design,
  upto: number,
  refPoint: number,
  opts: Required<FitOptions>
): Float64Array {
  const { winWeight, statWeight, ridge, halfLife } = opts;
  const n = design.players.length;
  const s = new Float64Array(n);
  if (upto === 0) return s;

  const sd = statScale(design.matches.slice(0, upto));
  const weight = (j: number): number =>
    halfLife === null || halfLife <= 0 ? 1 : 2 ** (-(refPoint - 1 - j) / halfLife);

  for (let iter = 0; iter < 12; iter++) {
    const g = new Float64Array(n);
    // Dense Hessian: n is one row per rated player, ~50 at most.
    const H: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let j = 0; j < upto; j++) {
      const m = design.matches[j];
      const w = weight(j);
      // c: the signed design coefficients, +0.5 for side A, −0.5 for side B.
      const idx = [m.a[0], m.a[1], m.b[0], m.b[1]];
      const c = [0.5, 0.5, -0.5, -0.5];
      let d = 0;
      for (let t = 0; t < 4; t++) d += c[t] * s[idx[t]];

      // Win channel: weighted logistic.
      const p = sigmoid(winWeight * d);
      const gWin = winWeight * w * (p - m.y);
      const hWin = winWeight * winWeight * w * p * (1 - p);
      for (let t = 0; t < 4; t++) {
        g[idx[t]] += gWin * c[t];
        for (let u = 0; u < 4; u++) H[idx[t]][idx[u]] += hWin * c[t] * c[u];
      }

      // Stat channel: weighted least squares on each player's own net output,
      // net of the pair they faced. Design coefficients are +1 on self and −½
      // on each opponent; the residual is `(skillSelf − oppMean) − z`.
      if (statWeight > 0) {
        for (const obs of m.stats) {
          const si = [obs.self, obs.opp[0], obs.opp[1]];
          const sc = [1, -0.5, -0.5];
          let pred = 0;
          for (let t = 0; t < 3; t++) pred += sc[t] * s[si[t]];
          const resid = pred - obs.z / sd;
          const gStat = 2 * statWeight * w * resid;
          const hStat = 2 * statWeight * w;
          for (let t = 0; t < 3; t++) {
            g[si[t]] += gStat * sc[t];
            for (let u = 0; u < 3; u++) H[si[t]][si[u]] += hStat * sc[t] * sc[u];
          }
        }
      }
    }

    // Ridge prior: pull every skill toward zero (the league mean).
    for (let i = 0; i < n; i++) {
      g[i] += ridge * s[i];
      H[i][i] += ridge;
    }

    const step = solveSPD(H, Array.from(g));
    let maxStep = 0;
    for (let i = 0; i < n; i++) {
      s[i] -= step[i];
      maxStep = Math.max(maxStep, Math.abs(step[i]));
    }
    if (maxStep < 1e-9) break;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Building the model
// ---------------------------------------------------------------------------

const resolve = (opts: FitOptions): Required<FitOptions> => ({
  winWeight: opts.winWeight ?? MODEL.winWeight,
  statWeight: opts.statWeight ?? MODEL.statWeight,
  ridge: opts.ridge ?? MODEL.ridge,
  halfLife: opts.halfLife === undefined ? MODEL.halfLife : opts.halfLife,
});

/** Mean and sd of the rated field's skills — the display affine's two numbers. */
function displayStats(
  skills: Float64Array,
  design: Design,
  appearances: Map<string, number>
): { mean: number; sd: number } {
  const vals: number[] = [];
  for (let i = 0; i < design.players.length; i++) {
    if ((appearances.get(design.players[i]) ?? 0) >= SITE.rankMinMatches) vals.push(skills[i]);
  }
  if (vals.length < 2) return { mean: 0, sd: 1 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varc = vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length;
  return { mean, sd: Math.sqrt(varc) || 1 };
}

/**
 * Fit the whole model: a final skill for every player from a fit over all of
 * history, plus each played match's reconstructed pre-match prediction from a
 * fit over only the matches before it. The per-match refits are what let a
 * historical page show the forecast it would have had — see `history`.
 */
export function fitModel(rows: StatRow[] = loadStatRows(), opts: FitOptions = {}): Model {
  const o = resolve(opts);
  const design = buildDesign(rows);
  const { players, matches, records } = design;

  const appearances = new Map<string, number>();
  for (const m of matches) {
    for (const i of [...m.a, ...m.b]) {
      const name = players[i];
      appearances.set(name, (appearances.get(name) ?? 0) + 1);
    }
  }

  // Final skills: one fit over everything, recency measured from the end.
  const finalSkills = fitSkills(design, matches.length, matches.length, o);
  const display = displayStats(finalSkills, design, appearances);
  const toRating = (skill: number) =>
    MODEL.displayMean + ((skill - display.mean) / display.sd) * MODEL.displaySpread;

  const skills = new Map<string, number>();
  const ratings = new Map<string, number>();
  players.forEach((name, i) => {
    skills.set(name, finalSkills[i]);
    ratings.set(name, toRating(finalSkills[i]));
  });

  const predictions = history(design, o, display, toRating);
  const lastSeason = records.length ? records[records.length - 1].season : 0;

  return {
    skills,
    ratings,
    appearances,
    matches: predictions,
    byKey: new Map(predictions.map((p) => [p.key, p])),
    display,
    lastSeason,
  };
}

/**
 * Every played match's PRE-match prediction, each from a fit over only the
 * matches strictly before it. That's the walk-forward reconstruction the
 * backtest and the match pages both read: the model's state the instant before
 * a match is a fit that has never seen it.
 */
function history(
  design: Design,
  o: Required<FitOptions>,
  display: { mean: number; sd: number },
  toRating: (skill: number) => number
): MatchPrediction[] {
  const { players, matches, records } = design;
  const out: MatchPrediction[] = [];

  for (let j = 0; j < matches.length; j++) {
    const s = fitSkills(design, j, j, o);
    const m = matches[j];
    const rec = records[j];

    const pair = (
      teamRows: StatRow[],
      team: string,
      idx: [number, number]
    ): PairRating => {
      const names = idx.map((i) => players[i]);
      const meanSkill = (s[idx[0]] + s[idx[1]]) / 2;
      const known = idx.filter((i) => j > 0 && seenBefore(design, i, j)).length;
      return { team, players: names, rating: toRating(meanSkill), known };
    };

    const sideA = pair(lineup(rec, 0), rec.sides[0].team, m.a);
    const sideB = pair(lineup(rec, 1), rec.sides[1].team, m.b);
    const skillA = (s[m.a[0]] + s[m.a[1]]) / 2;
    const skillB = (s[m.b[0]] + s[m.b[1]]) / 2;

    out.push(finish(rec, sideA, sideB, skillA, skillB, false));
  }
  return out;
}

/** Whether player `i` appears in any match before position `j`. */
function seenBefore(design: Design, i: number, j: number): boolean {
  for (let k = 0; k < j; k++) {
    const m = design.matches[k];
    if (m.a[0] === i || m.a[1] === i || m.b[0] === i || m.b[1] === i) return true;
  }
  return false;
}

/** Assemble a MatchPrediction from two rated sides and their raw skills. */
function finish(
  m: MatchRecord,
  sideA: PairRating,
  sideB: PairRating,
  skillA: number,
  skillB: number,
  scheduled: boolean
): MatchPrediction {
  const probability = expectedScore(skillA, skillB);
  const favourite =
    skillA === skillB ? null : skillA > skillB ? sideA.team : sideB.team;
  return {
    key: m.key,
    season: m.season,
    round: m.round,
    roundLabel: m.roundLabel,
    isFinals: m.isFinals,
    scheduled,
    sides: [sideA, sideB],
    probability,
    favourite,
    winner: m.winner,
    isDraw: m.isDraw,
    correct: scheduled || favourite === null || m.isDraw ? null : favourite === m.winner,
  };
}

// ---------------------------------------------------------------------------
// Predicting a match that hasn't been played
// ---------------------------------------------------------------------------

/** Rate a match against a given model — normally the site's final ratings. */
export function predictMatch(m: MatchRecord, model: Model): MatchPrediction {
  const skillOf = (name: string) => model.skills.get(name) ?? 0;
  const toRating = (skill: number) =>
    MODEL.displayMean + ((skill - model.display.mean) / model.display.sd) * MODEL.displaySpread;

  const side = (n: 0 | 1): { pair: PairRating; skill: number } => {
    const names = lineup(m, n).map((p) => p.player);
    const meanSkill = names.length
      ? names.reduce((s, p) => s + skillOf(p), 0) / names.length
      : 0;
    return {
      pair: {
        team: m.sides[n].team,
        players: names,
        rating: toRating(meanSkill),
        known: names.filter((p) => model.skills.has(p)).length,
      },
      skill: meanSkill,
    };
  };
  const a = side(0);
  const b = side(1);
  return finish(m, a.pair, b.pair, a.skill, b.skill, m.scheduled);
}

/** P(the first pair wins), for two named line-ups against a model's ratings. */
export function predictPair(a: string[], b: string[], model: Model): number {
  const skillOf = (name: string) => model.skills.get(name) ?? 0;
  const mean = (players: string[]) =>
    players.length ? players.reduce((s, p) => s + skillOf(p), 0) / players.length : 0;
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

function backtestFrom(model: Model): Backtest {
  const decided = model.matches.filter((m) => !m.isDraw);
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
    matches: model.matches,
  };
}

/**
 * How well the model has actually done, over the matches it was willing to
 * call. Matches where the two pairs rated exactly level — the opening round of
 * every redraft, four players the fit has never seen — are set aside from the
 * accuracy denominator (`levelled` counts them) rather than dressed up as
 * half-right. The Brier score keeps them: a 0.5 there is an honest forecast.
 */
export function backtest(rows: StatRow[] = loadStatRows(), opts: FitOptions = {}): Backtest {
  return backtestFrom(fitModel(rows, opts));
}

/** "104 of 166 matches (62.7%)" — the honest headline. */
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
  model: Model = siteModel(),
  minMatches = SITE.rankMinMatches
): RatedPlayer[] {
  return [...model.ratings.entries()]
    .map(([player, rating]) => ({
      player,
      rating,
      matches: model.appearances.get(player) ?? 0,
      rank: 0,
    }))
    .filter((p) => p.matches >= minMatches)
    .sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

/**
 * The four players the league would expect to see at the top — a face-validity
 * gate on the tuning, and an editorial judgement rather than something the data
 * discovered (the owner named these four before any rating existed). It earns
 * its keep because the rating goes on public display: a table that seats a
 * high-volume journeyman above four players everyone knows are better is wrong
 * in the way that matters, whatever it backtests. They are, independently, the
 * top four on career net stats per set — the very metric the stat channel is
 * built on — so the gate is less arbitrary than four names look.
 */
export const FACE_VALIDITY_NAMES = [
  'Luke Sharrock',
  'Adam Dickson',
  'Charlie Simpson',
  'Jonathan Kierce',
];
export const FACE_VALIDITY_TOP = 8;

/** Whether a rating puts all four of the above inside the top N. */
export function passesFaceValidity(table: RatedPlayer[], top = FACE_VALIDITY_TOP): boolean {
  const leaders = new Set(table.slice(0, top).map((p) => p.player));
  return FACE_VALIDITY_NAMES.every((n) => leaders.has(n));
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface TuneResult {
  opts: Required<FitOptions>;
  result: Backtest;
  table: RatedPlayer[];
  facesValid: boolean;
}

/**
 * Grid-search the model's fit constants. This is how the numbers in `MODEL`
 * were arrived at, and the test re-runs it so a season of new results can't
 * quietly leave them stale. It is not run at build time — the site imports the
 * tuned constants, not the search.
 *
 * Ranked on accuracy among settings that pass the face-validity gate, Brier
 * breaking ties: accuracy is the number anyone reads, but on ~166 matches it's
 * a step function, so several settings call the same matches right and the
 * better-calibrated one should win. Note `probScale` is not searched here — it
 * doesn't change any call (only the sign of the skill gap does), so it's tuned
 * separately for calibration and held fixed across the grid.
 */
export function tune(
  rows: StatRow[] = loadStatRows(),
  grid: {
    winWeight?: number[];
    statWeight?: number[];
    ridge?: number[];
    halfLife?: (number | null)[];
  } = {}
): TuneResult[] {
  const {
    winWeight: ws = [4, 6],
    statWeight: rs = [0, 1, 2],
    ridge: ls = [4, 8],
    halfLife: hs = [null, 60, 100],
  } = grid;

  const out: TuneResult[] = [];
  for (const winWeight of ws) {
    for (const statWeight of rs) {
      for (const ridge of ls) {
        for (const halfLife of hs) {
          const opts = { winWeight, statWeight, ridge, halfLife };
          const model = fitModel(rows, opts);
          const table = powerRankings(model);
          out.push({
            opts,
            result: backtestFrom(model),
            table,
            facesValid: passesFaceValidity(table),
          });
        }
      }
    }
  }

  return out.sort(
    (a, b) =>
      Number(b.facesValid) - Number(a.facesValid) ||
      b.result.accuracy - a.result.accuracy ||
      a.result.brier - b.result.brier ||
      a.opts.ridge - b.opts.ridge
  );
}

// ---------------------------------------------------------------------------
// The site's own model, fit once
// ---------------------------------------------------------------------------

let _model: Model | null = null;

/** The fit over the real CSV, computed once per build. */
export function siteModel(): Model {
  if (!_model) _model = fitModel();
  return _model;
}

/** A played match's reconstructed pre-match prediction, by `MatchRecord.key`. */
export function matchPrediction(key: string): MatchPrediction | undefined {
  return siteModel().byKey.get(key);
}

/**
 * The prediction to show for any match: the reconstructed one for a match
 * already played, and a fresh one off the current ratings for a fixture. A
 * fixture in a future season is predicted from the players' carried skills —
 * the ridge and the recency decay together are what keep a redrafted opener
 * from reading as a lock, so no separate between-season regression is applied.
 */
export function predictionFor(m: MatchRecord): MatchPrediction {
  const known = matchPrediction(m.key);
  if (known) return known;
  return predictMatch(m, siteModel());
}

/** The model's final ratings, for a caller that wants the raw map. */
export function ratingsFor(model: Model = siteModel()): Map<string, number> {
  return model.skills;
}
