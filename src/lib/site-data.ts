import { loadStatRows } from './normalize.ts';
import {
  allSeasons,
  ladderWithPairings,
  latestPlayedRound,
  nextScheduledRound,
  playedRows,
  scheduledRows,
  seasonMatches,
  seasonRounds,
  teamRoster,
  records,
  leaderboard,
  winStreaks,
  type MatchRecord,
  type SeasonRound,
  type TeamRoster,
} from './stats.ts';
import type { LadderRow, StatRow } from './types.ts';
import { getSeasonConfig, seasonTeamConfig } from '../config/seasons/index.ts';
import { seasonLabel } from '../config/site.ts';

/**
 * Everything in the CSV, fixtures included. Only the schedule, the match pages
 * and the prediction model want this — see `rows` below.
 */
export const allRows: StatRow[] = loadStatRows();

/**
 * The rows the site's statistics are built from: played matches only.
 *
 * This is deliberately the short name and the default export of the module,
 * because it's the safe one. Every page that counts anything — the ladder,
 * leaderboards, records, player panels — imports `rows` and gets no fixtures
 * in it without having to remember to ask.
 */
export const rows: StatRow[] = playedRows(allRows);

/** Every drawn-but-unplayed row. */
export const fixtures: StatRow[] = scheduledRows(allRows);

/**
 * The season's declared field, from its config — the ten S5 teams, say, even
 * before half of them have played. Falls back to whoever the CSV knows about.
 */
export function declaredTeams(season: number): string[] {
  const declared = Object.keys(getSeasonConfig(season)?.teams ?? {});
  return declared.length ? declared : seasonTeams(season);
}

/**
 * Every season the site builds a page for. Counts a season that has only been
 * drawn — the schedule is the first thing a new season has to show.
 */
export function siteSeasons(): number[] {
  return allSeasons(allRows);
}

/** Teams that appear in a season, drawn or played. */
export function seasonTeams(season: number): string[] {
  return [...new Set(allRows.filter((r) => r.season === season).map((r) => r.team))];
}

/** Rosters for every team in a season, keyed by team, config overrides applied. */
export function seasonRosters(season: number): Record<string, TeamRoster> {
  const out: Record<string, TeamRoster> = {};
  for (const team of declaredTeams(season)) {
    out[team] = teamRoster(team, season, rows, seasonTeamConfig(season, team));
  }
  return out;
}

