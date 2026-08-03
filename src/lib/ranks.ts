/**
 * Where a player sits in the field, for the badges on the stat panel.
 *
 * Everything here is derived, per scope and per mode, from the same aggregates
 * the panel already shows — so a badge can never disagree with the number it
 * sits under. Two rules keep the boards honest:
 *
 *  - A player needs `rankMinMatches` in the window to be ranked at all. Below
 *    that they get no badges AND they're kept out of everyone else's field, so
 *    a one-night cameo can't flatter or dent anybody's percentile.
 *  - Totals rank on the home-and-away season and rates rank across everything
 *    per set, exactly as the leaderboards do. Only the rates carry tiers: a
 *    total says as much about how many seasons you've played as how well, so
 *    its board is worth a top-five mention and no grade.
 */
import { SITE } from '../config/site.ts';
import { allPlayers, perSet, playerAgg, type CountingStat, type PlayerAgg } from './stats.ts';
import type { StatRow } from './types.ts';

/** Totals, or per-set (per-match for the awards). */
export type RankMode = 'total' | 'rate';

export type Tier = 'elite' | 'above' | 'average' | 'below' | 'shocking';

/** Every metric that can carry a badge. */
export const RANK_METRICS = [
  'games',
  'winPct',
  'finalsWinPct',
  'winners',
  'unforcedErrors',
  'winnerToUe',
  'aces',
  'doubleFaults',
  'errorsForced',
  'votes',
  'finalsVotes',
  'bog',
] as const;

export type RankMetric = (typeof RANK_METRICS)[number];

/**
 * Metrics where topping the board is the bad news. The rank still reads the
 * same way the record books do — #1 is the most double faults — but the tier
 * flips, so leading this field is styled as the disgrace it is.
 */
const LOWER_IS_BETTER = new Set<RankMetric>(['unforcedErrors', 'doubleFaults']);

/** Counting stats that simply switch between their total and their per-set rate. */
const PER_SET_STATS = new Set<RankMetric>([
  'winners',
  'unforcedErrors',
  'aces',
  'doubleFaults',
  'errorsForced',
]);

export interface RankBadge {
  metric: RankMetric;
  /** 1-based, ties sharing the better rank. #1 is always the biggest number. */
  rank: number;
  /** How many players were ranked on this metric. */
  of: number;
  /**
   * null on the totals boards, and whenever the field was too small to split.
   * A career total is mostly a record of how many Tuesdays you turned up to, so
   * ranking one against the field is fair but grading it isn't: totals get a
   * top-five badge and nothing else.
   */
  tier: Tier | null;
  /** True for errors and double faults, where #1 is the last place you want. */
  lowerIsBetter: boolean;
}

/** The three aggregates every metric is read from. */
interface PlayerAggs {
  player: string;
  all: PlayerAgg;
  regular: PlayerAgg;
  finals: PlayerAgg;
}

export type RankTable = Record<RankMode, Map<string, Partial<Record<RankMetric, RankBadge>>>>;

/**
 * One player's value for a metric, or null when it doesn't apply to them —
 * never recorded, or a record they don't have (no finals, no home-and-away).
 */
function metricValue(a: PlayerAggs, metric: RankMetric, mode: RankMode): number | null {
  if (PER_SET_STATS.has(metric)) {
    const stat = metric as CountingStat;
    return mode === 'total' ? a.regular[stat] : perSet(a.all, stat);
  }
  switch (metric) {
    case 'games':
      return a.all.games;
    case 'winPct':
      return a.regular.games ? a.regular.winPct : null;
    case 'finalsWinPct':
      return a.finals.games ? a.finals.winPct : null;
    // A player with winners and no errors at all is off the scale; rank them
    // on the winners, as the leaderboards do.
    case 'winnerToUe':
      return a.all.winnerToUe === Infinity ? a.all.winners : a.all.winnerToUe;
    // Votes and BOG are awarded once a match however many sets it ran to.
    case 'votes':
      return mode === 'total' ? a.regular.votes : a.regular.votesPerGame;
    case 'bog':
      return mode === 'total' ? a.all.bog : a.all.games ? a.all.bog / a.all.games : null;
    // The Finals MVP is a count over at most three matches — no rate.
    case 'finalsVotes':
      return a.finals.votes;
    default:
      return null;
  }
}

function tierFor(rank: number, of: number, lowerIsBetter: boolean): Tier | null {
  if (of < SITE.rankMinField) return null;
  // Count from the good end — for errors and double faults that's the bottom.
  const place = lowerIsBetter ? of - rank + 1 : rank;
  // Band sizes in players, never smaller than one: whoever leads a nine-player
  // field is elite, even though one ninth is more than the top tenth.
  const cut = (share: number) => Math.max(1, Math.round(of * share));
  const t = SITE.rankTiers;
  if (place <= cut(t.elite)) return 'elite';
  if (place <= cut(t.above)) return 'above';
  if (place <= cut(t.average)) return 'average';
  if (place <= cut(t.below)) return 'below';
  return 'shocking';
}

function buildTable(rows: StatRow[], season: number | undefined): RankTable {
  // Fill-in appearances are excluded, as everywhere else a player is compared
  // with the field. One aggregate set per player, reused by every metric.
  const field: PlayerAggs[] = allPlayers(rows)
    .map((player) => ({
      player,
      all: playerAgg(player, rows, { season }),
      regular: playerAgg(player, rows, { season, scope: 'regular' }),
      finals: playerAgg(player, rows, { season, scope: 'finals' }),
    }))
    .filter((a) => a.all.games >= SITE.rankMinMatches);

  const table: RankTable = { total: new Map(), rate: new Map() };
  for (const mode of ['total', 'rate'] as const) {
    for (const a of field) table[mode].set(a.player, {});

    for (const metric of RANK_METRICS) {
      const scored = field
        .map((a) => ({ player: a.player, value: metricValue(a, metric, mode) }))
        .filter((e): e is { player: string; value: number } => e.value !== null)
        .sort((x, y) => y.value - x.value);

      const of = scored.length;
      const lowerIsBetter = LOWER_IS_BETTER.has(metric);
      scored.forEach((e, i) => {
        // Ties share the better rank: 1, 2, 2, 4.
        const rank = i > 0 && scored[i - 1].value === e.value
          ? table[mode].get(scored[i - 1].player)![metric]!.rank
          : i + 1;
        table[mode].get(e.player)![metric] = {
          metric,
          rank,
          of,
          tier: mode === 'rate' ? tierFor(rank, of, lowerIsBetter) : null,
          lowerIsBetter,
        };
      });
    }
  }
  return table;
}

/**
 * One table per (row set, scope), built once and reused by every player page.
 * Keyed on the row array itself so a different data set — a test fixture, say —
 * can never be served another one's ranks.
 */
const cache = new WeakMap<StatRow[], Map<string, RankTable>>();

export function rankTable(rows: StatRow[], season?: number): RankTable {
  const key = season === undefined ? 'all' : String(season);
  const forRows = cache.get(rows) ?? cache.set(rows, new Map()).get(rows)!;
  const hit = forRows.get(key);
  if (hit) return hit;
  const built = buildTable(rows, season);
  forRows.set(key, built);
  return built;
}

/**
 * A player's badges for one scope, keyed by mode. An empty pair of maps means
 * they haven't played enough in this window to be ranked.
 */
export function playerRanks(
  player: string,
  rows: StatRow[],
  season?: number
): Record<RankMode, Partial<Record<RankMetric, RankBadge>>> {
  const table = rankTable(rows, season);
  return {
    total: table.total.get(player) ?? {},
    rate: table.rate.get(player) ?? {},
  };
}
