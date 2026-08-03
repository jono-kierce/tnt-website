import type { LadderRow, MatchSide, StatRow } from './types.ts';
import { SITE } from '../config/site.ts';
import { shortName } from '../config/aliases.ts';
import { loadStatRows } from './normalize.ts';

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function allSeasons(rows: StatRow[] = loadStatRows()): number[] {
  return [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);
}

const matchKey = (r: { season: number; round: number; team: string; opponent: string }) =>
  `${r.season}|${r.round}|${r.team}|${r.opponent}`;

/**
 * Which matches an aggregate is built from.
 *
 * `regular` is the home-and-away season only. It's the scope for anything that
 * ranks players against each other on a raw total — career leaderboards, the
 * record books — because finals are played by eight teams, not eighteen, and
 * whoever went deepest would top every counting board on volume alone.
 *
 * `all` includes finals. It's the scope for win-loss, head-to-head, streaks and
 * every per-set rate, where the extra matches are the point and the set-based
 * denominator already handles the multi-set inflation.
 */
export type StatScope = 'regular' | 'all';

export const inScope = (r: StatRow, scope: StatScope): boolean =>
  scope === 'all' || !r.isFinals;

/**
 * Collapse per-player rows into one record per team-side of each match. Uses all
 * rows (including SINGLES GAME) so singles matches still count for the ladder.
 * Defaults to the home-and-away season: the ladder is what seeds the finals, so
 * it must never contain them.
 */
