import path from 'node:path';
import { readCsvFile } from './csv.ts';
import type { StatRow } from './types.ts';
import { SITE } from '../config/site.ts';
import {
  SINGLES_PLAYER,
  canonicalName,
  playerSlug,
  stripFillIn,
} from '../config/aliases.ts';

/** Path to the single source of truth. */
export const CSV_PATH = path.resolve(process.cwd(), 'data/alltimestats.csv');

function num(v: string | undefined): number {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Blank -> null; otherwise the number. Used for optional/era-specific stats. */
function numOrNull(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(v: string | undefined): boolean {
  return (v ?? '').trim().toUpperCase() === 'TRUE';
}

/**
 * The single normalization layer. Every data quirk is handled here and nowhere
 * else — the rest of the site consumes clean `StatRow`s.
 */
export function normalizeRows(raw: Record<string, string>[]): StatRow[] {
  const out: StatRow[] = raw
    .filter((r) => (r['Player'] ?? '').trim() !== '' && (r['Season'] ?? '').trim() !== '')
    .map((r): StatRow => {
      const season = num(r['Season']);
      const rawPlayer = (r['Player'] ?? '').trim();
      const isSingles = rawPlayer === SINGLES_PLAYER;

      const { name: stripped, isFillIn } = stripFillIn(rawPlayer);
      const player = isSingles ? SINGLES_PLAYER : canonicalName(stripped);

      // Serve stats: Season 1 only, regardless of stray values elsewhere.
      const serveSeason = season === SITE.serveStatsSeason;
      // Errors Forced: recorded from errorsForcedFromSeason onward.
      const efTracked = season >= SITE.errorsForcedFromSeason;

      return {
        team: (r['Team'] ?? '').trim(),
        opponent: (r['Opponent'] ?? '').trim(),
        season,
        round: num(r['Round']),
        player,
        slug: isSingles ? 'singles-game' : playerSlug(player),
        isFillIn: isSingles ? false : isFillIn,
        isSingles,

        aces: num(r['Aces']),
        unforcedErrors: num(r['Unforced Errors']),
        forcedErrors: num(r['Forced Errors']),
        doubleFaults: num(r['Double Faults']),
        winners: num(r['Winners']),

        firstServeIn: serveSeason ? numOrNull(r['1st Serve In']) : null,
        firstServeOut: serveSeason ? numOrNull(r['1st Serve Out']) : null,
        errorsForced: efTracked ? numOrNull(r['Errors Forced']) : null,

        win: bool(r['win?']),
        teamScore: num(r['Team Score']),
        opponentScore: num(r['Opponent Score']),

        votes: numOrNull(r['votes']),
        // BOG is not stored — it's derived from votes below.
        bog: false,
      };
    });

  deriveBog(out);
  return out;
}

/**
 * Best on Ground is defined as the player(s) with the most votes in a match.
 * We group rows into fixtures — one match is both sides of a
 * (season, round, {team, opponent}) pairing — and flag the top vote-getter(s).
 * Ties share the honour (as the historical data did). A fixture with no
 * recorded votes, or where the best is zero, has no BOG.
 */
export function deriveBog(rows: StatRow[]): void {
  const groups = new Map<string, StatRow[]>();
  for (const r of rows) {
    const pair = [r.team, r.opponent].sort().join('~');
    const key = `${r.season}|${r.round}|${pair}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  for (const group of groups.values()) {
    const candidates = group.filter((r) => !r.isSingles && r.votes !== null);
    if (!candidates.length) continue;
    const max = Math.max(...candidates.map((r) => r.votes as number));
    if (max <= 0) continue;
    for (const r of candidates) if (r.votes === max) r.bog = true;
  }
}

let _cache: StatRow[] | null = null;

/** Load + normalize the CSV once per build. */
export function loadStatRows(): StatRow[] {
  if (_cache) return _cache;
  _cache = normalizeRows(readCsvFile(CSV_PATH));
  return _cache;
}
