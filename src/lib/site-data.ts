import { loadStatRows } from './normalize.ts';
import { ladderWithPairings, teamRoster, records, leaderboard, winStreaks, type TeamRoster } from './stats.ts';
import type { LadderRow, StatRow } from './types.ts';
import { seasonTeamConfig } from '../config/seasons/index.ts';
import { seasonLabel } from '../config/site.ts';

export const rows: StatRow[] = loadStatRows();

/** Teams that appear in a season, in ladder order. */
export function seasonTeams(season: number): string[] {
  return [...new Set(rows.filter((r) => r.season === season).map((r) => r.team))];
}

/** Rosters for every team in a season, keyed by team, config overrides applied. */
export function seasonRosters(season: number): Record<string, TeamRoster> {
  const out: Record<string, TeamRoster> = {};
  for (const team of seasonTeams(season)) {
    out[team] = teamRoster(team, season, rows, seasonTeamConfig(season, team));
  }
  return out;
}

/** Ladder with pairing labels already resolved. */
export function seasonLadder(season: number): LadderRow[] {
  return ladderWithPairings(season, rows, (team) => seasonTeamConfig(season, team));
}

export interface Fixture {
  winner: string;
  loser: string;
  /** Scoreline from the winner's point of view, e.g. "6-4" or "6-4 7-6(3)". */
  score: string;
  /** Sets won–lost by the winner. Only worth showing for a multi-set tie. */
  setsWon: number;
  setsLost: number;
}

/** Heading for the round, e.g. "Round 7", "Qualifying Finals", "The Final". */
const ROUND_HEADING: Record<string, string> = {
  QF: 'Qualifying Finals',
  SF: 'Semi Finals',
  F: 'The Final',
};

/**
 * The latest round's results for a season, one row per fixture (winner first).
 * Finals sort after the home-and-away rounds, so once they're in the CSV this
 * follows the season through to the final.
 */
export function latestRound(season: number): {
  round: number;
  label: string;
  fixtures: Fixture[];
} {
  const seasonRows = rows.filter((r) => r.season === season);
  if (!seasonRows.length) return { round: 0, label: '', fixtures: [] };
  const maxRound = Math.max(...seasonRows.map((r) => r.round));
  const latest = seasonRows.filter((r) => r.round === maxRound);
  const stage = latest[0].stage;
  const label = stage ? ROUND_HEADING[stage] : `Round ${maxRound}`;

  const sides = new Map<string, StatRow>();
  for (const r of latest) {
    const key = `${r.team}|${r.opponent}`;
    if (!sides.has(key)) sides.set(key, r);
  }

  const fixtures: Fixture[] = [];
  const used = new Set<string>();
  for (const s of sides.values()) {
    const pairKey = [s.team, s.opponent].sort().join('|');
    if (used.has(pairKey)) continue;
    used.add(pairKey);
    // Always describe the fixture from the winning side's row, so the
    // scoreline reads in the winner's favour.
    const w = s.win ? s : sides.get(`${s.opponent}|${s.team}`) ?? s;
    fixtures.push({
      winner: w.win ? w.team : w.opponent,
      loser: w.win ? w.opponent : w.team,
      score: w.score,
      setsWon: w.win ? w.setsWon : w.setsLost,
      setsLost: w.win ? w.setsLost : w.setsWon,
    });
  }
  return { round: maxRound, label, fixtures };
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

/** The team a player most recently played for (for colour/theming). */
export function playerLatestTeam(player: string): string {
  const pr = rows.filter((r) => !r.isSingles && r.player === player);
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
