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
  teamRoster,
  type LeaderStat,
  type PlayerAgg,
  type StatScope,
} from '../../src/lib/stats.ts';
import type { MatchSide, SetScore, StatRow } from '../../src/lib/types.ts';
import { SITE, isVotesSealed } from '../../src/config/site.ts';
import { PHOTOS_DIR, avatarPhoto } from '../../src/lib/photos.ts';
import { getSeasonConfig, seasonTeamConfigs } from './season-configs.ts';
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

/** The last home-and-away round of a season — the one that seeds the finals. */
function lastHomeAndAwayRound(season: number): number {
  const nums = rows
    .filter((r) => r.season === season && !r.isFinals && !r.scheduled)
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

/** One side's sets, from that side's own point of view. */
const setsFor = (s: MatchSide): SetPayload[] =>
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
    const pair = entry?.pair ?? [];
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
function formatValue(stat: LeaderStat, perSetMode: boolean, v: number): string {
  if (stat === 'winPct') return `${Math.round(v * 100)}%`;
  if (stat === 'winnerToUe') return v.toFixed(2);
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
