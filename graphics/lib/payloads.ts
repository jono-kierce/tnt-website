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
import {
  isPartial,
  ladderWithPairings,
  leaderboard,
  matchSides,
  playerAgg,
  lineupPairingName,
  seasonRounds as matchRoundsFor,
  winStreaks,
  streakEndLabel,
  pairRecord,
  type CountingStat,
  type LeaderStat,
  type PlayerAgg,
  type StatScope,
} from '../../src/lib/stats.ts';
import { insightsFor } from '../../src/lib/insights.ts';
import { formatDateLong, formatTime } from '../../src/lib/datetime.ts';
import type { MatchSide, SetScore, StatRow } from '../../src/lib/types.ts';
import { SITE, isVotesSealed } from '../../src/config/site.ts';
import { PHOTOS_DIR, avatarPhoto } from '../../src/lib/photos.ts';
import {
  getSeasonConfig,
  seasonTeamConfigs,
  declaredTeams,
  withdrawnTeams,
  seasonFinalsBerths,
} from './season-configs.ts';
import { shortName, slugify } from '../../src/config/aliases.ts';
import { ANALYSTS, type AnalystPredictions } from './predictions.ts';
import { loadMvpSim } from './mvp-sim.ts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/**
 * Every round played in a season, in the order they were played.
 *
 * Played, emphatically: a round that has only been drawn has no scores, no
 * stats and no winner, and `npm run graphics` with no arguments renders "the
 * latest round" — which must never resolve to a match nobody has played.
 */