export function matchSides(
  rows: StatRow[],
  season?: number,
  scope: StatScope = 'regular'
): MatchSide[] {
  const seen = new Map<string, MatchSide>();
  for (const r of rows) {
    if (season !== undefined && r.season !== season) continue;
    if (!inScope(r, scope)) continue;
    const key = matchKey(r);
    if (seen.has(key)) continue;
    seen.set(key, {
      season: r.season,
      round: r.round,
      stage: r.stage,
      roundLabel: r.roundLabel,
      score: r.score,
      setScores: r.setScores,
      sets: r.sets,
      team: r.team,
      opponent: r.opponent,
      teamScore: r.teamScore,
      opponentScore: r.opponentScore,
      win: r.win,
    });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Rosters / pairings
// ---------------------------------------------------------------------------

export interface TeamRoster {
  team: string;
  season: number;
  /** Core members (the regular pairing), ordered by games played desc. */
  core: { player: string; games: number }[];
  /** Every player who logged a game for the team (incl. one-off subs). */
  all: { player: string; games: number; fillInGames: number }[];
  /** Display label, e.g. "L. Sharrock & A. Hume". */
  pairingName: string;
  captain?: string;
}

/**
 * Derive a team's roster for a season from the CSV. Team size varies by season,
 * so we don't assume pairs. Core members are those whose non-fill-in games reach
 * `coreMemberMinShare` of the team's matches — this separates the regular
 * pairing from one-off subs (some of which the CSV never flagged as fill-ins).
 * A season config may override the pairing label and set the captain.
 */
export function teamRoster(
  team: string,
  season: number,
  rows: StatRow[],
  override?: { pair?: string[]; captain?: string }
): TeamRoster {
  // Home-and-away only: the regular pairing is who turned up on Tuesdays, and
  // adding up to three finals would skew the core-member threshold.
  const teamRows = rows.filter(
    (r) => r.season === season && r.team === team && !r.isSingles && !r.isFinals
  );
  const matches = new Set(teamRows.map((r) => `${r.round}`)).size;
  const threshold = Math.max(2, Math.ceil(matches * SITE.coreMemberMinShare));

  const byPlayer = new Map<string, { games: number; fillInGames: number }>();
  for (const r of teamRows) {
    const e = byPlayer.get(r.player) ?? { games: 0, fillInGames: 0 };
    e.games += 1;
    if (r.isFillIn) e.fillInGames += 1;
    byPlayer.set(r.player, e);
  }

  const all = [...byPlayer.entries()]
    .map(([player, e]) => ({ player, ...e }))
    .sort((a, b) => b.games - a.games || a.player.localeCompare(b.player));

  const core = all
    .filter((p) => p.games - p.fillInGames >= threshold)
    .map((p) => ({ player: p.player, games: p.games }));

  const pairNames =
    override?.pair && override.pair.length
      ? override.pair
      : core.map((c) => c.player);

  return {
    team,
    season,
    core,
    all,
    pairingName: pairNames.map(shortName).join(' & '),
    captain: override?.captain,
  };
}

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

/**
 * Season ladder. Ranked by wins desc, then games ratio (for:against) desc.
 * `pairings` optionally supplies pairing labels (from teamRoster) per team.
 */
export function ladder(
  season: number,
  rows: StatRow[] = loadStatRows(),
  pairings?: Record<string, string>
): LadderRow[] {
  const sides = matchSides(rows, season);
  const teams = new Map<
    string,
    { matchesPlayed: number; wins: number; gamesFor: number; gamesAgainst: number }
  >();

  for (const s of sides) {
    const t = teams.get(s.team) ?? {
      matchesPlayed: 0,
      wins: 0,
      gamesFor: 0,
      gamesAgainst: 0,
    };
    t.matchesPlayed += 1;
    if (s.win) t.wins += 1;
    t.gamesFor += s.teamScore;
    t.gamesAgainst += s.opponentScore;
    teams.set(s.team, t);
  }

  const table: LadderRow[] = [...teams.entries()].map(([team, t]) => ({
    team,
    pairingName: pairings?.[team] ?? team,
    matchesPlayed: t.matchesPlayed,
    wins: t.wins,
    losses: t.matchesPlayed - t.wins,
    gamesFor: t.gamesFor,
    gamesAgainst: t.gamesAgainst,
    ratio: t.gamesAgainst === 0 ? t.gamesFor : t.gamesFor / t.gamesAgainst,
    rank: 0,
  }));

  table.sort(
    (a, b) => b.wins - a.wins || b.ratio - a.ratio || a.team.localeCompare(b.team)
  );
  table.forEach((row, i) => (row.rank = i + 1));
  return table;
}

// ---------------------------------------------------------------------------
// Player aggregates
// ---------------------------------------------------------------------------

/** Stats that accumulate during play, and can be missing from a given game. */
export const COUNTING_STATS = [
  'winners',
  'unforcedErrors',
  'aces',
  'doubleFaults',
  'forcedErrors',
  'errorsForced',
  'votes',
] as const;

export type CountingStat = (typeof COUNTING_STATS)[number];

/**
 * A running total plus its own denominators.
 *
 * Coverage varies per stat, not just per game: Errors Forced only exists from
 * S2, serve stats only in S1, and a finals night reconstructed from an
 * Instagram post might give up winners and unforced errors and nothing else.
 * Carrying the denominators alongside the total is what stops a missing cell
 * from quietly reading as a zero.
 */
export interface StatTally {
  /** Sum across the games where this stat was recorded. */
  total: number;
  /** Games that contributed to `total`. */
  games: number;
  /** Sets that contributed to `total` — the denominator for a per-set rate. */
  sets: number;
}

export type StatTallies = Record<CountingStat, StatTally>;

export interface PlayerAgg {
  player: string;
  slug: string;
  scope: StatScope;
  games: number;
  /** Sets played across those games. Two or three for a semi or final. */
  sets: number;
  /** How many of `games` were finals (0 when scope is 'regular'). */
  finalsGames: number;
  wins: number;
  losses: number;
  winPct: number;
  /** Per-stat totals with their own coverage. The source of every rate. */
  tally: StatTallies;
  /** Flat totals for convenience. null means "never recorded", not zero. */
  winners: number | null;
  unforcedErrors: number | null;
  aces: number | null;
  doubleFaults: number | null;
  forcedErrors: number | null;
  errorsForced: number | null;
  votes: number | null;
  winnerToUe: number | null;
  /** Votes are awarded per match, not per set, so this rate stays per game. */
  votesPerGame: number | null;
  bog: number;
  /** Serve % (S1 only): firstServeIn / (in + out). null outside S1 scope. */
  firstServeIn: number;
  firstServeOut: number;
  servePct: number | null;
}

export interface AggOptions {
  season?: number; // undefined = all-time
  includeFillIns?: boolean; // default false
  team?: string;
  /** Default 'all' — finals included. See StatScope. */
  scope?: StatScope;
}

/** Per-set rate for a counting stat. null when the stat was never recorded. */
export function perSet(agg: PlayerAgg, stat: CountingStat): number | null {
  const t = agg.tally[stat];
  return t.sets ? t.total / t.sets : null;
}

/**
 * True when a stat is missing from some of the games in scope — the cue for the
 * UI to show coverage rather than let a partial total pass as a complete one.
 */
export function isPartial(agg: PlayerAgg, stat: CountingStat): boolean {
  const t = agg.tally[stat];
  return t.games > 0 && t.games < agg.games;
}

const emptyTallies = (): StatTallies =>
  Object.fromEntries(
    COUNTING_STATS.map((s) => [s, { total: 0, games: 0, sets: 0 }])
  ) as StatTallies;

/** Aggregate a set of already-filtered rows for one player into a PlayerAgg. */
function aggregateRows(
  player: string,
  slug: string,
  rows: StatRow[],
  scope: StatScope
): PlayerAgg {
  const tally = emptyTallies();
  let wins = 0,
    sets = 0,
    finalsGames = 0,
    bog = 0;
  let fsIn = 0,
    fsOut = 0,
    serveGames = 0;

  for (const r of rows) {
    if (r.win) wins++;
    sets += r.sets;
    if (r.isFinals) finalsGames++;
    if (r.bog) bog++;

    for (const stat of COUNTING_STATS) {
      const v = r[stat];
      if (v === null) continue;
      const t = tally[stat];
      t.total += v;
      t.games += 1;
      t.sets += r.sets;
    }

    if (r.firstServeIn !== null || r.firstServeOut !== null) {
      fsIn += r.firstServeIn ?? 0;
      fsOut += r.firstServeOut ?? 0;
      serveGames++;
    }
  }

  const total = (s: CountingStat) => (tally[s].games ? tally[s].total : null);
  const games = rows.length;
  const winners = total('winners');
  const ue = total('unforcedErrors');

  return {
    player,
    slug,
    scope,
    games,
    sets,
    finalsGames,
    wins,
    losses: games - wins,
    winPct: games ? wins / games : 0,
    tally,
    winners,
    unforcedErrors: ue,
    aces: total('aces'),
    doubleFaults: total('doubleFaults'),
    forcedErrors: total('forcedErrors'),
    errorsForced: total('errorsForced'),
    votes: total('votes'),
    winnerToUe:
      winners === null ? null : ue ? winners / ue : winners > 0 ? Infinity : null,
    votesPerGame: tally.votes.games ? tally.votes.total / tally.votes.games : null,
    bog,
    firstServeIn: fsIn,
    firstServeOut: fsOut,
    servePct: serveGames && fsIn + fsOut > 0 ? fsIn / (fsIn + fsOut) : null,
  };
}

export function playerRows(
  player: string,
  rows: StatRow[],
  opts: AggOptions = {}
): StatRow[] {
  const { season, includeFillIns = false, team, scope = 'all' } = opts;
  return rows.filter(
    (r) =>
      !r.isSingles &&
      r.player === player &&
      inScope(r, scope) &&
      (season === undefined || r.season === season) &&
      (includeFillIns || !r.isFillIn) &&
      (team === undefined || r.team === team)
  );
}

export function playerAgg(
  player: string,
  rows: StatRow[],
  opts: AggOptions = {}
): PlayerAgg {
  const filtered = playerRows(player, rows, opts);
  const slug = filtered[0]?.slug ?? '';
  return aggregateRows(player, slug, filtered, opts.scope ?? 'all');
}

/** Canonical list of real players (excludes SINGLES GAME). */
export function allPlayers(rows: StatRow[] = loadStatRows()): string[] {
  return [...new Set(rows.filter((r) => !r.isSingles).map((r) => r.player))].sort(
    (a, b) => a.localeCompare(b)
  );
}

// ---------------------------------------------------------------------------
// Head to head (best / worst opponent)
// ---------------------------------------------------------------------------

/** One meeting between two players, from the first player's point of view. */
export interface H2HGame {
  season: number;
  round: number;
  /** "5", "QF", "SF", "Final". */
  roundLabel: string;
  isFinals: boolean;
  /** Scoreline from this player's point of view, e.g. "4-6 7-6(4) 6-1". */
  score: string;
  sets: number;
  setsWon: number;
  setsLost: number;
  /** The player's team that night. */
  team: string;
  /** The opponent's team that night. */
  opponentTeam: string;
  teamScore: number;
  opponentScore: number;
  win: boolean;
  /** The player was filling in. */
  fillIn: boolean;
  /** The opponent was filling in. */
  opponentFillIn: boolean;
}

/** A player's career record against one opponent. */
export interface HeadToHead {
  opponent: string;
  slug: string;
  meetings: number;
  wins: number;
  losses: number;
  winPct: number;
  gamesFor: number;
  gamesAgainst: number;
  /** gamesFor / gamesAgainst, guarded to gamesFor (as on the ladder). */
  ratio: number;
  /** Every meeting, oldest first. */
  games: H2HGame[];
}

/** Index every team-side of every fixture, so we can look up the other side. */
function fixtureSides(rows: StatRow[]): Map<string, StatRow[]> {
  const sides = new Map<string, StatRow[]>();
  for (const r of rows) {
    if (r.isSingles) continue;
    const key = matchKey(r);
    (sides.get(key) ?? sides.set(key, []).get(key)!).push(r);
  }
  return sides;
}

/**
 * A player's record against every opponent they've faced. Fill-in games count
 * on both sides — you still played them — and so do finals, which are the
 * meetings people actually remember. Sorted by meetings desc.
 */
export function headToHead(
  player: string,
  rows: StatRow[] = loadStatRows()
): HeadToHead[] {
  const sides = fixtureSides(rows);
  const byOpponent = new Map<string, HeadToHead>();

  for (const r of rows) {
    if (r.isSingles || r.player !== player) continue;
    const across = sides.get(`${r.season}|${r.round}|${r.opponent}|${r.team}`) ?? [];
    for (const o of across) {
      if (o.player === player) continue;
      const h =
        byOpponent.get(o.player) ??
        byOpponent
          .set(o.player, {
            opponent: o.player,
            slug: o.slug,
            meetings: 0,
            wins: 0,
            losses: 0,
            winPct: 0,
            gamesFor: 0,
            gamesAgainst: 0,
            ratio: 0,
            games: [],
          })
          .get(o.player)!;
      h.meetings += 1;
      if (r.win) h.wins += 1;
      else h.losses += 1;
      h.gamesFor += r.teamScore;
      h.gamesAgainst += r.opponentScore;
      h.games.push({
        season: r.season,
        round: r.round,
        roundLabel: r.roundLabel,
        isFinals: r.isFinals,
        score: r.score,
        sets: r.sets,
        setsWon: r.setsWon,
        setsLost: r.setsLost,
        team: r.team,
        opponentTeam: r.opponent,
        teamScore: r.teamScore,
        opponentScore: r.opponentScore,
        win: r.win,
        fillIn: r.isFillIn,
        opponentFillIn: o.isFillIn,
      });
    }
  }

  const out = [...byOpponent.values()];
  for (const h of out) {
    h.winPct = h.meetings ? h.wins / h.meetings : 0;
    h.ratio = h.gamesAgainst === 0 ? h.gamesFor : h.gamesFor / h.gamesAgainst;
    h.games.sort((a, b) => a.season - b.season || a.round - b.round);
  }
  return out.sort(
    (a, b) => b.meetings - a.meetings || a.opponent.localeCompare(b.opponent)
  );
}

/** Win% first, then games ratio; more meetings breaks a dead heat. */
const bestFirst = (a: HeadToHead, b: HeadToHead) =>
  b.winPct - a.winPct ||
  b.ratio - a.ratio ||
  b.meetings - a.meetings ||
  a.opponent.localeCompare(b.opponent);

const worstFirst = (a: HeadToHead, b: HeadToHead) =>
  a.winPct - b.winPct ||
  a.ratio - b.ratio ||
  b.meetings - a.meetings ||
  a.opponent.localeCompare(b.opponent);

export interface OpponentSplit {
  /** Meetings needed to qualify — chosen adaptively for this player. */
  minMeetings: number;
  best: HeadToHead;
  worst: HeadToHead;
}

/**
 * The opponents a player has the best and worst record against.
 *
 * The sample sizes here are small (nobody has faced the same opponent more than
 * six times), so a fixed threshold would either be meaningless or leave half
 * the field without a tile. Instead we take the highest bar between
 * `h2hPreferredMeetings` and `h2hMinMeetings` that still leaves two distinct
 * opponents to compare, and give up if even the floor can't manage that.
 */
export function bestWorstOpponent(
  player: string,
  rows: StatRow[] = loadStatRows()
): OpponentSplit | null {
  const all = headToHead(player, rows);
  const floor = SITE.h2hMinMeetings;

  let minMeetings = floor;
  for (let n = SITE.h2hPreferredMeetings; n >= floor; n--) {
    if (all.filter((h) => h.meetings >= n).length >= 2) {
      minMeetings = n;
      break;
    }
  }

  const qualified = all.filter((h) => h.meetings >= minMeetings);
  if (qualified.length < 2) return null;

  return {
    minMeetings,
    best: [...qualified].sort(bestFirst)[0],
    worst: [...qualified].sort(worstFirst)[0],
  };
}

// ---------------------------------------------------------------------------
// Per-season trend for a player (winners/game, UE/game)
// ---------------------------------------------------------------------------

export function playerTrend(
  player: string,
  rows: StatRow[],
  includeFillIns = false
) {
  return allSeasons(rows)
    .map((season) => {
      const agg = playerAgg(player, rows, { season, includeFillIns });
      return {
        season,
        games: agg.games,
        winnersPerSet: perSet(agg, 'winners') ?? 0,
        uePerSet: perSet(agg, 'unforcedErrors') ?? 0,
      };
    })
    .filter((t) => t.games > 0);
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export type LeaderStat = CountingStat | 'winPct' | 'winnerToUe' | 'bog';

/** Rates are compared across all matches; raw totals only over the H&A season. */
export const defaultScope = (stat: LeaderStat, perSet: boolean): StatScope =>
  perSet || stat === 'winPct' || stat === 'winnerToUe' ? 'all' : 'regular';

export interface LeaderOptions extends AggOptions {
  /** Rank on the per-set rate rather than the raw total. */
  perSet?: boolean;
  minGames?: number; // for rate boards
}

/**
 * Build a leaderboard for a stat. Returns players ranked desc by the metric.
 * Rate boards apply a minimum-games threshold so 2-game wonders don't win.
 *
 * Scope follows the metric unless you override it: a raw total counts the
 * home-and-away season only (finals would reward whoever went deepest), while
 * rates and win-loss metrics count everything, normalised per set.
 */
export function leaderboard(
  stat: LeaderStat,
  rows: StatRow[],
  opts: LeaderOptions = {}
): { player: string; slug: string; value: number; games: number; agg: PlayerAgg }[] {
  const { perSet: rate = false, minGames = SITE.perGameMinGames } = opts;
  const scope = opts.scope ?? defaultScope(stat, rate);
  const players = allPlayers(rows);

  const entries = players
    .map((p) => {
      const agg = playerAgg(p, rows, { ...opts, scope });
      return { player: p, slug: agg.slug, agg, games: agg.games };
    })
    .filter((e) => e.games > 0);

  const metric = (agg: PlayerAgg): number | null => {
    switch (stat) {
      case 'winPct':
        return agg.winPct;
      case 'winnerToUe':
        return agg.winnerToUe === Infinity ? agg.winners : agg.winnerToUe;
      case 'bog':
        return agg.bog;
      // Votes are awarded once per match however many sets it ran to.
      case 'votes':
        return rate ? agg.votesPerGame : agg.votes;
      default:
        return rate ? perSet(agg, stat) : agg[stat];
    }
  };

  return entries
    .map((e) => ({ ...e, value: metric(e.agg) }))
    .filter(
      (e): e is typeof e & { value: number } =>
        e.value !== null && (!rate || e.games >= minGames)
    )
    .sort((a, b) => b.value - a.value || b.games - a.games);
}

// ---------------------------------------------------------------------------
// Records (single-game and career extremes, streaks)
// ---------------------------------------------------------------------------

export interface GameRecord {
  player: string;
  slug: string;
  value: number;
  season: number;
  round: number;
  team: string;
  opponent: string;
}

/**
 * Best single-match performances. Home-and-away only: a semi or final runs to
 * three sets, so those nights would own every board on court time alone.
 * Games where the stat wasn't recorded are skipped, not counted as zero.
 */
function bestSingleGame(
  rows: StatRow[],
  pick: (r: StatRow) => number | null
): GameRecord[] {
  return rows
    .filter((r) => !r.isSingles && !r.isFillIn && !r.isFinals)
    .map((r) => ({
      player: r.player,
      slug: r.slug,
      value: pick(r),
      season: r.season,
      round: r.round,
      team: r.team,
      opponent: r.opponent,
    }))
    .filter((r): r is GameRecord => r.value !== null)
    .sort((a, b) => b.value - a.value);
}

/**
 * Longest win streak per player in chronological order. Finals count — a run
 * that survives September is the whole point of a streak.
 */
export function winStreaks(rows: StatRow[]) {
  // Map each player to their team-side results in order.
  const byPlayer = new Map<string, { win: boolean; season: number; round: number }[]>();
  const playerRowsAll = rows.filter((r) => !r.isSingles && !r.isFillIn);
  for (const r of playerRowsAll) {
    const arr = byPlayer.get(r.player) ?? [];
    arr.push({ win: r.win, season: r.season, round: r.round });
    byPlayer.set(r.player, arr);
  }
  const out: { player: string; slug: string; streak: number }[] = [];
  for (const [player, results] of byPlayer) {
    results.sort((a, b) => a.season - b.season || a.round - b.round);
    let best = 0,
      cur = 0;
    for (const g of results) {
      cur = g.win ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    out.push({
      player,
      slug: playerRowsAll.find((r) => r.player === player)!.slug,
      streak: best,
    });
  }
  return out.sort((a, b) => b.streak - a.streak);
}

export function records(rows: StatRow[] = loadStatRows()) {
  return {
    mostWinnersGame: bestSingleGame(rows, (r) => r.winners).slice(0, 5),
    mostAcesGame: bestSingleGame(rows, (r) => r.aces).slice(0, 5),
    biggestUeGame: bestSingleGame(rows, (r) => r.unforcedErrors).slice(0, 5),
    mostDoubleFaultsCareer: leaderboard('doubleFaults', rows, {}).slice(0, 5),
    longestWinStreaks: winStreaks(rows).slice(0, 5),
  };
}
