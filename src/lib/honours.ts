/**
 * Honours — what goes in a player's trophy cabinet.
 *
 * Derived wherever the CSV can prove it, configured only where it can't:
 *
 * - **Champions / runners-up** are the two sides of the Final, off `win?` —
 *   never off counting sets (S4 R9 is why).
 * - **Minor premiers / wooden spoon** are the top and bottom of the ladder,
 *   once the home-and-away season is over. Before that they're a position,
 *   not an honour.
 * - **Season MVP / Finals MVP** are awards, announced on the night, so they
 *   come from the season config's `players`. S1's MVP was a three-way tie that
 *   counted Player-of-the-Round, which the tally can't reproduce; most finals
 *   carry no votes at all. A season with no config names falls back to the
 *   tally leader, so awards night needs no code change.
 * - **MVP podium** (2nd and 3rd) comes off the tally — but only where the
 *   tally agrees with the award, since a podium under the wrong winner is
 *   worse than none. That rules S1 out, which is right: its award wasn't a
 *   count.
 * - **Stat leaders** are the season's leaders in total winners, aces and
 *   errors forced — home-and-away, own team only, and not counting matches
 *   against a team that withdrew (the same strike the ladder and MVP apply).
 *
 * Nothing vote-derived is produced for a sealed season. Node-safe: the configs
 * are handed in (`import.meta.glob` doesn't exist in the renderer's process),
 * the same pattern as `InsightContext` in `insights.ts`.
 *
 * Named `Award` rather than `Honour` so it can't be confused with the season
 * config's `Honour` — the free-text entry on a season page.
 */
import {
  isPlayed,
  ladder,
  leaderboard,
  mvpTally,
  teamRoster,
  type CountingStat,
} from './stats.ts';
import type { StatRow } from './types.ts';
import type { SeasonConfig } from '../config/seasons/schema.ts';

export type AwardKind =
  | 'champions'
  | 'minorPremiers'
  | 'runnerUp'
  | 'seasonMvp'
  | 'finalsMvp'
  | 'mvpPodium'
  | 'statLeader'
  | 'woodenSpoon';

/** Cabinet order: the most prestigious first, the spoon last. */
export const AWARD_ORDER: AwardKind[] = [
  'champions',
  'minorPremiers',
  'runnerUp',
  'seasonMvp',
  'finalsMvp',
  'mvpPodium',
  'statLeader',
  'woodenSpoon',
];

/** The stats a season is led in — the good ones, as season totals. */
export const LEADER_STATS = ['winners', 'aces', 'errorsForced'] as const satisfies readonly CountingStat[];
export type LeaderStat = (typeof LEADER_STATS)[number];

export interface Award {
  kind: AwardKind;
  player: string;
  season: number;
  /** The team it was won with — team honours, and the MVP's side. */
  team?: string;
  /** The rest of the side for a team honour; the co-winners of a shared MVP. */
  partners?: string[];
  /** 2 or 3, on the MVP podium. */
  place?: 2 | 3;
  /** Which board, for a stat leader. */
  stat?: LeaderStat;
  /**
   * The number that won it: the season total for a stat leader, votes for an
   * MVP or podium place. Left off an MVP the tally didn't pick (S1's).
   */
  value?: number;
  /** The team's home-and-away record, for a ladder honour: "7–1". */
  record?: string;
  /** The Final itself, for champions and runners-up. */
  final?: { opponent: string; round: number; score: string };
  /** Won it having turned out as a fill-in (a Final's stand-in). */
  asFillIn?: boolean;
}

export interface AwardsContext {
  /** Played and scheduled rows, votes already struck — the site's `allRows`. */
  rows: StatRow[];
  config?: SeasonConfig;
  declaredTeams: string[];
  withdrawnTeams: string[];
  sealed: boolean;
}

/**
 * The home-and-away season is over: something was played and nothing drawn
 * is left. The finals don't count toward this — the minor premiership is
 * settled before they start.
 */
export function homeAndAwayComplete(season: number, rows: StatRow[]): boolean {
  const regular = rows.filter((r) => r.season === season && !r.isFinals && !r.isSingles);
  return regular.some(isPlayed) && !regular.some((r) => !isPlayed(r));
}