export function seasonRounds(season: number): RoundRef[] {
  const seen = new Map<number, string>();
  for (const r of rows) {
    if (r.season !== season || r.scheduled) continue;
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

/**
 * Is a season's home-and-away part finished as of `round`? True only when no
 * further regular-season match exists in the CSV — played *or still scheduled*.
 * A drawn-but-unplayed round beyond this one means the season is still running,
 * so the ladder reads "Standings · After Round N", not "Final Ladder".
 */
function homeAndAwayComplete(season: number, round: number): boolean {
  return !rows.some(
    (r) => r.season === season && !r.isFinals && r.round > round
  );
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
  // The same field the site's ladder is built on: declared teams enter at
  // 0/0/0, and a team that withdrew mid-season comes off. A posted ladder
  // disagreeing with the printed one is the thing this module exists to stop.
  const table = ladderWithPairings(
    season,
    upToRound,
    teamConfig,
    await declaredTeams(season),
    await withdrawnTeams(season)
  );

  const cutoff = opts.finalsCutoff ?? DEFAULT_FINALS_CUTOFF;
  const complete =
    round.stage !== null || homeAndAwayComplete(season, round.round);

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
  /**
   * The set finished level — `5-5`, `6-6` — because nobody recorded the
   * breaker. Neither side won it, so neither should be printed as having lost
   * it. Which team won the *match* is `SidePayload.won`, off the CSV's `win?`,
   * and that's what the card has to show unambiguously.
   */
  level: boolean;
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

/**
 * One side's sets, from that side's own point of view. Takes anything carrying
 * a scoreline — `matchSides`' team-side and `seasonRounds`' line-up both do.
 */
const setsFor = (s: { setScores: MatchSide['setScores'] }): SetPayload[] =>
  s.setScores.map((set: SetScore) => ({
    games: String(set.for),
    tiebreak: set.tiebreakFor === null ? null : String(set.tiebreakFor),
    won: set.won,
    level: set.for === set.against,
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

  // The player rows for a fixture side — matchSides collapses to the team
  // result and drops them, so read them straight off the CSV, keyed the same
  // way. This is what lets a stand-in print as who actually played.
  const lineupOf = (m: MatchSide): StatRow[] =>
    rows.filter(
      (r) =>
        !r.scheduled &&
        r.season === m.season &&
        r.round === m.round &&
        r.team === m.team &&
        r.opponent === m.opponent
    );

  const out: ResultCardPayload[] = [];
  const done = new Set<string>();

  for (const s of sides) {
    const pairKey = [s.team, s.opponent].sort().join('|');
    if (done.has(pairKey)) continue;
    const other = byKey.get(`${s.opponent}|${s.team}`);
    if (!other) continue; // half a fixture — check-data's problem, not ours
    done.add(pairKey);

    const [win, lose] = s.win ? [s, other] : [other, s];
    // Who actually turned out for this fixture, sheet-first — so a stand-in
    // prints as the player who played, not the season's default pairing.
    // Falls back to the config pair when a side has no rows (matches preview).
    const side = (m: MatchSide): SidePayload => ({
      team: m.team,
      pairing: lineupPairingName(lineupOf(m), teamConfig(m.team)),
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

// ---------------------------------------------------------------------------
// Preview — the round not yet played
// ---------------------------------------------------------------------------

/**
 * "Qualifying Finals" — a whole round's worth of matches, unlike a single
 * card's "Qualifying Final". Shared by the preview and the scoreboard, which
 * are the same round seen from either side of Tuesday night.
 */
const ROUND_TITLE = {
  QF: 'Qualifying Finals',
  SF: 'Semi Finals',
  F: 'The Final',
} as const;

export interface PreviewMatchPayload {
  teamA: string;
  pairingA: string;
  teamB: string;
  pairingB: string;
  /** "6:30pm", or null when the CSV has no Start for this fixture. */
  time: string | null;
  /**
   * The single top-weighted line from `insightsFor`, if one fires. Never a win
   * probability — that lives in `predict.ts` and this graphic doesn't read it,
   * so a preview posted the day before a round can't be read as a tip.
   */
  insight: { label: string; detail: string } | null;
}

export interface PreviewPayload {
  kind: 'preview';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  matches: PreviewMatchPayload[];
  /** Declared teams with no fixture this round. */
  byes: string[];
}

/** The season's declared field, or undefined for a season whose config names none. */
async function previewField(season: number): Promise<string[] | undefined> {
  const teams = await declaredTeams(season);
  return teams.length ? teams : undefined;
}

/**
 * Teams that pulled out mid-season — see `TeamConfig.withdrawn`. Without it a
 * withdrawn team is listed on a bye on every card for the rest of the season.
 */
async function previewGone(season: number): Promise<string[] | undefined> {
  const gone = await withdrawnTeams(season);
  return gone.length ? gone : undefined;
}

/**
 * The next round with an unplayed fixture — what "post it the Monday before"
 * means. Unlike `latestRound`, which only ever looks at played rounds, this is
 * allowed to land on a season that hasn't started a night of tennis yet.
 */
export async function nextPreviewRound(season: number): Promise<RoundRef | null> {
  const field = await previewField(season);
  const gone = await previewGone(season);
  const next = matchRoundsFor(rows, season, field, gone).find((r) =>
    r.matches.some((m) => m.scheduled)
  );
  return next ? resolveRound(next.stage ?? next.round) : null;
}

/**
 * Every unplayed fixture in a round, kickoff order, each with its pairing
 * labels and — when one fires — the single most relevant thing worth knowing
 * about it. Byes are the round's declared field minus whoever has a fixture.
 */
export async function previewPayload(
  season: number,
  round: RoundRef
): Promise<PreviewPayload> {
  const field = await previewField(season);
  const gone = await previewGone(season);
  const sr = matchRoundsFor(rows, season, field, gone).find(
    (r) => r.round === round.round
  );
  if (!sr) {
    throw new Error(
      `Season ${season} has no round matching "${round.input}" to preview.`
    );
  }

  const teamConfig = await seasonTeamConfigs(season);
  const finalsCutoff = await seasonFinalsBerths(season);

  const matches: PreviewMatchPayload[] = sr.matches
    .filter((m) => m.scheduled)
    .map((m) => {
      const [a, b] = m.sides;
      // The line-up as the sheet lists it for this fixture — so a stand-in
      // prints who's actually playing, not the season's default pairing. Falls
      // back to the config pair only when a side has no rows to read.
      const pairing = (side: typeof a) =>
        lineupPairingName(side.players, teamConfig(side.team));
      // Top-weighted only — a preview card has room for one line, not three.
      const [top] = insightsFor(
        m,
        rows,
        { declaredTeams: field, withdrawnTeams: gone, finalsCutoff },
        1
      );
      return {
        teamA: a.team,
        pairingA: pairing(a),
        teamB: b.team,
        pairingB: pairing(b),
        time: formatTime(m.start),
        insight: top ? { label: top.label, detail: top.detail } : null,
      };
    });

  return {
    kind: 'preview',
    eyebrow: eyebrowLabel(season),
    title: round.stage ? ROUND_TITLE[round.stage] : `Round ${round.round}`,
    subtitle: sr.date ? formatDateLong(sr.date)! : 'This week’s fixtures',
    footnote: '',
    matches,
    byes: sr.byes,
  };
}

// ---------------------------------------------------------------------------
// Scoreboard — the round just played, on one slide
// ---------------------------------------------------------------------------

export interface ScoreboardSidePayload {
  team: string;
  /** The line-up as the sheet lists it, captain-first — stand-ins included. */
  pairing: string;
  sets: SetPayload[];
  /** From the CSV's `win?`, never from counting sets. */
  won: boolean;
}

export interface ScoreboardMatchPayload {
  /** "6:30pm", or null when the CSV has no Start for this match. */
  time: string | null;
  /** Winner first, as on a result card. Record order for a match nobody won. */
  sides: [ScoreboardSidePayload, ScoreboardSidePayload];
  /** Played, but no side flagged as the winner — shown level, never guessed. */
  draw: boolean;
}

export interface ScoreboardPayload {
  kind: 'scoreboard';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  matches: ScoreboardMatchPayload[];
  /** Declared teams with no fixture this round. */
  byes: string[];
}

/**
 * Every played fixture in a round on one board — the preview's twin, run the
 * morning after instead of the day before, for a night nobody photographed.
 *
 * Same shape and the same ordering rules: kickoff order (`byPlayingOrder`), so
 * it reads top to bottom the way the night ran, and the same derived byes. The
 * per-fixture result cards stay the richer post; this is the one that needs no
 * human input at all.
 */
export async function scoreboardPayload(
  season: number,
  round: RoundRef
): Promise<ScoreboardPayload> {
  const field = await previewField(season);
  const gone = await previewGone(season);
  const sr = matchRoundsFor(rows, season, field, gone).find(
    (r) => r.round === round.round
  );
  if (!sr) {
    throw new Error(
      `Season ${season} has no round matching "${round.input}" to report.`
    );
  }

  const teamConfig = await seasonTeamConfigs(season);

  const matches: ScoreboardMatchPayload[] = sr.matches
    .filter((m) => !m.scheduled)
    .map((m) => {
      const side = (l: (typeof m.sides)[number]): ScoreboardSidePayload => ({
        team: l.team,
        pairing: lineupPairingName(l.players, teamConfig(l.team)),
        sets: setsFor(l),
        won: l.win,
      });
      // Winner first — `MatchRecord.sides` is alphabetical by team, and a
      // scoreboard that put the loser on top would read as one. A match with no
      // winner recorded keeps that order rather than inventing one.
      const [a, b] = m.sides;
      const ordered = b.win ? [b, a] : [a, b];
      return {
        time: formatTime(m.start),
        sides: [side(ordered[0]), side(ordered[1])],
        draw: m.isDraw,
      };
    });

  return {
    kind: 'scoreboard',
    eyebrow: eyebrowLabel(season),
    title: round.stage ? ROUND_TITLE[round.stage] : `Round ${round.round}`,
    subtitle: sr.date ? formatDateLong(sr.date)! : 'Results',
    footnote: '',
    matches,
    byes: sr.byes,
  };
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export interface DraftRowPayload {
  /** 1 = the number one pick. */
  pick: number;
  team: string;
  captain: string;
  /** Everyone the captain took, in the order the config lists them. */
  draftee: string;
}

export interface DraftPayload {
  kind: 'draft';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  rows: DraftRowPayload[];
}

/**
 * The draft board for a season, straight off its config.
 *
 * The only graphic that reads no match data at all — a draft happens before
 * there's a single row in the CSV, which is exactly why the pick order has to
 * be recorded in `season-N.ts`. Nothing is derived here beyond splitting each
 * pairing into the captain and who they took.
 */
export async function draftPayload(
  season: number,
  opts: { subtitle?: string; footnote?: string } = {}
): Promise<DraftPayload> {
  const cfg = await getSeasonConfig(season);
  const order = cfg?.draftOrder;
  if (!cfg || !order?.length) {
    throw new Error(
      `Season ${season} has no draftOrder in src/config/seasons/season-${season}.ts, ` +
        `so there's no pick order to print. Add one — team colours, number one ` +
        `pick first — and the board builds itself from the pairings already there.`
    );
  }

  const rows = order.map((team, i) => {
    const entry = cfg.teams?.[team];
    // The pair as drafted — `pair` follows a mid-season change, and the draft
    // board is a record of draft night, not of who is playing now.
    const pair = entry?.drafted ?? entry?.pair ?? [];
    const captain = entry?.captain ?? pair[0];
    if (!captain) {
      throw new Error(
        `Season ${season}: draftOrder lists "${team}" but its teams entry has no ` +
          `captain or pairing to print.`
      );
    }
    return {
      pick: i + 1,
      team,
      captain,
      // Everyone after the captain. A pairing is two, but a team that ever
      // carried three shouldn't lose the third name off the poster.
      draftee: pair.slice(1).join(' & '),
    };
  });

  return {
    kind: 'draft',
    eyebrow: eyebrowLabel(season),
    title: 'The Draft',
    subtitle: opts.subtitle ?? `${rows.length} teams · Captain's pick`,
    // Empty by default: the ladder's footnote earns its place by explaining the
    // ratio, and a draft board has nothing that needs explaining. The slot is
    // there for a date or a venue — pass --footnote.
    footnote: opts.footnote ?? '',
    rows,
  };
}

// ---------------------------------------------------------------------------
// Stat boards
// ---------------------------------------------------------------------------

/**
 * Which end of the range is the good end.
 *
 * Both kinds of board are ranked biggest-first — `#1` always means the biggest
 * number, the way the site's rank badges do it. What changes is the colour: on
 * an unforced-errors board topping the list is the disgrace, so the ramp runs
 * the other way and the leader's chip comes out red.
 */
export type Polarity = 'high' | 'low';

export interface StatBoardSpec {
  /** Slug for the filename, e.g. `winners-per-set`. */
  id: string;
  title: string;
  subtitle?: string;
  /** Column heading over the value chips, e.g. "Winners / set". */
  metricLabel: string;
  stat: LeaderStat;
  /** Rank on the per-set rate rather than the raw total. */
  perSet?: boolean;
  /** Omit for a career board. */
  season?: number;
  scope?: StatScope;
  /** How many players to show. Default 10. */
  rows?: number;
  polarity?: Polarity;
  /** Fill-in matches are excluded by default, as they are on the site. */
  includeFillIns?: boolean;
  /** Overrides `SITE.perGameMinGames` on a rate board. */
  minGames?: number;
  /** Print a leader's photo in the hero band. Absent photo = no band. */
  showPhoto?: boolean;
  /** A transparent cut-out sits flush; a normal photo gets a framed crop. */
  cutout?: boolean;
  /** Extra line under the footnote the builder generates. */
  note?: string;
}

export interface StatBoardRowPayload {
  rank: number;
  player: string;
  slug: string;
  /** For the colour chip. Null when the player has no team in this window. */
  team: string | null;
  /** Formatted for print. */
  value: string;
  /** 0 = the good end of this board, 1 = the bad end. Drives the chip ramp. */
  tone: number;
  /**
   * Set when the stat is missing from some of the player's matches — the cue
   * that a total is an undercount and a rate rests on fewer sets than it looks.
   * A blank cell means "not recorded", never zero, so this is never silent.
   */
  coverage: string | null;
}

export interface StatBoardPayload {
  kind: 'stat-board';
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  metricLabel: string;
  footnote: string;
  rows: StatBoardRowPayload[];
  /** Hero band: the leader, pictured. Null when there's no photo to show. */
  hero: { player: string; value: string; photo: string; cutout: boolean } | null;
}

/** Boards whose numbers would give away a sealed season's votes. */
const VOTE_STATS = new Set<LeaderStat>(['votes', 'finalsVotes', 'bog']);

/**
 * Thrown rather than rendered. `sealedVoteSeasons` exists so a season's votes
 * stay hidden until awards night, and a graphic that quietly printed them would
 * be a worse leak than a page that did — it gets posted.
 */
export class SealedVotesError extends Error {}

/** Values are printed, not computed — this is the only place rounding happens. */
/** Counts of a result rather than of a stat cell — never shown as a rate. */
const COUNT_STATS = new Set<LeaderStat>(['bagelsFor', 'bagelsAgainst']);

function formatValue(stat: LeaderStat, perSetMode: boolean, v: number): string {
  if (stat === 'winPct') return `${Math.round(v * 100)}%`;
  if (stat === 'winnerToUe') return v.toFixed(2);
  if (COUNT_STATS.has(stat)) return String(v);
  if (perSetMode) return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * The team whose colour the row wears. A season board uses the team the player
 * turned out for that season; a career board uses their most recent. This is a
 * lookup for a colour chip, not a statistic.
 */
function teamForChip(player: string, season?: number): string | null {
  const mine = rows.filter(
    (r) =>
      !r.isSingles &&
      !r.scheduled &&
      r.player === player &&
      !r.isFillIn &&
      (season === undefined || r.season === season)
  );
  if (!mine.length) return null;
  return mine.reduce((best, r) =>
    r.season > best.season || (r.season === best.season && r.round > best.round)
      ? r
      : best
  ).team;
}

/**
 * The colour a player wears *now* — their team in the current season, drawn
 * from the fixtures even before a ball is hit (so it works while S5 is still
 * an unplayed draw). Falls back to their most recent played team for anyone
 * not in the current season. A colour lookup, not a statistic.
 */
function currentTeamForChip(player: string): string | null {
  const drawn = rows.find(
    (r) =>
      r.season === SITE.currentSeason &&
      r.player === player &&
      !r.isSingles &&
      !r.isFillIn
  );
  return drawn ? drawn.team : teamForChip(player);
}

/** "32 of 41 matches" when a stat is missing from some of them. */
function coverageNote(agg: PlayerAgg, stat: LeaderStat): string | null {
  if (stat === 'winPct' || stat === 'winnerToUe' || stat === 'bog') return null;
  const counting = stat === 'finalsVotes' ? 'votes' : stat;
  if (!(counting in agg.tally)) return null;
  if (!isPartial(agg, counting as keyof PlayerAgg['tally'])) return null;
  const t = agg.tally[counting as keyof PlayerAgg['tally']];
  return `${t.games} of ${agg.games} matches`;
}

export function statBoardPayload(spec: StatBoardSpec): StatBoardPayload {
  const {
    stat,
    season,
    perSet: rate = false,
    polarity = 'high',
    includeFillIns = false,
  } = spec;
  // A hero band costs roughly three rows' worth of canvas, so a board that
  // asks for a photo without saying how many rows it wants gets the shorter
  // list rather than ten rows squeezed to fit.
  const rowCount = spec.rows ?? (spec.showPhoto ? 7 : 10);

  if (VOTE_STATS.has(stat) && season !== undefined && isVotesSealed(season)) {
    throw new SealedVotesError(
      `Season ${season}'s votes are sealed (SITE.sealedVoteSeasons), so the ` +
        `"${spec.title}" board can't be rendered. Remove ${season} from ` +
        `sealedVoteSeasons once the votes are public — until then this board ` +
        `would post the count that's meant to be a surprise.`
    );
  }

  const board = leaderboard(stat, rows, {
    season,
    perSet: rate,
    scope: spec.scope,
    includeFillIns,
    minGames: spec.minGames,
  }).slice(0, rowCount);

  // The ramp spans the players actually shown, so every board uses its full
  // range — a top ten separated by 0.3 of a winner still reads as a gradient.
  const values = board.map((e) => e.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const toneOf = (v: number) => {
    if (!span || !Number.isFinite(span)) return 0;
    const fromTop = (max - v) / span; // 0 at the biggest number
    return polarity === 'high' ? fromTop : 1 - fromTop;
  };

  const payloadRows: StatBoardRowPayload[] = board.map((e, i) => ({
    rank: i + 1,
    player: e.player,
    slug: e.slug,
    team: teamForChip(e.player, season),
    value: formatValue(stat, rate, e.value),
    tone: toneOf(e.value),
    coverage: coverageNote(e.agg, stat),
  }));

  const notes: string[] = [];
  if (!includeFillIns) notes.push('Fill-in matches excluded');
  if (rate) notes.push(`Min. ${spec.minGames ?? SITE.perGameMinGames} matches`);
  if (spec.note) notes.push(spec.note);

  const leader = payloadRows[0];
  const photo = spec.showPhoto && leader ? avatarPhoto(leader.slug) : null;

  return {
    kind: 'stat-board',
    id: spec.id,
    eyebrow: season === undefined ? 'All time' : eyebrowLabel(season),
    title: spec.title,
    subtitle: spec.subtitle ?? '',
    metricLabel: spec.metricLabel,
    footnote: notes.join(' · '),
    rows: payloadRows,
    hero:
      photo && leader
        ? {
            player: leader.player,
            value: leader.value,
            // Absolute: the template is loaded from `graphics/templates/`, so a
            // path relative to the repo root would resolve under that folder.
            photo: pathToFileURL(resolve(PHOTOS_DIR, photo.file)).href,
            cutout: spec.cutout ?? false,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Streak board — the record books, not a per-set leaderboard
// ---------------------------------------------------------------------------

export interface StreakBoardRowPayload {
  rank: number;
  player: string;
  slug: string;
  /** For the colour spine. The player's most recent team — a colour, not a stat. */
  team: string | null;
  /** Matches won in a row. */
  streak: number;
  /** The run is still alive: their last match was a win and it's their peak. */
  active: boolean;
  /** When the run spanned: "S1R4 – S1Final", or "S4R1 – ongoing" if still live. */
  range: string;
}

export interface StreakBoardPayload {
  kind: 'streak-board';
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  metricLabel: string;
  footnote: string;
  rows: StreakBoardRowPayload[];
}

/**
 * The longest win streaks on record — a record book, so it reads career-wide
 * and finals count. Presentation only: `winStreaks` in `stats.ts` does the
 * counting and decides what "still active" means; the asterisk is just how we
 * print that flag. The colour spine is a lookup, not a statistic.
 */
export function streakBoardPayload(count = 5): StreakBoardPayload {
  const board = winStreaks(rows).slice(0, count);
  const payloadRows: StreakBoardRowPayload[] = board.map((s, i) => ({
    rank: i + 1,
    player: s.player,
    slug: s.slug,
    team: currentTeamForChip(s.player),
    streak: s.streak,
    active: s.active,
    // Bracket the run. An active streak has no closing round yet, so it reads
    // as ongoing rather than pretending the last win was the end of it.
    range:
      s.from && s.to
        ? `${streakEndLabel(s.from)} – ${s.active ? 'ongoing' : streakEndLabel(s.to)}`
        : '',
  }));

  const notes = ['Fill-in matches excluded'];
  if (payloadRows.some((r) => r.active)) notes.unshift('* Streak still active');

  return {
    kind: 'streak-board',
    id: 'longest-win-streaks',
    eyebrow: 'All time',
    title: 'Longest Win Streaks',
    // The title carries the whole meaning; a subtitle and a value-column header
    // would only say "win streak" twice more.
    subtitle: '',
    metricLabel: '',
    footnote: notes.join(' · '),
    rows: payloadRows,
  };
}

// ---------------------------------------------------------------------------
// Predictions — the analysts' pre-season picks
// ---------------------------------------------------------------------------

export interface PredictionPickPayload {
  /** Award name, e.g. "Champions", "Finals MVP". */
  category: string;
  /** Colour key for the row's `data-team` spine. */
  team: string;
  /** The pick's headline: a team name, or a player's name. */
  primary: string;
  /** The supporting line: a team award's pairing, or an individual's team. */
  secondary: string | null;
}

export interface PredictionsPayload {
  kind: 'predictions';
  eyebrow: string;
  /** The pundit, shown as the card headline. */
  analyst: string;
  /** For the filename, e.g. "the-commissioner". */
  slug: string;
  /** Six picks, always in award order. */
  picks: PredictionPickPayload[];
}

/**
 * The six awards, in the order every card lists them. `team` awards resolve a
 * colour to its pairing; `player` awards resolve a name to its colour.
 */
const PREDICTION_CATEGORIES = [
  { label: 'Champions', field: 'champions', kind: 'team' },
  { label: 'Minor Premiers', field: 'minorPremiers', kind: 'team' },
  { label: 'MVP', field: 'mvp', kind: 'player' },
  { label: 'Finals MVP', field: 'finalsMvp', kind: 'player' },
  { label: 'Wooden Spoon', field: 'woodenSpoon', kind: 'team' },
  { label: 'Most Improved', field: 'mostImproved', kind: 'player' },
] as const;

/**
 * One card per analyst — their six picks, resolved against the season's draft.
 *
 * Presentation only, like every builder here: the pairing behind a colour and
 * the colour a player wears both come from the season config, so a bare "Yellow"
 * still prints its two players and a bare name still wears its team. A pick that
 * resolves to no team or no player throws rather than posting a blank — this card
 * gets published, so a silent miss is worse than a loud one.
 */
export async function predictionsPayloads(
  season: number
): Promise<PredictionsPayload[]> {
  const cfg = await getSeasonConfig(season);
  const teams = cfg?.teams;
  if (!cfg || !teams) {
    throw new Error(
      `Season ${season} has no teams in src/config/seasons/season-${season}.ts, ` +
        `so the analysts' picks can't be resolved to colours and pairings.`
    );
  }

  /** A colour's pairing, captain-first as the config lists it: "L. Sharrock & J. Raines". */
  const pairingOf = (team: string): string => {
    const pair = teams[team]?.pair;
    if (!pair?.length) {
      throw new Error(
        `Prediction names team "${team}", which has no pairing in season ${season}.`
      );
    }
    return pair.map(shortName).join(' & ');
  };

  /** The colour a named player wears this season — found by searching the pairings. */
  const teamOf = (player: string): string => {
    const hit = Object.entries(teams).find(([, t]) => t.pair?.includes(player));
    if (!hit) {
      throw new Error(
        `Prediction names "${player}", who isn't in any season ${season} pairing. ` +
          `Check the spelling against season-${season}.ts.`
      );
    }
    return hit[0];
  };

  return ANALYSTS.map((a: AnalystPredictions) => ({
    kind: 'predictions',
    eyebrow: `The Analysts · ${eyebrowLabel(season)}`,
    analyst: a.analyst,
    slug: slugify(a.analyst),
    picks: PREDICTION_CATEGORIES.map((c) => {
      const value = a[c.field];
      if (c.kind === 'team') {
        return { category: c.label, team: value, primary: value, secondary: pairingOf(value) };
      }
      const team = teamOf(value);
      return { category: c.label, team, primary: value, secondary: team };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Pair board — two players' record as team-mates
// ---------------------------------------------------------------------------

export interface PairStatRowPayload {
  label: string;
  /** Already formatted for print, in the board's two-column order. */
  a: string;
  b: string;
  /** The larger of the two, for the emphasis the template puts on a lead.
   * 'a', 'b', or null when they are level or the stat wasn't recorded.
   *
   * Always the bigger number, never "the better one" — the same rule the stat
   * boards follow. Leading the unforced errors is still leading them; it's
   * `polarity` that tells the template to colour it as the disgrace it is. */
  lead: 'a' | 'b' | null;
  /** 'low' where a big number is a bad number, for the template's colour. */
  polarity: 'high' | 'low';
}

export interface PairSeasonRowPayload {
  label: string;
  team: string;
  record: string;
}

export interface PairBoardPayload {
  kind: 'pair-board';
  id: string;
  eyebrow: string;
  /** "Ed Simpson & Jimmy Gorton". */
  title: string;
  /** The two names again, split for the stat columns. */
  a: string;
  b: string;
  teamA: string | null;
  teamB: string | null;
  record: string;
  matchesLine: string;
  gamesLine: string;
  seasons: PairSeasonRowPayload[];
  stats: PairStatRowPayload[];
  footnote: string;
}

/**
 * The stats the board prints, in order. Deliberately counting stats only —
 * a rate would need `SITE.perGameMinGames` and a footnote explaining the
 * denominator, and this board is meant to be read at a glance.
 */
const PAIR_STATS: {
  label: string;
  stat: CountingStat;
  polarity: 'high' | 'low';
}[] = [
  { label: 'Winners', stat: 'winners', polarity: 'high' },
  { label: 'Aces', stat: 'aces', polarity: 'high' },
  { label: 'Unforced errors', stat: 'unforcedErrors', polarity: 'low' },
  { label: 'Double faults', stat: 'doubleFaults', polarity: 'low' },
  { label: 'Votes', stat: 'votes', polarity: 'high' },
];

/**
 * Two players' partnership, one slide.
 *
 * **Refused, not rendered, when the pair played together in a sealed season.**
 * The board carries votes and best-on-ground, both vote-derived, so the same
 * rule the MVP race lives under applies here — and it is checked against the
 * seasons the pair actually shared rather than the current one, because a pair
 * board is an all-time post with no round to speak of.
 */
export function pairBoardPayload(a: string, b: string): PairBoardPayload {
  const rec = pairRecord(a, b, rows);
  if (!rec) {
    throw new Error(
      `${a} and ${b} have never played a match as team-mates, so there is no ` +
        `pair board to render. Check the spelling against the canonical names ` +
        `in src/config/aliases.ts.`
    );
  }

  const sealed = rec.seasons.map((s) => s.season).filter(isVotesSealed);
  if (sealed.length) {
    throw new SealedVotesError(
      `${a} & ${b} played together in season ${sealed.join(', ')}, whose votes ` +
        `are sealed (SITE.sealedVoteSeasons), so the pair board can't be ` +
        `rendered — it carries votes and best-on-ground. Remove the season ` +
        `from sealedVoteSeasons once the votes are public.`
    );
  }

  const [aggA, aggB] = rec.members;
  // A blank stat cell is null, never 0, so a stat neither of them ever
  // recorded prints as a dash rather than as a pair of honest-looking zeroes.
  const cell = (v: number | null) => (v === null ? '—' : String(v));
  const lead = (x: number | null, y: number | null): 'a' | 'b' | null =>
    x === null || y === null || x === y ? null : x > y ? 'a' : 'b';

  const stats: PairStatRowPayload[] = PAIR_STATS.map(({ label, stat, polarity }) => {
    const x = aggA.tally[stat].total;
    const y = aggB.tally[stat].total;
    return { label, a: cell(x), b: cell(y), lead: lead(x, y), polarity };
  });
  // BOG is a count of matches, not a stat cell, so it sits outside PAIR_STATS.
  stats.push({
    label: 'Best on ground',
    a: String(aggA.bog),
    b: String(aggB.bog),
    lead: lead(aggA.bog, aggB.bog),
    polarity: 'high',
  });

  const notes = ['Finals and fill-in matches included'];
  // Only footnote the rescale when it actually rescaled something.
  if (aggA.votesEraAdjusted || aggB.votesEraAdjusted) {
    notes.push('S1 votes scaled to the 3-2-1 era');
  }

  return {
    kind: 'pair-board',
    id: `pair-${slugify(a)}-${slugify(b)}`,
    eyebrow: 'Together',
    title: `${a} & ${b}`,
    a: shortName(a),
    b: shortName(b),
    teamA: currentTeamForChip(a),
    teamB: currentTeamForChip(b),
    record: `${rec.wins}\u2013${rec.losses}`,
    matchesLine: `${rec.matches} matches together`,
    gamesLine: `${rec.gamesFor}\u2013${rec.gamesAgainst} games`,
    seasons: rec.seasons.map((s) => ({
      label: `S${s.season}`,
      team: s.team,
      record: `${s.wins}\u2013${s.losses}`,
    })),
    stats,
    footnote: notes.join(' \u00b7 '),
  };
}

// ---------------------------------------------------------------------------
// MVP simulation board
// ---------------------------------------------------------------------------

/**
 * The MVP race as a Monte Carlo projection — where each player finishes across
 * thousands of simulated runs of the rounds still to come.
 *
 * **Why this board is exempt from `sealedVoteSeasons`.** Every other
 * vote-derived board is refused for a sealed season, because it would print the
 * recorded tally that's meant to be a surprise on awards night. This one prints
 * a *projection* produced by a model outside this repo, and posting it is a
 * deliberate editorial decision: the point of the graphic is to tease the race
 * while it's still live. The sealed check is untouched for every board that
 * reads the `votes` column — `statBoardPayload` and `pairBoardPayload` still
 * throw — so nothing here weakens the rule it sits beside. If the projection
 * should go back to being sealed, don't render it: it's a once-off post, out of
 * the default `--only` set, and it needs an explicit `--sim <path>`.
 *
 * **No arithmetic.** The percentages and the vote figures are read out of the
 * summary file by `mvp-sim.ts` and printed. This builder sorts, splits into
 * slides, formats for print and normalises a percentage to a 0–1 tone. That's
 * the whole of it.
 */
export interface MvpSimCellPayload {
  /** As printed: "98.4", "100", "0". */
  value: string;
  /** 0–1 share, for the template's heatmap wash. */
  tone: number;
}

export interface MvpSimRowPayload {
  rank: number;
  player: string;
  /** CSV team name, or null for a player the season config doesn't place. */
  team: string | null;
  cells: MvpSimCellPayload[];
  /** Projected final tally — the median run. */
  votes: string;
}

export interface MvpSimPayload {
  kind: 'mvp-sim';
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Column heads over the four percentage cells. */
  columns: string[];
  votesLabel: string;
  footnote: string;
  rows: MvpSimRowPayload[];
  /** `1` and `2` of a two-slide carousel; used for the filename. */
  slide: number;
  slides: number;
}

/** Ranks per slide. Ten rows is the stat board's own rhythm at this type size. */
const MVP_SIM_PER_SLIDE = 10;

const MVP_SIM_COLUMNS = ['MVP (%)', 'Top 3 (%)', 'Top 5 (%)', 'Top 10 (%)'] as const;

/**
 * `98.4` → "98.4", `100` → "100", `0` → "0". Trailing ".0" is dropped because a
 * column of "100.0" and "93.0" reads as false precision at this size, and the
 * source file gives one decimal for everything.
 */
function formatSimPct(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '');
}

/** Votes are whole in every run the model reports, so print them whole. */
function formatSimVotes(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export async function mvpSimPayloads(
  path: string,
  season: number,
  round: RoundRef | null,
  opts: { runs?: number } = {}
): Promise<{ slides: MvpSimPayload[]; warnings: string[] }> {
  const { rows: sim, warnings } = await loadMvpSim(path, season);

  // Ranked by the projected tally itself — an MVP race is a vote count, and
  // ranking on the number the board prints is what keeps that column reading
  // top to bottom. Mean, then MVP chance, then name break the ties, so the
  // order is total and the same on every run.
  const ranked = [...sim].sort(
    (x, y) =>
      y.medianVotes - x.medianVotes ||
      y.meanVotes - x.meanVotes ||
      y.first - x.first ||
      x.player.localeCompare(y.player)
  );

  const total = Math.ceil(ranked.length / MVP_SIM_PER_SLIDE);
  const runsNote = opts.runs ? `${opts.runs.toLocaleString('en-AU')} runs` : 'Simulated';
  const after = round ? `After ${round.label}` : 'Pre-season';

  const slides: MvpSimPayload[] = [];
  for (let s = 0; s < total; s += 1) {
    const chunk = ranked.slice(s * MVP_SIM_PER_SLIDE, (s + 1) * MVP_SIM_PER_SLIDE);
    const from = s * MVP_SIM_PER_SLIDE + 1;

    slides.push({
      kind: 'mvp-sim',
      eyebrow: eyebrowLabel(season),
      title: 'MVP Simulation',
      // No slide range in the subtitle and no footnote: the two slides carry
      // the same header on purpose, so they read as one carousel rather than
      // as two boards. The filename is what tells them apart.
      subtitle: `${runsNote} · ${after}`,
      columns: [...MVP_SIM_COLUMNS],
      votesLabel: 'Median Votes',
      footnote: '',
      rows: chunk.map((r, i) => ({
        rank: from + i,
        player: r.player,
        team: r.team,
        cells: [r.first, r.top3, r.top5, r.top10].map((v) => ({
          value: formatSimPct(v),
          tone: Math.min(Math.max(v / 100, 0), 1),
        })),
        votes: formatSimVotes(r.medianVotes),
      })),
      slide: s + 1,
      slides: total,
    });
  }

  return { slides, warnings };
}