/** Ladder with pairing labels already resolved. */
export function seasonLadder(season: number): LadderRow[] {
  return ladderWithPairings(
    season,
    allRows,
    (team) => seasonTeamConfig(season, team),
    declaredTeams(season)
  );
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Every match of a season, played and scheduled, in playing order. */
export function seasonSchedule(season: number): MatchRecord[] {
  return seasonMatches(allRows, season);
}

/** A season's rounds with their matches and byes, in playing order. */
export function seasonRoundList(season: number): SeasonRound[] {
  return seasonRounds(allRows, season, declaredTeams(season));
}

/**
 * The round the schedule carousel opens on: the latest one with results, or —
 * for a season yet to start — the first one drawn. No dates are involved, and
 * none exist in the data; "latest" means furthest through the fixture list.
 */
export function defaultScheduleRound(season: number): SeasonRound | null {
  return (
    latestPlayedRound(allRows, season) ??
    nextScheduledRound(allRows, season) ??
    null
  );
}

/** The next round with fixtures still to play, or null once a season is done. */
export function nextRound(season: number): SeasonRound | null {
  return nextScheduledRound(allRows, season);
}

/** Heading for the round, e.g. "Round 7", "Qualifying Finals", "The Final". */
const ROUND_HEADING: Record<string, string> = {
  QF: 'Qualifying Finals',
  SF: 'Semi Finals',
  F: 'The Final',
};

/** The display heading for a round, finals spelled out. */
export function roundHeading(round: SeasonRound): string {
  return round.stage ? ROUND_HEADING[round.stage] : `Round ${round.roundLabel}`;
}

/**
 * What the homepage shows under "latest": the most recent round with results,
 * or — for a season that hasn't started — the first round drawn. Returns the
 * round and whether it's a set of results or a set of fixtures, so the panel
 * can label itself honestly either way.
 */
export function headlineRound(season: number): {
  round: SeasonRound;
  heading: string;
  upcoming: boolean;
} | null {
  const round = defaultScheduleRound(season);
  if (!round) return null;
  return { round, heading: roundHeading(round), upcoming: !round.played };
}

export interface FunStat { kicker: string; headline: string; detail: string; }

/** Tabloid-voiced fun facts derived from the data, for the home rotator. */
export function funStats(): FunStat[] {
  const rec = records(rows);
  const out: FunStat[] = [];

  const w = rec.mostWinnersGame[0];
  if (w) out.push({
    kicker: 'Single-match record',
    headline: `${w.value} WINNERS. ONE NIGHT.`,
    detail: `${w.player} unloaded ${w.value} winners in a single match — ${seasonLabel(w.season)}, Round ${w.round} vs ${w.opponent}.`,
  });

  const a = rec.mostAcesGame[0];
  if (a && a.value > 0) out.push({
    kicker: 'Serve of the century',
    headline: `${a.value} ACES IN ONE MATCH.`,
    detail: `${a.player} had the radar gun humming — ${a.value} aces in one match back in ${seasonLabel(a.season)}.`,
  });

  const streak = winStreaks(rows)[0];
  if (streak && streak.streak > 1) out.push({
    kicker: 'Untouchable',
    headline: `${streak.streak} STRAIGHT. NO ANSWERS.`,
    detail: `${streak.player} once reeled off ${streak.streak} wins on the bounce — the longest streak in TNT history.`,
  });

  const df = rec.mostDoubleFaultsCareer[0];
  if (df && df.value > 0) out.push({
    kicker: 'The double-fault dossier',
    headline: `${df.value} DOUBLE FAULTS. AND COUNTING.`,
    detail: `${df.player} leads the all-time double-fault count with ${df.value}. Toss it higher.`,
  });

  const ue = rec.biggestUeGame[0];
  if (ue) out.push({
    kicker: 'Off day',
    headline: `${ue.value} UNFORCED. OUCH.`,
    detail: `${ue.player} sprayed ${ue.value} unforced errors in one match — ${seasonLabel(ue.season)}, Round ${ue.round}. It happens to everyone.`,
  });

  const wtu = leaderboard('winnerToUe', rows).filter((e) => e.games >= 8)[0];
  if (wtu) out.push({
    kicker: 'Clean hitter',
    headline: `${wtu.value.toFixed(2)} WINNERS PER ERROR.`,
    detail: `${wtu.player} owns the best career winner-to-unforced-error ratio of the regulars. Ruthless.`,
  });

  return out;
}

/** Deterministic-but-rotating pick, changes with each build day. */
export function rotatingFunStat(): FunStat | null {
  const list = funStats();
  if (!list.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  return list[day % list.length];
}

/**
 * The team whose colours a player wears right now.
 *
 * Counts a season that has only been drawn, which is the whole point: once the
 * draft is in the CSV, a player belongs to their new team even though they
 * haven't played a match for it. Everything statistical still reads `rows`;
 * this is a lookup for a colour.
 */
export function playerLatestTeam(player: string): string {
  const pr = allRows.filter((r) => !r.isSingles && r.player === player);
  if (!pr.length) return '';
  let best = pr[0];
  for (const r of pr) {
    if (r.season > best.season || (r.season === best.season && r.round > best.round)) best = r;
  }
  return best.team;
}

/** Seasons (numbers) a player has appeared in. */
export function playerSeasons(player: string): number[] {
  return [...new Set(rows.filter((r) => !r.isSingles && r.player === player).map((r) => r.season))].sort((a, b) => a - b);
}

export interface MvpRow { player: string; slug: string; team: string; votes: number; games: number }

/**
 * Season MVP vote tally (sum of votes), highest first. Home-and-away only.
 * Fill-in nights are excluded — those votes were earned for another team.
 */
export function seasonMvp(season: number): MvpRow[] {
  const byPlayer = new Map<string, { votes: number; games: number; team: string }>();
  for (const r of rows) {
    if (r.season !== season || r.isSingles || r.isFinals || r.isFillIn || r.votes === null) continue;
    const e = byPlayer.get(r.player) ?? { votes: 0, games: 0, team: r.team };
    e.votes += r.votes;
    e.games += 1;
    byPlayer.set(r.player, e);
  }
  return [...byPlayer.entries()]
    .map(([player, e]) => ({ player, slug: rows.find((r) => r.player === player)!.slug, ...e }))
    .sort((a, b) => b.votes - a.votes || b.games - a.games);
}