/** The names a config honour lists, matched on its title. */
function configPlayers(cfg: SeasonConfig | undefined, title: RegExp): string[] | undefined {
  const players = cfg?.honours.find((h) => title.test(h.title))?.players;
  return players?.length ? players : undefined;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Every award handed out in one season, one entry per player per award. */
export function seasonAwards(season: number, ctx: AwardsContext): Award[] {
  const played = ctx.rows.filter(
    (r) => isPlayed(r) && r.season === season && !r.isSingles
  );
  const out: Award[] = [];

  // --- The Final: both sides of it ------------------------------------------
  const final = played.filter((r) => r.stage === 'F');
  for (const r of final) {
    const side = final.filter((o) => o.team === r.team);
    out.push({
      kind: r.win ? 'champions' : 'runnerUp',
      player: r.player,
      season,
      team: r.team,
      partners: side.filter((o) => o.player !== r.player).map((o) => o.player),
      final: { opponent: r.opponent, round: r.round, score: r.score },
      ...(r.isFillIn ? { asFillIn: true } : {}),
    });
  }

  const complete = homeAndAwayComplete(season, ctx.rows);

  // --- The ladder: top and bottom -------------------------------------------
  if (complete) {
    const table = ladder(season, ctx.rows, undefined, ctx.declaredTeams, ctx.withdrawnTeams);
    const ends: [AwardKind, (typeof table)[number] | undefined][] = [
      ['minorPremiers', table[0]],
      ['woodenSpoon', table.length > 1 ? table[table.length - 1] : undefined],
    ];
    for (const [kind, row] of ends) {
      if (!row) continue;
      // The regular pairing, not whoever subbed in once — `core` already
      // drops the unflagged one-night stand-ins.
      const core = teamRoster(row.team, season, ctx.rows).core.map((c) => c.player);
      for (const player of core) {
        out.push({
          kind,
          player,
          season,
          team: row.team,
          partners: core.filter((p) => p !== player),
          record: `${row.wins}–${row.losses}`,
        });
      }
    }
  }

  // --- Votes: MVP, podium, Finals MVP ---------------------------------------
  // All of it waits for the seal to come off. The configured names would be
  // empty until awards night anyway; this makes sure the tally fallback can't
  // spill a live race either.
  if (!ctx.sealed) {
    const tally = complete ? mvpTally(season, ctx.rows) : [];
    const topVotes = tally[0]?.votes;
    const tallyLeaders = tally.filter((t) => t.votes === topVotes).map((t) => t.player);
    const mvps = configPlayers(ctx.config, /season mvp/i) ?? tallyLeaders;
    const counted = tally.length > 0 && sameSet(mvps, tallyLeaders);
    for (const player of mvps) {
      const shared = mvps.filter((p) => p !== player);
      out.push({
        kind: 'seasonMvp',
        player,
        season,
        team: tally.find((t) => t.player === player)?.team,
        ...(shared.length ? { partners: shared } : {}),
        // Only when the count is what decided it — S1's wasn't.
        ...(counted ? { value: topVotes } : {}),
      });
    }

    // Standard competition ranking: 41, 40, 40 is a first and two seconds,
    // and nobody third.
    if (counted) {
      for (const t of tally) {
        const place = 1 + tally.filter((o) => o.votes > t.votes).length;
        if (place === 2 || place === 3) {
          out.push({ kind: 'mvpPodium', player: t.player, season, team: t.team, place, value: t.votes });
        }
      }
    }

    for (const player of configPlayers(ctx.config, /finals mvp/i) ?? []) {
      out.push({ kind: 'finalsMvp', player, season, team: final.find((r) => r.player === player)?.team });
    }
  }

  // --- Stat leaders ---------------------------------------------------------
  if (complete) {
    // Matches against a team that withdrew are struck, as they are from the
    // ladder and the MVP count. Without that, S5's Green, Navy and White
    // (nine home-and-away matches each, one of them against Black) would
    // start a match ahead of a field that played eight.
    const gone = new Set(ctx.withdrawnTeams);
    const counting = played.filter((r) => !gone.has(r.opponent));
    for (const stat of LEADER_STATS) {
      // Led on the season *total*: a season award rewards turning up every
      // Tuesday, not the best rate over a short stint. Won for your own team
      // in the home-and-away — no finals (extra sets only some players get)
      // and no fill-in nights (those were played for somebody else).
      const board = leaderboard(stat, counting, {
        season,
        scope: 'regular',
        includeFillIns: false,
      });
      const best = board[0]?.value;
      if (!best) continue;
      for (const e of board.filter((b) => b.value === best)) {
        out.push({ kind: 'statLeader', player: e.player, season, stat, value: e.value });
      }
    }
  }

  return out;
}

/** One player's cabinet: their awards in cabinet order, then by season. */
export function playerAwards(player: string, all: Award[]): Award[] {
  const rank = (a: Award) => AWARD_ORDER.indexOf(a.kind);
  const statRank = (a: Award) => (a.stat ? LEADER_STATS.indexOf(a.stat) : 0);
  return all
    .filter((a) => a.player === player)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.season - b.season ||
        (a.place ?? 0) - (b.place ?? 0) ||
        statRank(a) - statRank(b)
    );
}
