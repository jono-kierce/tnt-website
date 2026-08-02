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
 * Collapse per-player rows into one record per team-side of each match. Uses all
 * rows (including SINGLES GAME) so singles matches still count for the ladder.
 */
export function matchSides(rows: StatRow[], season?: number): MatchSide[] {
  const seen = new Map<string, MatchSide>();
  for (const r of rows) {
    if (season !== undefined && r.season !== season) continue;
    const key = matchKey(r);
    if (seen.has(key)) continue;
    seen.set(key, {
      season: r.season,
      round: r.round,
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
  const teamRows = rows.filter(
    (r) => r.season === season && r.team === team && !r.isSingles
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

export interface PlayerAgg {
  player: string;
  slug: string;
  games: number;
  wins: number;
  losses: number;
  winPct: number;
  winners: number;
  unforcedErrors: number;
  winnerToUe: number | null;
  aces: number;
  doubleFaults: number;
  forcedErrors: number;
  /** Errors Forced (S2+). null when no qualifying games in scope. */
  errorsForced: number | null;
  /** games in scope that are S2+ (denominator for errorsForced/game). */
  errorsForcedGames: number;
  /** Votes total across games where votes are recorded (not sealed/blank). */
  votes: number | null;
  votedGames: number;
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
}

/** Aggregate a set of already-filtered rows for one player into a PlayerAgg. */
function aggregateRows(player: string, slug: string, rows: StatRow[]): PlayerAgg {
  let wins = 0,
    winners = 0,
    ue = 0,
    aces = 0,
    df = 0,
    fe = 0,
    bog = 0;
  let ef = 0,
    efGames = 0;
  let votes = 0,
    votedGames = 0;
  let fsIn = 0,
    fsOut = 0,
    serveGames = 0;

  for (const r of rows) {
    if (r.win) wins++;
    winners += r.winners;
    ue += r.unforcedErrors;
    aces += r.aces;
    df += r.doubleFaults;
    fe += r.forcedErrors;
    if (r.bog) bog++;
    if (r.errorsForced !== null) {
      ef += r.errorsForced;
      efGames++;
    }
    if (r.votes !== null) {
      votes += r.votes;
      votedGames++;
    }
    if (r.firstServeIn !== null || r.firstServeOut !== null) {
      fsIn += r.firstServeIn ?? 0;
      fsOut += r.firstServeOut ?? 0;
      serveGames++;
    }
  }

  const games = rows.length;
  return {
    player,
    slug,
    games,
    wins,
    losses: games - wins,
    winPct: games ? wins / games : 0,
    winners,
    unforcedErrors: ue,
    winnerToUe: ue ? winners / ue : winners > 0 ? Infinity : null,
    aces,
    doubleFaults: df,
    forcedErrors: fe,
    errorsForced: efGames ? ef : null,
    errorsForcedGames: efGames,
    votes: votedGames ? votes : null,
    votedGames,
    votesPerGame: votedGames ? votes / votedGames : null,
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
  const { season, includeFillIns = false, team } = opts;
  return rows.filter(
    (r) =>
      !r.isSingles &&
      r.player === player &&
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
  return aggregateRows(player, slug, filtered);
}

/** Canonical list of real players (excludes SINGLES GAME). */
export function allPlayers(rows: StatRow[] = loadStatRows()): string[] {
  return [...new Set(rows.filter((r) => !r.isSingles).map((r) => r.player))].sort(
    (a, b) => a.localeCompare(b)
  );
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
        winnersPerGame: agg.games ? agg.winners / agg.games : 0,
        uePerGame: agg.games ? agg.unforcedErrors / agg.games : 0,
      };
    })
    .filter((t) => t.games > 0);
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export type LeaderStat =
  | 'winners'
  | 'unforcedErrors'
  | 'aces'
  | 'doubleFaults'
  | 'errorsForced'
  | 'votes'
  | 'winPct'
  | 'winnerToUe'
  | 'bog';

export interface LeaderOptions extends AggOptions {
  perGame?: boolean;
  minGames?: number; // for perGame boards
}

/**
 * Build a leaderboard for a stat. Returns players ranked desc by the metric.
 * Per-game boards apply a minimum-games threshold so 2-game wonders don't win.
 */
export function leaderboard(
  stat: LeaderStat,
  rows: StatRow[],
  opts: LeaderOptions = {}
): { player: string; slug: string; value: number; games: number; agg: PlayerAgg }[] {
  const { perGame = false, minGames = SITE.perGameMinGames } = opts;
  const players = allPlayers(rows);

  const entries = players
    .map((p) => {
      const agg = playerAgg(p, rows, opts);
      return { player: p, slug: agg.slug, agg, games: agg.games };
    })
    .filter((e) => e.games > 0);

  const metric = (agg: PlayerAgg): number | null => {
    switch (stat) {
      case 'winPct':
        return agg.winPct;
      case 'winnerToUe':
        return agg.winnerToUe === Infinity ? agg.winners : agg.winnerToUe;
      case 'errorsForced':
        return agg.errorsForced;
      case 'votes':
        return agg.votes;
      default: {
        const total = agg[stat] as number;
        if (!perGame) return total;
        const denom =
          stat === 'errorsForced' ? agg.errorsForcedGames : agg.games;
        return denom ? total / denom : null;
      }
    }
  };

  return entries
    .map((e) => ({ ...e, value: metric(e.agg) }))
    .filter(
      (e): e is typeof e & { value: number } =>
        e.value !== null &&
        (!perGame || e.games >= minGames)
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

function bestSingleGame(
  rows: StatRow[],
  pick: (r: StatRow) => number
): GameRecord[] {
  return rows
    .filter((r) => !r.isSingles && !r.isFillIn)
    .map((r) => ({
      player: r.player,
      slug: r.slug,
      value: pick(r),
      season: r.season,
      round: r.round,
      team: r.team,
      opponent: r.opponent,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Longest win streak per player across chronological (season, round) order. */
export function winStreaks(rows: StatRow[]) {
  const sides = matchSides(rows).sort(
    (a, b) => a.season - b.season || a.round - b.round
  );
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
