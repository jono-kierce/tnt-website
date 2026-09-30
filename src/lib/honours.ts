/**
 * Honours — what goes in a player's trophy cabinet.
 *
 * Derived wherever the CSV can prove it, configured only where it can't:
 *
 * - **Premiers / runners-up** are the two sides of the Final, off `win?` —
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
 * - **Stat titles** go to the season's leader in total winners, aces and
 *   errors forced — home-and-away, own team only.
 *
 * Nothing vote-derived is produced for a sealed season. Node-safe: the configs
 * are handed in (`import.meta.glob` doesn't exist in the renderer's process),
 * the same pattern as `InsightContext` in `insights.ts`.
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

export type HonourKind =
  | 'premiers'
  | 'minorPremiers'
  | 'runnersUp'
  | 'seasonMvp'
  | 'finalsMvp'
  | 'mvpPodium'
  | 'statTitle'
  | 'woodenSpoon';

/** Cabinet order: the most prestigious first, the spoon last. */
export const HONOUR_ORDER: HonourKind[] = [
  'premiers',
  'minorPremiers',
  'runnersUp',
  'seasonMvp',
  'finalsMvp',
  'mvpPodium',
  'statTitle',
  'woodenSpoon',
];

/** The stats a season title is awarded for — the good ones, as season totals. */
export const TITLE_STATS = ['winners', 'aces', 'errorsForced'] as const satisfies readonly CountingStat[];
export type TitleStat = (typeof TITLE_STATS)[number];

export interface Honour {
  kind: HonourKind;
  player: string;
  season: number;
  /** The team it was won with — team honours, and the MVP's side. */
  team?: string;
  /** The rest of the side for a team honour; the co-winners of a shared MVP. */
  partners?: string[];
  /** 2 or 3, on the MVP podium. */
  place?: 2 | 3;
  /** Which board, for a stat title; `value` is the season total that won it. */
  stat?: TitleStat;
  value?: number;
  /** Won it having turned out as a fill-in (a Final's stand-in). */
  asFillIn?: boolean;
}

export interface HonoursContext {
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

/** Every honour awarded in one season, one entry per player per honour. */
export function seasonHonours(season: number, ctx: HonoursContext): Honour[] {
  const played = ctx.rows.filter(
    (r) => isPlayed(r) && r.season === season && !r.isSingles
  );
  const out: Honour[] = [];

  // --- The Final: both sides of it ------------------------------------------
  const final = played.filter((r) => r.stage === 'F');
  for (const r of final) {
    const side = final.filter((o) => o.team === r.team);
    out.push({
      kind: r.win ? 'premiers' : 'runnersUp',
      player: r.player,
      season,
      team: r.team,
      partners: side.filter((o) => o.player !== r.player).map((o) => o.player),
      ...(r.isFillIn ? { asFillIn: true } : {}),
    });
  }

  const complete = homeAndAwayComplete(season, ctx.rows);

  // --- The ladder: top and bottom -------------------------------------------
  if (complete) {
    const table = ladder(season, ctx.rows, undefined, ctx.declaredTeams, ctx.withdrawnTeams);
    const ends: [HonourKind, string | undefined][] = [
      ['minorPremiers', table[0]?.team],
      ['woodenSpoon', table.length > 1 ? table[table.length - 1].team : undefined],
    ];
    for (const [kind, team] of ends) {
      if (!team) continue;
      // The regular pairing, not whoever subbed in once — `core` already
      // drops the unflagged one-night stand-ins.
      const core = teamRoster(team, season, ctx.rows).core.map((c) => c.player);
      for (const player of core) {
        out.push({ kind, player, season, team, partners: core.filter((p) => p !== player) });
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
    const teamOf = (p: string) => tally.find((t) => t.player === p)?.team;
    for (const player of mvps) {
      const shared = mvps.filter((p) => p !== player);
      out.push({ kind: 'seasonMvp', player, season, team: teamOf(player), ...(shared.length ? { partners: shared } : {}) });
    }

    // Standard competition ranking: 41, 40, 40 is a first and two seconds,
    // and nobody third.
    if (tally.length && sameSet(mvps, tallyLeaders)) {
      for (const t of tally) {
        const place = 1 + tally.filter((o) => o.votes > t.votes).length;
        if (place === 2 || place === 3) {
          out.push({ kind: 'mvpPodium', player: t.player, season, team: t.team, place });
        }
      }
    }

    for (const player of configPlayers(ctx.config, /finals mvp/i) ?? []) {
      out.push({ kind: 'finalsMvp', player, season, team: final.find((r) => r.player === player)?.team });
    }
  }

  // --- Stat titles ----------------------------------------------------------
  if (complete) {
    for (const stat of TITLE_STATS) {
      // Led on the season *total*: a season award rewards turning up every
      // Tuesday, not the best rate over a short stint. Won for your own team
      // in the home-and-away — no finals (extra sets only some players get)
      // and no fill-in nights (those were played for somebody else).
      const board = leaderboard(stat, played, {
        season,
        scope: 'regular',
        includeFillIns: false,
      });
      const best = board[0]?.value;
      if (!best) continue;
      for (const e of board.filter((b) => b.value === best)) {
        out.push({ kind: 'statTitle', player: e.player, season, stat, value: e.value });
      }
    }
  }

  return out;
}

/** One player's cabinet: their honours in cabinet order, then by season. */
export function playerHonours(player: string, all: Honour[]): Honour[] {
  const rank = (h: Honour) => HONOUR_ORDER.indexOf(h.kind);
  const statRank = (h: Honour) => (h.stat ? TITLE_STATS.indexOf(h.stat) : 0);
  return all
    .filter((h) => h.player === player)
    .sort((a, b) => rank(a) - rank(b) || a.season - b.season || (a.place ?? 0) - (b.place ?? 0) || statRank(a) - statRank(b));
}
