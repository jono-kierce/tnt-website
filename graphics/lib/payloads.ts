/**
 * `stats.ts` → the data objects the templates render.
 *
 * The rule this file exists to enforce: **nothing here computes a statistic.**
 * Every number comes out of `src/lib/stats.ts` and every quirk out of
 * `src/lib/normalize.ts`. What's left is presentation — labels, ordering,
 * rounding for display — and that's all a payload builder is allowed to do.
 * A ladder derived twice is a ladder that can disagree with itself.
 */

import { loadStatRows, parseRound } from '../../src/lib/normalize.ts';
import { ladderWithPairings, matchSides, teamRoster } from '../../src/lib/stats.ts';
import type { MatchSide, SetScore, StatRow } from '../../src/lib/types.ts';
import { SITE } from '../../src/config/site.ts';
import { seasonTeamConfigs } from './season-configs.ts';

export const rows: StatRow[] = loadStatRows();

/**
 * "Season 4 · 2025". `seasonLabel` in site.ts sets the year in brackets, which
 * is right for a sentence and wrong for a letterspaced eyebrow — a bracket at
 * 0.4em tracking reads as a stray mark.
 */
export function eyebrowLabel(season: number): string {
  const year = SITE.seasonYears[season];
  return year ? `Season ${season} · ${year}` : `Season ${season}`;
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

/**
 * A round as the CLI names it (`9`, `QF`, `F`) resolved against the CSV's own
 * sort key, so "the ladder after round N" and "the matches in round N" agree
 * with the site about where finals sit.
 */
export interface RoundRef {
  /** As typed: "9", "QF", "F". */
  input: string;
  /** Sort key — finals sort after every home-and-away round. */
  round: number;
  stage: 'QF' | 'SF' | 'F' | null;
  /** For a card or a headline: "Round 9", "Grand Final". */
  label: string;
  /** For a filename: "r09", "rF". */
  fileTag: string;
}

/**
 * Singular, because these label one match. `site-data.ts` has the plural forms
 * ("Semi Finals") for a round heading on the site; a card says which final it
 * was, not how many there were that night.
 */
const STAGE_MATCH_LABEL = {
  QF: 'Qualifying Final',
  SF: 'Semi Final',
  F: 'Grand Final',
} as const;

export function resolveRound(input: string | number): RoundRef {
  const raw = String(input).trim();
  const { round, stage } = parseRound(raw);
  return {
    input: raw,
    round,
    stage,
    label: stage ? STAGE_MATCH_LABEL[stage] : `Round ${round}`,
    fileTag: stage ? `r${stage}` : `r${String(round).padStart(2, '0')}`,
  };
}

/** Every round played in a season, in the order they were played. */
export function seasonRounds(season: number): RoundRef[] {
  const seen = new Map<number, string>();
  for (const r of rows) {
    if (r.season !== season) continue;
    seen.set(r.round, r.stage ?? String(r.round));
  }
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, input]) => resolveRound(input));
}

/** The most recent round with rows in the CSV — what "this week" means. */
export function latestRound(season: number): RoundRef | null {
  const all = seasonRounds(season);
  return all.length ? all[all.length - 1] : null;
}

/** The last home-and-away round of a season — the one that seeds the finals. */
function lastHomeAndAwayRound(season: number): number {
  const nums = rows
    .filter((r) => r.season === season && !r.isFinals)
    .map((r) => r.round);
  return nums.length ? Math.max(...nums) : 0;
}

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

export interface LadderRowPayload {
  rank: number;
  /** CSV team name — the templates key their colour off this via `data-team`. */
  team: string;
  /** "L. Sharrock & A. Hume", captain-first where the season config says so. */
  pairing: string;
  played: number;
  wins: number;
  losses: number;
  /** Games for ÷ against, already rounded for print. */
  ratio: string;
  /** Above the finals cutoff. */
  qualifies: boolean;
}

export interface LadderPayload {
  kind: 'ladder';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  finalsCutoff: number;
  rows: LadderRowPayload[];
}

/**
 * How many teams play finals. Not in the config anywhere, because it has never
 * changed and the bracket in each season config is the real record of it — so
 * read it off the bracket when there is one and fall back to the league's
 * standing rule of a top eight.
 */
const DEFAULT_FINALS_CUTOFF = 8;

