import path from 'node:path';
import { readCsvFile } from './csv.ts';
import type { FinalsStage, SetScore, StatRow } from './types.ts';
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
 * Finals sort after every home-and-away round. The gap is deliberate: it leaves
 * room for a season that ever runs more than nine rounds.
 */
const STAGE_SORT: Record<FinalsStage, number> = { QF: 100, SF: 101, F: 102 };
const STAGE_LABEL: Record<FinalsStage, string> = {
  QF: 'QF',
  SF: 'SF',
  F: 'Final',
};

/**
 * The Round column holds either a home-and-away round number or a finals stage
 * — `QF`, `SF`, `F`. Anything else is treated as a regular round for sorting
 * purposes; `check-data` is what tells you about a typo.
 */
/** One set: `6`, `6(4)` — a set lost on a breaker carries the loser's points. */
const SET_RE = /^(\d+)(?:\((\d+)\))?-(\d+)(?:\((\d+)\))?$/;

/**
 * Parse a scoreline written from this team's point of view: sets separated by
 * spaces, a lost tiebreak in parentheses on the loser's side.
 *
 *   "6-4"              -> one set won
 *   "4-6 7-6(4) 6-1"   -> three sets, won 2-1
 *
 * Returns an empty array for a blank or malformed scoreline; `check-data` is
 * what reports it, so a typo degrades to "unknown" rather than crashing a build.
 */
export function parseScore(v: string | undefined): SetScore[] {
  const s = (v ?? '').trim();
  if (!s) return [];
  const sets: SetScore[] = [];
  for (const token of s.split(/\s+/)) {
    const m = SET_RE.exec(token);
    if (!m) return [];
    const [, f, tbF, a, tbA] = m;
    sets.push({
      for: Number(f),
      against: Number(a),
      tiebreakFor: tbF === undefined ? null : Number(tbF),
      tiebreakAgainst: tbA === undefined ? null : Number(tbA),
      won: Number(f) > Number(a),
    });
  }
  return sets;
}

/** `2026-08-18T18:30` — local wall time, no zone, no seconds. */
const START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The Start column: when the match begins, in Melbourne local time.
 *
 * Kept as the string it was written as, and validated rather than parsed —
 * `new Date('2026-08-18T18:30')` would resolve against the *build machine's*
 * timezone, which is how a fixture list ends up an hour out in CI. Anything
 * that isn't exactly ISO `YYYY-MM-DDTHH:MM` degrades to null so a typo reads as
 * "no time recorded" rather than a wrong one; `check-data` is what reports it.
 */
export function parseStart(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return START_RE.test(s) ? s : null;
}

export function parseRound(v: string | undefined): {
  round: number;
  stage: FinalsStage | null;
  roundLabel: string;
} {
  const s = (v ?? '').trim().toUpperCase();
  if (s in STAGE_SORT) {
    const stage = s as FinalsStage;
    return { round: STAGE_SORT[stage], stage, roundLabel: STAGE_LABEL[stage] };
  }
  const round = num(v);
  return { round, stage: null, roundLabel: String(round) };
}

/**
 * The single normalization layer. Every data quirk is handled here and nowhere
 * else — the rest of the site consumes clean `StatRow`s.
 *
 * Two of those quirks matter most for finals: the Round column may hold a stage
 * (`QF`/`SF`/`F`) instead of a number, and every counting stat is nullable, so a
 * finals match entered as a scoreline with no stats contributes to win-loss and
 * head-to-head without dragging anyone's averages toward zero.
 */
export function normalizeRows(raw: Record<string, string>[]): StatRow[] {
  const out: StatRow[] = raw
    .filter((r) => (r['Player'] ?? '').trim() !== '' && (r['Season'] ?? '').trim() !== '')
    .map((r): StatRow => {
      const season = num(r['Season']);
      const rawPlayer = (r['Player'] ?? '').trim();
      const isSingles = rawPlayer === SINGLES_PLAYER;
      const { round, stage, roundLabel } = parseRound(r['Round']);
      const score = (r['Score'] ?? '').trim();
      const setScores = parseScore(score);

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
        round,
        stage,
        roundLabel,
        isFinals: stage !== null,
        start: parseStart(r['Start']),
        score,
        setScores,
        // An unreadable scoreline counts as one set: every home-and-away round
        // is a single set, so that's the safe assumption for a rate denominator.
        sets: setScores.length || 1,
        setsWon: setScores.filter((s) => s.won).length,
        setsLost: setScores.filter((s) => !s.won).length,
        player,
        slug: isSingles ? 'singles-game' : playerSlug(player),
        isFillIn: isSingles ? false : isFillIn,
        isSingles,

        aces: numOrNull(r['Aces']),
        unforcedErrors: numOrNull(r['Unforced Errors']),
        forcedErrors: numOrNull(r['Forced Errors']),
        doubleFaults: numOrNull(r['Double Faults']),
        winners: numOrNull(r['Winners']),

        firstServeIn: serveSeason ? numOrNull(r['1st Serve In']) : null,
        firstServeOut: serveSeason ? numOrNull(r['1st Serve Out']) : null,
        errorsForced: efTracked ? numOrNull(r['Errors Forced']) : null,

        win: bool(r['win?']),
        // The one place a fixture is told from a played match. See StatRow.
        // Read off the raw cell, because `bool()` above has already collapsed
        // blank and FALSE into the same `false`.
        scheduled: (r['win?'] ?? '').trim() === '',
        teamScore: num(r['Team Score']),
        opponentScore: num(r['Opponent Score']),

        votes: numOrNull(r['votes']),
        adjustedVotes: adjustVotes(season, stage !== null, numOrNull(r['votes'])),
        // BOG is not stored — it's derived from votes below.
        bog: false,
      };
    });

  deriveBog(out);
  return out;
}

/**
 * Map a Season 1 home-and-away vote onto the modern two-voter 3-2-1 scale for
 * the cross-era windows: 2 -> 6, 1 -> 4 (see SITE.voteEraMap). Finals rows
 * pass through untouched — the Finals MVP has been 4-3-2-1 in every season —
 * and so does any value the map doesn't know, so a data typo stays visible
 * rather than being silently rescaled.
 */
function adjustVotes(
  season: number,
  isFinals: boolean,
  votes: number | null
): number | null {
  if (votes === null || isFinals || season !== SITE.voteEraSeason) return votes;
  return SITE.voteEraMap[votes] ?? votes;
}

/**
 * Best on Ground is defined as the player(s) with the most votes in a match.
 * We group rows into fixtures — one match is both sides of a
 * (season, round, {team, opponent}) pairing — and flag the top vote-getter(s).
 * Ties share the honour (as the historical data did). A match with no recorded
 * votes, or where the best is zero, has no BOG.
 *
 * A scheduled fixture is skipped outright. Its blank votes would fall out of
 * the `votes !== null` filter anyway, but a match nobody has played can't have
 * a best on ground, and that's worth saying rather than relying on.
 */
export function deriveBog(rows: StatRow[]): void {
  const groups = new Map<string, StatRow[]>();
  for (const r of rows) {
    if (r.scheduled) continue;
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