export async function ladderPayload(
  season: number,
  round: RoundRef,
  opts: { finalsCutoff?: number } = {}
): Promise<LadderPayload> {
  // The ladder as it stood that night. Finals rounds sort above every
  // home-and-away round, so a finals `round` keeps the whole season — which is
  // right: the final ladder is what seeded the bracket.
  const upToRound = rows.filter((r) => r.round <= round.round);
  const teamConfig = await seasonTeamConfigs(season);
  const table = ladderWithPairings(season, upToRound, teamConfig);

  const cutoff = opts.finalsCutoff ?? DEFAULT_FINALS_CUTOFF;
  const lastHA = lastHomeAndAwayRound(season);
  const complete = round.stage !== null || round.round >= lastHA;

  return {
    kind: 'ladder',
    eyebrow: eyebrowLabel(season),
    title: complete ? 'Final Ladder' : 'Standings',
    subtitle: complete
      ? `Home & away complete · Top ${cutoff} play finals`
      : `After ${round.label} · Top ${cutoff} play finals`,
    footnote: 'Ratio = games won ÷ games lost',
    finalsCutoff: cutoff,
    rows: table.map((r) => ({
      rank: r.rank,
      team: r.team,
      pairing: r.pairingName,
      played: r.matchesPlayed,
      wins: r.wins,
      losses: r.losses,
      ratio: r.ratio.toFixed(2),
      qualifies: r.rank <= cutoff,
    })),
  };
}

// ---------------------------------------------------------------------------
// Result cards
// ---------------------------------------------------------------------------

export interface SetPayload {
  /** Games won by this side in this set. */
  games: string;
  /**
   * Tiebreak points this side lost the breaker by, or null. The CSV writes the
   * breaker on the loser's side (`6(4)-7`), which is exactly the side that
   * prints it — so a side's own rows already say whether to draw the
   * superscript.
   */
  tiebreak: string | null;
  won: boolean;
}

export interface SidePayload {
  team: string;
  pairing: string;
  /** Ladder position going into the match. */
  seed: number | null;
  sets: SetPayload[];
  won: boolean;
  gamesFor: number;
  gamesAgainst: number;
}

export interface ResultCardPayload {
  kind: 'result';
  eyebrow: string;
  roundLabel: string;
  /** Absolute path to the background photo, or null for scrim-only. */
  photo: string | null;
  /** Winner first. */
  sides: [SidePayload, SidePayload];
  /** Stable, self-describing slug for the filename. */
  slug: string;
}

/** One side's sets, from that side's own point of view. */
const setsFor = (s: MatchSide): SetPayload[] =>
  s.setScores.map((set: SetScore) => ({
    games: String(set.for),
    tiebreak: set.tiebreakFor === null ? null : String(set.tiebreakFor),
    won: set.won,
  }));

/**
 * Every fixture in a round, winner's side first.
 *
 * `matchSides` gives one record per team-side, each carrying its own scoreline
 * — which is why nothing here has to invert a score to show the other team's
 * view. The two halves of a fixture are found by pairing (team, opponent) with
 * (opponent, team).
 */
export async function resultCardPayloads(
  season: number,
  round: RoundRef,
  opts: { photos?: Record<string, string> } = {}
): Promise<ResultCardPayload[]> {
  const sides = matchSides(rows, season, 'all').filter(
    (s) => s.round === round.round
  );
  const byKey = new Map(sides.map((s) => [`${s.team}|${s.opponent}`, s]));

  // Seeds: where each team sat on the ladder going into the match. For a finals
  // card that's the final home-and-away ladder — the seeding itself.
  const ladderRows = (await ladderPayload(season, round)).rows;
  const seed = new Map(ladderRows.map((r) => [r.team, r.rank]));

  const teamConfig = await seasonTeamConfigs(season);
  const pairing = (team: string) =>
    teamRoster(team, season, rows, teamConfig(team)).pairingName;

  const out: ResultCardPayload[] = [];
  const done = new Set<string>();

  for (const s of sides) {
    const pairKey = [s.team, s.opponent].sort().join('|');
    if (done.has(pairKey)) continue;
    const other = byKey.get(`${s.opponent}|${s.team}`);
    if (!other) continue; // half a fixture — check-data's problem, not ours
    done.add(pairKey);

    const [win, lose] = s.win ? [s, other] : [other, s];
    const side = (m: MatchSide): SidePayload => ({
      team: m.team,
      pairing: pairing(m.team),
      seed: seed.get(m.team) ?? null,
      sets: setsFor(m),
      won: m.win,
      gamesFor: m.teamScore,
      gamesAgainst: m.opponentScore,
    });

    const slug = `${win.team}-v-${lose.team}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');

    out.push({
      kind: 'result',
      eyebrow: eyebrowLabel(season),
      roundLabel: round.label,
      photo: opts.photos?.[slug] ?? null,
      sides: [side(win), side(lose)],
      slug,
    });
  }

  // Stable order: the tie involving the higher-seeded team goes first, which
  // for a finals night is the bracket order people expect.
  return out.sort(
    (a, b) =>
      Math.min(a.sides[0].seed ?? 99, a.sides[1].seed ?? 99) -
      Math.min(b.sides[0].seed ?? 99, b.sides[1].seed ?? 99)
  );
}

export const seasonYear = (season: number): number | undefined =>
  SITE.seasonYears[season];
