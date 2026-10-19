/**
 * `stats.ts` → the data objects the templates render.
 *
 * The rule this file exists to enforce: **nothing here computes a statistic.**
 * Every number comes out of `src/lib/stats.ts` and every quirk out of
 * `src/lib/normalize.ts`. What's left is presentation — labels, ordering,
 * rounding for display — and that's all a payload builder is allowed to do.
 * A ladder derived twice is a ladder that can disagree with itself.
 */

import { loadStatRows, normalizeRows, parseRound } from '../../src/lib/normalize.ts';
import {
  isPartial,
  isPlayedMatch,
  ladderWithPairings,
  leaderboard,
  matchSides,
  playerAgg,
  lineupPairingName,
  seasonRounds as matchRoundsFor,
  winStreaks,
  winStreakRun,
  streakEndLabel,
  pairRecord,
  rivalryRecord,
  finalsDroughts,
  matchPlayerLines,
  MATCH_LINE_STATS,
  seasonMatches,
  sealVotes,
  strikeWithdrawnMatches,
  strikeWithdrawnVotes,
  teamRoster,
  tiebreakSeasons,
  type CountingStat,
  type LeaderStat,
  type PlayerAgg,
  type StatScope,
  type StreakRunMatch,
} from '../../src/lib/stats.ts';
import { STREAK_NOTES } from './streak-notes.ts';
import { withdrawnTeams as withdrawnOf } from '../../src/config/seasons/schema.ts';
import { insightsFor } from '../../src/lib/insights.ts';
import { formatDate, formatDateLong, formatTime } from '../../src/lib/datetime.ts';
import type { FinalsStage, MatchSide, SetScore, StatRow } from '../../src/lib/types.ts';
import { SITE, isVotesSealed } from '../../src/config/site.ts';
import { PHOTOS_DIR, leadPhoto, playerPhotos, type Photo } from '../../src/lib/photos.ts';
import {
  allSeasonConfigs,
  getSeasonConfig,
  seasonTeamConfigs,
  declaredTeams,
  withdrawnTeams,
  seasonFinalsBerths,
} from './season-configs.ts';
import { playerSlug, shortName, slugify } from '../../src/config/aliases.ts';
import { ANALYSTS, type AnalystPredictions } from './predictions.ts';
import { loadMvpSim } from './mvp-sim.ts';
import { longestMatches, pairSplit, pointsPlayedSeasons, teamPoints } from '../../src/lib/points.ts';
import { bracketLayout, type EdgeKind } from '../../src/lib/bracket.ts';
import type { FinalsSlot } from '../../src/config/seasons/schema.ts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Votes earned against a withdrawn team come pre-struck and a sealed season's
// votes come blank, as on the site — see `strikeWithdrawnVotes` and `sealVotes`.
// The blanking is what keeps a sealed season out of a *career* or all-time
// board, which the per-season refusal below can't see. The Node config loader
// is async, hence the await.
const withdrawnBySeason = new Map(
  (await allSeasonConfigs()).map((c) => [c.season, withdrawnOf(c)] as const)
);
export const rows: StatRow[] = sealVotes(
  strikeWithdrawnVotes(loadStatRows(), (season) => withdrawnBySeason.get(season) ?? [])
);

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
  /** As typed: "9", "WC", "QF", "F". */
  input: string;
  /** Sort key — finals sort after every home-and-away round. */
  round: number;
  stage: FinalsStage | null;
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
  WC: 'Wildcard',
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
  /** Above the finals cutoff — every row when the ladder is drawn without one. */
  qualifies: boolean;
}

export interface LadderPayload {
  kind: 'ladder';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  /** null = no finals cut drawn (`--no-cut`): no line, nobody greyed out. */
  finalsCutoff: number | null;
  rows: LadderRowPayload[];
}

/**
 * How many teams play finals, when a season has no bracket to read it off —
 * the league's standing rule of a top eight. A bracket always wins: S5's takes
 * all nine.
 */
const DEFAULT_FINALS_CUTOFF = 8;

export async function ladderPayload(
  season: number,
  round: RoundRef,
  opts: { finalsCutoff?: number; noCut?: boolean } = {}
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

  // `noCut` draws the plain table: with eight of nine teams going through, the
  // line only ever singles out last place. A bracket that takes the whole
  // field (S5) draws no line either, and says so.
  const berths =
    opts.finalsCutoff ?? (await seasonFinalsBerths(season)) ?? DEFAULT_FINALS_CUTOFF;
  const everyone = berths >= table.length;
  const cutoff = opts.noCut || everyone ? null : berths;
  const complete =
    round.stage !== null || homeAndAwayComplete(season, round.round);
  const when = complete ? 'Home & away complete' : `After ${round.label}`;

  return {
    kind: 'ladder',
    eyebrow: eyebrowLabel(season),
    title: complete ? 'Final Ladder' : 'Standings',
    subtitle:
      cutoff !== null
        ? `${when} · Top ${cutoff} play finals`
        : everyone && !opts.noCut
          ? `${when} · Everyone plays finals`
          : when,
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
      qualifies: cutoff === null || r.rank <= cutoff,
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
  /** A finals tie — the card takes the gold "Finals" mark. */
  finals: boolean;
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
  // A forfeit counts on the ladder (`matchSides` keeps it for that) but has
  // no night to put on a card.
  const sides = matchSides(rows, season, 'all').filter(
    (s) => s.round === round.round && !s.forfeit
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
      finals: round.stage !== null,
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

// ---------------------------------------------------------------------------
// Player slides — one per player, after a match's result card
// ---------------------------------------------------------------------------

export interface PlayerSlideStat {
  label: string;
  /** Printed as is: "12", or "–" when the stat wasn't recorded. */
  value: string;
  /** "Most on court", "Joint fewest"… null when he sits at neither end. */
  tag: string | null;
  /** Gold for a good end of the court, red for leading the errors. */
  tone: 'good' | 'bad' | null;
  /** The line under a number with no tag: his season rate. */
  context: string | null;
}

export interface PlayerSlidePayload {
  kind: 'player-slide';
  finals: boolean;
  /** "Season 5 · 2026" — shown only off a finals round, where the mark isn't. */
  eyebrow: string;
  roundLabel: string;
  player: { first: string; last: string; team: string; fillIn: boolean };
  /** file:// URL, or null for the court-green field. */
  photo: string | null;
  /** False when the photo is a fallback from the manifest, not from this match. */
  photoFromMatch: boolean;
  stats: PlayerSlideStat[];
  /** The result card's slug — `white-v-green` — so the slides file beside it. */
  match: string;
  /** 1-based, the same numbering as the result cards. */
  matchIndex: number;
  /** 2–5: the result card is slide 1. */
  slide: number;
  playerSlug: string;
}

const LINE_LABEL = { winners: 'Winners', errorsForced: 'Errors forced', unforcedErrors: 'Unforced errors' };

/**
 * Four slides per match: one per player, winners first, captain first within
 * a side. The numbers and where each sits on court come from
 * `matchPlayerLines` (stats.ts); this only labels them. A match with no
 * player stats recorded — a scoreline-only final — is left out and named in
 * `unrecorded`, since four slides of dashes say nothing.
 *
 * `photos` maps a player slug to an image from the night; anyone missing one
 * falls back to his latest solo photo of the season, flagged
 * `photoFromMatch: false` so the CLI can say so.
 */
export async function playerSlidePayloads(
  season: number,
  round: RoundRef,
  opts: { photos?: Record<string, string> } = {}
): Promise<{ slides: PlayerSlidePayload[]; unrecorded: string[] }> {
  const cards = await resultCardPayloads(season, round);
  const matches = seasonMatches(rows, season).filter((m) => m.round === round.round);
  const teamConfig = await seasonTeamConfigs(season);
  const slides: PlayerSlidePayload[] = [];
  const unrecorded: string[] = [];

  cards.forEach((card, i) => {
    const teams = card.sides.map((s) => s.team);
    const m = matches.find((x) => teams.every((t) => x.sides.some((s) => s.team === t)));
    if (!m) return;
    const lines = matchPlayerLines(m, rows);
    if (!lines.some((l) => MATCH_LINE_STATS.some((k) => l.stats[k].value !== null))) {
      unrecorded.push(card.slug);
      return;
    }
    // Captain first: the order of the season config's `pair`, CSV order after.
    const at = (l: (typeof lines)[number]) => {
      const n = teamConfig(l.team)?.pair?.indexOf(l.player) ?? -1;
      return n < 0 ? 99 : n;
    };
    const ordered = [...lines].sort((a, b) => Number(b.won) - Number(a.won) || at(a) - at(b));
    const multiSet = m.sides[0].setScores.length > 1;

    ordered.forEach((l, j) => {
      const slug = playerSlug(l.player);
      const words = l.player.split(' ');
      const given = opts.photos?.[slug];
      const shot = given ? null : leaderPhoto(slug, season);
      slides.push({
        kind: 'player-slide',
        finals: round.stage !== null,
        eyebrow: eyebrowLabel(season),
        roundLabel: round.label,
        player: {
          first: words.slice(0, -1).join(' '),
          last: words.at(-1)!,
          team: l.team,
          fillIn: l.isFillIn,
        },
        photo: given ?? (shot ? photoUrl(shot.file) : null),
        photoFromMatch: Boolean(given),
        stats: MATCH_LINE_STATS.map((k) => {
          const v = l.stats[k];
          // Leading the court is good for winners and errors forced; for
          // unforced errors the good end is the other one.
          const good = k === 'unforcedErrors' ? 'fewest' : 'most';
          const tagged = v.standing === good || (k === 'unforcedErrors' && v.standing === 'most');
          const tag = tagged
            ? v.joint
              ? `Joint ${v.standing}`
              : `${v.standing === 'most' ? 'Most' : 'Fewest'} on court`
            : null;
          return {
            label: LINE_LABEL[k],
            value: v.value === null ? '–' : String(v.value),
            tag,
            tone: tagged ? (v.standing === good ? 'good' : 'bad') : null,
            context:
              v.seasonPerSet === null
                ? null
                : `Season rate ${v.seasonPerSet.toFixed(1)}${multiSet ? ' a set' : ''}`,
          };
        }),
        match: card.slug,
        matchIndex: i + 1,
        slide: j + 2,
        playerSlug: slug,
      });
    });
  });
  return { slides, unrecorded };
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
  WC: 'Wildcard',
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
 * human input at all. A forfeit isn't on it: nothing was played.
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
    .filter(isPlayedMatch)
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
// Finals format
// ---------------------------------------------------------------------------

/**
 * Pixel sizes for `finals-format.html`. They live here, not in the template,
 * because the layout needs two of them before it can run: a line lands on the
 * row it fills (`slot`) and a tie with two exits splits them (`port`), and
 * `bracketLayout` works in units of `unit`. The template draws with the same
 * numbers it's handed.
 */
const FINALS_GEOMETRY = {
  /** The safe width the rounds share, and the gap between two of them. */
  frame: 952,
  gap: 36,
  /** One unit down the page: five units (S5's busiest round) fill the field. */
  unit: 168,
  /** Tie centre to the middle of either row: 8px padding + 1px border + half a 52px row. */
  slot: 35,
  port: 14,
  lane: 9,
  /** A tie's row height — `slot` is derived from it. */
  row: 52,
} as const;

/**
 * The fixture's taller rows: a team row carries a colour, a seed and a
 * pairing, not just "1st". Unit unchanged, so five rows still fill the field;
 * the gap between two stacked ties narrows to ~26px.
 */
const FIXTURE_GEOMETRY = {
  ...FINALS_GEOMETRY,
  /** 8px padding + 1px border + half a 62px row. */
  slot: 40,
  row: 62,
} as const;

export interface FinalsSlotPayload {
  /** A seed prints as "1st"; a reference as its kind over the tie it comes from. */
  seed: string | null;
  kind: EdgeKind | null;
  from: string | null;
  /** The fixture only: the team sitting in that seed on the final ladder. */
  team?: string;
  pairing?: string;
}

export interface FinalsTiePayload {
  id: string;
  /** Set into the tie's top border: the config's `label`, else its id. */
  tag: string;
  col: number;
  pos: number;
  doubleChance: boolean;
  home: FinalsSlotPayload;
  away: FinalsSlotPayload;
}

export interface FinalsFormatPayload {
  kind: 'finals-format' | 'finals-fixture';
  eyebrow: string;
  title: string;
  /** Replaces the winner/loser key in the footer; null keeps the key. */
  footnote: string | null;
  /** FINALS_GEOMETRY plus the tie width, which depends on how many rounds share the frame. */
  geometry: { [K in keyof typeof FINALS_GEOMETRY]: number } & { width: number };
  rounds: string[];
  span: number;
  ties: FinalsTiePayload[];
  edges: {
    kind: EdgeKind;
    fromCol: number;
    toCol: number;
    y1: number;
    y2: number;
    stacked: boolean;
    lane: number;
    lanes: number;
  }[];
}

/**
 * The season's finals bracket as a structure explainer: seeds and "winner of"
 * / "loser of" slots, no teams — the post that announces a format, not a
 * fixture. Reads the bracket shape off the season config and lays it out with
 * `bracketLayout`, the same as the season page, so the two can't disagree.
 */
export async function finalsFormatPayload(
  season: number,
  opts: { title?: string } = {}
): Promise<FinalsFormatPayload> {
  return bracketPayload(season, FINALS_GEOMETRY, {
    kind: 'finals-format',
    title: opts.title ?? 'The New Finals',
    footnote: null,
  });
}

/**
 * The same bracket as a fixture: every seed slot names the team that finished
 * there, off the same ladder the site and the ladder graphic print. Refused
 * until the home-and-away season is over — before that, the seeds are a
 * projection, and a posted fixture that changes next week is worse than none.
 *
 * Later rounds stay "Winner QF1": a winner is a result, and the results
 * belong to the result cards and the scoreboard.
 */
export async function finalsFixturePayload(
  season: number,
  opts: { title?: string; footnote?: string } = {}
): Promise<FinalsFormatPayload> {
  if (rows.some((r) => r.season === season && !r.isFinals && r.scheduled)) {
    throw new Error(
      `Season ${season} still has home-and-away fixtures to play — the finals seeds aren't settled yet.`
    );
  }
  const teamConfig = await seasonTeamConfigs(season);
  const table = ladderWithPairings(
    season,
    rows.filter((r) => !r.isFinals),
    teamConfig,
    await declaredTeams(season),
    await withdrawnTeams(season)
  );
  return bracketPayload(season, FIXTURE_GEOMETRY, {
    kind: 'finals-fixture',
    title: opts.title ?? 'Finals Fixture',
    footnote: opts.footnote ?? null,
    seed: (n) => {
      const l = table[n - 1];
      return l ? { team: l.team, pairing: l.pairingName } : null;
    },
  });
}

async function bracketPayload(
  season: number,
  g: { [K in keyof typeof FINALS_GEOMETRY]: number },
  opts: {
    kind: FinalsFormatPayload['kind'];
    title: string;
    footnote: string | null;
    seed?: (n: number) => { team: string; pairing: string } | null;
  }
): Promise<FinalsFormatPayload> {
  const finals = (await getSeasonConfig(season))?.finals;
  if (!finals?.length) {
    throw new Error(`Season ${season} has no finals bracket in src/config/seasons/season-${season}.ts.`);
  }
  const width = Math.floor((g.frame - (finals.length - 1) * g.gap) / finals.length);
  const layout = bracketLayout(finals, { slot: g.slot / g.unit, port: g.port / g.unit });

  const slot = (s: FinalsSlot): FinalsSlotPayload =>
    'seed' in s
      ? { seed: ordinal(s.seed), kind: null, from: null, ...(opts.seed?.(s.seed) ?? {}) }
      : 'winnerOf' in s
        ? { seed: null, kind: 'winner', from: s.winnerOf }
        : { seed: null, kind: 'loser', from: s.loserOf };

  return {
    kind: opts.kind,
    eyebrow: `Finals · ${eyebrowLabel(season)}`,
    title: opts.title,
    footnote: opts.footnote,
    geometry: { ...g, width },
    rounds: finals.map((r) => r.name),
    span: layout.span,
    ties: layout.columns.flatMap((c) =>
      c.ties.map((t) => ({
        id: t.match.id,
        tag: t.match.label ?? t.match.id,
        col: t.col,
        pos: t.pos,
        doubleChance: t.doubleChance,
        home: slot(t.match.home),
        away: slot(t.match.away),
      }))
    ),
    edges: layout.edges.map(({ kind, fromCol, toCol, y1, y2, stacked, lane, lanes }) => ({
      kind, fromCol, toCol, y1, y2, stacked, lane, lanes,
    })),
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
  /**
   * Leave out matches against a team that withdrew that season, as the ladder
   * and the honours' stat leaders do (`strikeWithdrawnMatches`). For a season
   * total, where one extra match is a head start.
   */
  strikeWithdrawn?: boolean;
  /** Print a leader's photo in the hero band. Absent photo = no band. */
  showPhoto?: boolean;
  /** A transparent cut-out sits flush; a normal photo gets a framed crop. */
  cutout?: boolean;
  /**
   * Which of the leader's eligible photos to use, wrapping round. Default 0.
   * Ignored when the board is built as part of a carousel (`Pictured`), which
   * picks the next unused frame itself.
   */
  photoIndex?: number;
  /** The words beside the leader's big number. Default `metricLabel`. */
  heroUnit?: string;
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
  hero: { player: string; value: string; unit: string; photo: string; cutout: boolean } | null;
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

/**
 * The leader's photo. A season board only ever pictures that season — a
 * leaderboard for 2026 fronted by a 2023 frame reads as a mistake, and the kit
 * is usually wrong — so it takes solo shots tagged with that season and nothing
 * else; no photo means no hero, and the plain board renders. A career board
 * takes the lead gallery photo — the site's avatar unless the player has an
 * `avatar: true` headshot, which is cut for a 120px tile and too small to
 * front a 1080px slide.
 */
export function leaderPhoto(slug: string, season?: number, index = 0): Photo | null {
  if (season === undefined) return leadPhoto(slug);
  const mine = playerPhotos(slug).filter((p) => p.season === season && p.players.length === 1);
  return mine.length ? mine[index % mine.length] : null;
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

/**
 * Who a carousel has pictured so far, and how many times: slug → count. Thread
 * one through a run of boards and a player who leads several of them gets a
 * different frame each time (while there's one left), and a shared lead is
 * fronted by whichever tied leader has been on screen least.
 */
export type Pictured = Map<string, number>;

export function statBoardPayload(spec: StatBoardSpec, pictured?: Pictured): StatBoardPayload {
  const {
    stat,
    season,
    perSet: rate = false,
    polarity = 'high',
    includeFillIns = false,
  } = spec;
  // The spotlight takes the leader out of the table and costs about two more
  // rows of canvas, so a photo board shows #1 up top and #2–#8 beneath. (If
  // there turns out to be no photo, the plain board just shows eight.)
  const rowCount = spec.rows ?? (spec.showPhoto ? 8 : 10);

  if (VOTE_STATS.has(stat) && season !== undefined && isVotesSealed(season)) {
    throw new SealedVotesError(
      `Season ${season}'s votes are sealed (SITE.sealedVoteSeasons), so the ` +
        `"${spec.title}" board can't be rendered. Remove ${season} from ` +
        `sealedVoteSeasons once the votes are public — until then this board ` +
        `would post the count that's meant to be a surprise.`
    );
  }

  const gone = spec.strikeWithdrawn && season !== undefined ? withdrawnBySeason.get(season) ?? [] : [];
  const source = gone.length ? strikeWithdrawnMatches(rows, (s) => (s === season ? gone : [])) : rows;

  const board = leaderboard(stat, source, {
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
  // One clause when both apply — two "… excluded" notes wrap the footer.
  const struck = gone.length ? `matches v ${gone.join(' & ')}` : '';
  if (!includeFillIns) notes.push(struck ? `Fill-ins & ${struck} excluded` : 'Fill-in matches excluded');
  else if (struck) notes.push(`M${struck.slice(1)} excluded`);
  if (rate) notes.push(`Min. ${spec.minGames ?? SITE.perGameMinGames} matches`);
  if (spec.note) notes.push(spec.note);

  // A shared lead is one rank, so who fronts it is presentation. In a carousel
  // it goes to the tied leader pictured least so far — rank order breaks a
  // tie, and only someone with a photo to show can take it. The template
  // pictures rows[0] and prints every row level with it as =1.
  const seen = (slug: string) => pictured?.get(slug) ?? 0;
  if (spec.showPhoto && pictured && payloadRows.length > 1) {
    const front = payloadRows
      .filter((r) => r.value === payloadRows[0].value && leaderPhoto(r.slug, season))
      .sort((a, b) => seen(a.slug) - seen(b.slug))[0];
    if (front && front !== payloadRows[0]) {
      payloadRows.splice(payloadRows.indexOf(front), 1);
      payloadRows.unshift(front);
      payloadRows.forEach((r, i) => (r.rank = i + 1));
    }
  }

  const leader = payloadRows[0];
  const index = pictured && leader ? seen(leader.slug) : spec.photoIndex;
  const photo = spec.showPhoto && leader ? leaderPhoto(leader.slug, season, index) : null;
  if (photo && pictured) pictured.set(leader.slug, seen(leader.slug) + 1);

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
            unit: spec.heroUnit ?? spec.metricLabel,
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
// Streak story — one player's live streak as a carousel
// ---------------------------------------------------------------------------

/**
 * One chip on the rail that runs along the foot of every slide: the loss the
 * run began after, a W per win, and an open slot for the next fixture while
 * the run is alive. Every slide carries the whole rail and lights its own
 * stretch of it, so swiping reads like a strip of film.
 */
export interface StreakChipPayload {
  kind: 'L' | 'W' | 'next';
  /** 1-based win number for a W. */
  n: number | null;
  /** For the season ticks under the rail. */
  season: number;
}

export interface StreakRailPayload {
  chips: StreakChipPayload[];
  /** Inclusive chip-index range this slide lights. */
  lit: [number, number];
}

export interface StreakMatchPayload {
  /** 1-based win number inside the run; null for the loss either side of it. */
  n: number | null;
  /** "R4", "QF", "Final". */
  round: string;
  season: number;
  team: string;
  pairing: string;
  opponent: string;
  opponentPairing: string;
  /** The streaker's side of the scoreline, and the other side's. */
  sets: SetPayload[];
  opponentSets: SetPayload[];
  won: boolean;
  /** Won a grand final. */
  title: boolean;
  note: string | null;
}

interface StreakSlideBase {
  kind: 'streak-story';
  /** 1-based, for the filename and the "2 / 5" counter. */
  index: number;
  total: number;
  player: string;
  rail: StreakRailPayload;
}

export interface StreakCoverSlide extends StreakSlideBase {
  slide: 'cover';
  team: string;
  streak: number;
  active: boolean;
  /** "A TNT record", "Equals the TNT record", or null. */
  status: string | null;
  photo: string | null;
  facts: { value: string; label: string }[];
}

export interface StreakBeforeSlide extends StreakSlideBase {
  slide: 'before';
  match: StreakMatchPayload;
  /** What came after it: "He hasn’t lost since." while the run is alive. */
  since: string;
}

export interface StreakChapterSlide extends StreakSlideBase {
  slide: 'chapter';
  /** "Chapter I". */
  chapter: string;
  season: number;
  team: string;
  /** "With Angus Hume". */
  partners: string;
  record: string;
  photo: string | null;
  matches: StreakMatchPayload[];
}

export interface StreakRecordSlide extends StreakSlideBase {
  slide: 'record';
  team: string;
  rows: {
    rank: number;
    player: string;
    team: string | null;
    streak: number;
    active: boolean;
    self: boolean;
    /** "His partner for 9 of the 14" — the record book's link to this run. */
    note: string | null;
  }[];
  next: {
    round: string;
    date: string | null;
    time: string | null;
    opponent: string;
    opponentPairing: string;
  } | null;
}

export type StreakStorySlide =
  | StreakCoverSlide
  | StreakBeforeSlide
  | StreakChapterSlide
  | StreakRecordSlide;

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const FINALS_ROUND = { WC: 'Wildcard', QF: 'Qualifying Final', SF: 'Semi Final', F: 'Grand Final' } as const;

const photoUrl = (file: string) => pathToFileURL(resolve(PHOTOS_DIR, file)).href;

/**
 * The streak carousel: a cover, the loss it began after, one chapter per
 * season-and-team the run passed through, and the record book with the next
 * fixture. Every count comes off `winStreakRun`; this only lays it out.
 *
 * `player` defaults to whoever holds the longest live streak. Photos default
 * to the manifest — the player's latest photo in the run's last season for the
 * cover, his first (solo preferred) in each chapter's season — and can be
 * overridden slide by slide.
 */
export async function streakStoryPayloads(
  player?: string,
  opts: { cover?: string; chapters?: (string | undefined)[] } = {}
): Promise<StreakStorySlide[]> {
  const who = player ?? winStreaks(rows).find((s) => s.active)?.player;
  if (!who) throw new Error('Nobody is on a live win streak.');
  const run = winStreakRun(who, rows);
  if (!run) throw new Error(`${who} has never won a match, so there's no streak to tell.`);

  const configs = new Map<number, Awaited<ReturnType<typeof seasonTeamConfigs>>>();
  const configFor = async (season: number) => {
    if (!configs.has(season)) configs.set(season, await seasonTeamConfigs(season));
    return configs.get(season)!;
  };

  const matchPayload = async (v: StreakRunMatch, n: number | null): Promise<StreakMatchPayload> => {
    const cfg = await configFor(v.match.season);
    return {
      n,
      round: v.match.stage ? FINALS_ROUND[v.match.stage] : `R${v.match.round}`,
      season: v.match.season,
      team: v.side.team,
      pairing: lineupPairingName(v.side.players, cfg(v.side.team)),
      opponent: v.opposition.team,
      opponentPairing: lineupPairingName(v.opposition.players, cfg(v.opposition.team)),
      sets: setsFor(v.side),
      opponentSets: setsFor(v.opposition),
      won: v.side.win,
      title: v.match.stage === 'F' && v.side.win,
      note: STREAK_NOTES[v.match.key] ?? null,
    };
  };

  // --- The rail ------------------------------------------------------------
  const chips: StreakChipPayload[] = [
    ...(run.before ? [{ kind: 'L' as const, n: null, season: run.before.match.season }] : []),
    ...run.matches.map((v, i) => ({ kind: 'W' as const, n: i + 1, season: v.match.season })),
    ...(run.next ? [{ kind: 'next' as const, n: null, season: run.next.match.season }] : []),
  ];
  const offset = run.before ? 1 : 0;
  const winsLit = (from: number, to: number): StreakRailPayload['lit'] => [offset + from, offset + to];

  // --- Chapters: consecutive matches for the same season and team ----------
  const chapters: { season: number; team: string; from: number; to: number }[] = [];
  run.matches.forEach((v, i) => {
    const last = chapters.at(-1);
    if (last && last.season === v.match.season && last.team === v.side.team) last.to = i;
    else chapters.push({ season: v.match.season, team: v.side.team, from: i, to: i });
  });

  const seasonPhoto = (season: number, pick: 'first' | 'last') => {
    const mine = playerPhotos(slugify(who)).filter((p) => p.season === season);
    const solo = mine.filter((p) => p.players.length === 1);
    const pool = solo.length && pick === 'first' ? solo : mine;
    const photo = pick === 'first' ? pool[0] : pool.at(-1);
    return photo ? photoUrl(photo.file) : null;
  };
  const override = (p: string | undefined) => (p ? pathToFileURL(resolve(p)).href : undefined);

  const board = winStreaks(rows);
  const rivals = board.filter((s) => s.player !== who);
  const status =
    rivals.every((s) => s.streak < run.streak)
      ? 'A TNT record'
      : rivals.every((s) => s.streak <= run.streak)
        ? 'Equals the TNT record'
        : null;
  const lastTeam = run.matches.at(-1)!.side.team;

  const slides: Omit<StreakStorySlide, 'index' | 'total'>[] = [];

  slides.push({
    kind: 'streak-story',
    slide: 'cover',
    player: who,
    team: lastTeam,
    streak: run.streak,
    active: run.active,
    status,
    photo: override(opts.cover) ?? seasonPhoto(run.seasons.at(-1)!, 'last'),
    facts: [
      { value: String(run.opponentsBeaten.length), label: 'players beaten' },
      { value: `${run.gamesFor}–${run.gamesAgainst}`, label: 'games' },
      { value: String(run.partners.length), label: run.partners.length === 1 ? 'partner' : 'partners' },
      { value: String(run.seasons.length), label: run.seasons.length === 1 ? 'season' : 'seasons' },
      ...(run.titles ? [{ value: String(run.titles), label: run.titles === 1 ? 'flag' : 'flags' }] : []),
    ],
    rail: { chips, lit: winsLit(0, run.matches.length - 1) },
  } as StreakCoverSlide);

  if (run.before) {
    slides.push({
      kind: 'streak-story',
      slide: 'before',
      player: who,
      match: await matchPayload(run.before, null),
      since: run.active ? 'He hasn’t lost since.' : `Then came ${run.streak} straight.`,
      rail: { chips, lit: [0, 0] },
    } as StreakBeforeSlide);
  }

  for (const [i, c] of chapters.entries()) {
    const span = run.matches.slice(c.from, c.to + 1);
    const mates = [...new Set(span.flatMap((v) => v.partners))];
    slides.push({
      kind: 'streak-story',
      slide: 'chapter',
      player: who,
      chapter: `Chapter ${NUMERALS[i] ?? i + 1}`,
      season: c.season,
      team: c.team,
      partners: mates.length ? `With ${mates.join(' & ')}` : '',
      record: `${span.length}–0`,
      photo: override(opts.chapters?.[i]) ?? seasonPhoto(c.season, 'first'),
      matches: await Promise.all(span.map((v, j) => matchPayload(v, c.from + j + 1))),
      rail: { chips, lit: winsLit(c.from, c.to) },
    } as StreakChapterSlide);
  }

  const next = run.next;
  const nextCfg = next ? await configFor(next.match.season) : null;
  slides.push({
    kind: 'streak-story',
    slide: 'record',
    player: who,
    team: lastTeam,
    rows: board.slice(0, 5).map((s, i) => {
      const shared = run.partners.find((p) => p.player === s.player)?.matches ?? 0;
      return {
        rank: i + 1,
        player: s.player,
        team: currentTeamForChip(s.player),
        streak: s.streak,
        active: s.active,
        self: s.player === who,
        note: shared ? `His partner for ${shared} of the ${run.streak}` : null,
      };
    }),
    next: next
      ? {
          round: next.match.stage ? FINALS_ROUND[next.match.stage] : `Round ${next.match.round}`,
          date: formatDate(next.match.start),
          time: formatTime(next.match.start),
          opponent: next.opposition.team,
          opponentPairing: lineupPairingName(next.opposition.players, nextCfg!(next.opposition.team)),
        }
      : null,
    rail: { chips, lit: [0, chips.length - 1] },
  } as StreakRecordSlide);

  return slides.map((s, i) => ({ ...s, index: i + 1, total: slides.length }) as StreakStorySlide);
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
// Rivalry board — two players' record against each other
// ---------------------------------------------------------------------------

export interface RivalrySetPayload {
  a: number;
  b: number;
  /** Tiebreak points, printed small on the loser's side. */
  tbA: number | null;
  tbB: number | null;
}

export interface RivalryMeetingPayload {
  /** "S1 R9", "S4 Final". */
  label: string;
  teamA: string;
  teamB: string;
  winner: 'a' | 'b';
  sets: RivalrySetPayload[];
}

export interface RivalryBoardPayload {
  kind: 'rivalry-board';
  id: string;
  eyebrow: string;
  title: string;
  a: string;
  b: string;
  teamA: string | null;
  teamB: string | null;
  winsA: number;
  winsB: number;
  meetings: RivalryMeetingPayload[];
  stats: PairStatRowPayload[];
}

/**
 * Counting stats only, like the pair board. **No votes and no BOG**: that is
 * what lets this board skip the sealed-season check — two players who met in
 * S5 still get a board, because nothing on it reads the `votes` column.
 */
const RIVALRY_STATS: { label: string; stat: CountingStat; polarity: 'high' | 'low' }[] = [
  { label: 'Winners', stat: 'winners', polarity: 'high' },
  { label: 'Errors forced', stat: 'errorsForced', polarity: 'high' },
  { label: 'Aces', stat: 'aces', polarity: 'high' },
  { label: 'Unforced errors', stat: 'unforcedErrors', polarity: 'low' },
  { label: 'Double faults', stat: 'doubleFaults', polarity: 'low' },
];

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name;

export function rivalryBoardPayload(a: string, b: string): RivalryBoardPayload {
  const rec = rivalryRecord(a, b, rows);
  if (!rec) {
    throw new Error(
      `${a} and ${b} have never played a match against each other. Check the ` +
        `spelling against the canonical names in src/config/aliases.ts.`
    );
  }
  const [aggA, aggB] = rec.members;
  const cell = (v: number | null) => (v === null ? '\u2014' : String(v));
  const lead = (x: number | null, y: number | null): 'a' | 'b' | null =>
    x === null || y === null || x === y ? null : x > y ? 'a' : 'b';
  const row = (label: string, x: number | null, y: number | null, polarity: 'high' | 'low') =>
    ({ label, a: cell(x), b: cell(y), lead: lead(x, y), polarity });

  return {
    kind: 'rivalry-board',
    id: `rivalry-${slugify(a)}-${slugify(b)}`,
    eyebrow: 'Head to head',
    // Surnames: two full names don't fit the headline on one line.
    title: `${surname(a)} v ${surname(b)}`,
    a: shortName(a),
    b: shortName(b),
    teamA: currentTeamForChip(a),
    teamB: currentTeamForChip(b),
    winsA: rec.wins,
    winsB: rec.losses,
    meetings: rec.matches.map((m) => ({
      label: `S${m.season} ${m.isFinals ? m.roundLabel : `R${m.round}`}`,
      teamA: m.teams[0],
      teamB: m.teams[1],
      winner: m.win ? 'a' : 'b',
      sets: m.setScores.map((s) => ({
        a: s.for,
        b: s.against,
        tbA: s.tiebreakFor,
        tbB: s.tiebreakAgainst,
      })),
    })),
    stats: [
      row('Sets', rec.setsFor, rec.setsAgainst, 'high'),
      row('Games', rec.gamesFor, rec.gamesAgainst, 'high'),
      ...RIVALRY_STATS.map(({ label, stat, polarity }) =>
        row(label, aggA.tally[stat].total, aggB.tally[stat].total, polarity)
      ),
    ],
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

// ---------------------------------------------------------------------------
// Points — the points ladder and the pair split
//
// Both read `src/lib/points.ts`, which rebuilds every point from the box score
// (winners, aces, UEs and double faults once each; forced errors once per
// direction). Neither does any counting here — only ranking and print.
// ---------------------------------------------------------------------------

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export interface PointsLadderRowPayload {
  /** Position by share of points won. */
  rank: number;
  team: string;
  pairing: string;
  won: number;
  lost: number;
  /** "58.0%" */
  share: string;
  /** Percentage points either side of an even split, for the bar: 8.0, -2.5. */
  edge: number;
  /** "6th" — where the actual ladder has them. */
  ladder: string;
  /**
   * Ladder position less points position. Positive: the ladder has them lower
   * than their points would. Zero when the two agree.
   */
  gap: number;
}

export interface PointsLadderPayload {
  kind: 'points-ladder';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  rows: PointsLadderRowPayload[];
}

/**
 * The season's teams ranked by share of points won, beside where the real
 * ladder has them. Same field as the ladder — declared teams, withdrawn ones
 * off — and the same window, home and away up to `round`.
 */
export async function pointsLadderPayload(
  season: number,
  round: RoundRef
): Promise<PointsLadderPayload> {
  const upToRound = rows.filter((r) => r.round <= round.round);
  const table = ladderWithPairings(
    season,
    upToRound,
    await seasonTeamConfigs(season),
    await declaredTeams(season),
    await withdrawnTeams(season)
  );
  const onLadder = new Map(table.map((r) => [r.team, r]));
  const points = teamPoints(upToRound, season).filter((p) => onLadder.has(p.team));

  const complete = round.stage !== null || homeAndAwayComplete(season, round.round);
  return {
    kind: 'points-ladder',
    eyebrow: eyebrowLabel(season),
    title: 'The Points Ladder',
    subtitle: complete ? 'Home & away · every point counted' : `After ${round.label} · every point counted`,
    footnote: '',
    rows: points.map((p, i) => {
      const l = onLadder.get(p.team)!;
      return {
        rank: i + 1,
        team: p.team,
        pairing: l.pairingName,
        won: p.won,
        lost: p.lost,
        share: `${(p.share * 100).toFixed(1)}%`,
        edge: Math.round((p.share * 100 - 50) * 10) / 10,
        ladder: ordinal(l.rank),
        gap: l.rank - (i + 1),
      };
    }),
  };
}

export interface PairSplitSidePayload {
  name: string;
  /** "75%" */
  share: string;
  /** 0–100, for the bar. */
  pct: number;
}

export interface PairSplitRowPayload {
  team: string;
  /** The heavier hitter first. */
  players: [PairSplitSidePayload, PairSplitSidePayload];
  matches: number;
}

export interface PairSplitPayload {
  kind: 'pair-split';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  rows: PairSplitRowPayload[];
}

/**
 * Ball hogs: each active team's pair, split by share of the point-ending
 * shots between them, most lopsided first. The pair is the season config's
 * present-tense `pair`, falling back to the roster's core two, and only the
 * matches the two actually played together count — a fill-in night isn't
 * theirs to split.
 */
export async function pairSplitPayload(
  season: number,
  round: RoundRef
): Promise<PairSplitPayload> {
  const upToRound = rows.filter((r) => r.round <= round.round);
  const config = await seasonTeamConfigs(season);
  const table = ladderWithPairings(
    season,
    upToRound,
    config,
    await declaredTeams(season),
    await withdrawnTeams(season)
  );

  const out: PairSplitRowPayload[] = [];
  for (const { team } of table) {
    const pair = config(team)?.pair ?? teamRoster(team, season, upToRound).core.map((c) => c.player);
    if (pair.length !== 2) continue;
    const split = pairSplit(upToRound, pair[0], pair[1], { season, scope: 'regular' });
    if (!split) continue;
    const sides = split.players
      .map((name, i) => ({ name: shortName(name), share: split.shares[i] }))
      .sort((a, b) => b.share - a.share);
    out.push({
      team,
      players: sides.map((s) => ({
        name: s.name,
        share: `${Math.round(s.share * 100)}%`,
        pct: s.share * 100,
      })) as [PairSplitSidePayload, PairSplitSidePayload],
      matches: split.matches,
    });
  }
  out.sort((a, b) => b.players[0].pct - a.players[0].pct || a.team.localeCompare(b.team));

  return {
    kind: 'pair-split',
    eyebrow: eyebrowLabel(season),
    title: 'Ball Hogs',
    subtitle: 'Matches played together',
    footnote: '',
    rows: out,
  };
}

export interface LongestSidePayload {
  team: string;
  pairing: string;
  sets: SetPayload[];
  /** From the CSV's `win?`. */
  won: boolean;
  /** Points this side won. */
  points: number;
}

export interface LongestRowPayload {
  rank: number;
  /** "S3 · R9" */
  when: string;
  /** Winner first. */
  sides: [LongestSidePayload, LongestSidePayload];
  total: number;
  games: number;
  /** The round's own longest match, the one the post is about. */
  featured: boolean;
  /** Printed below a break because it sits outside the top rows. */
  detached: boolean;
}

export interface LongestMatchesPayload {
  kind: 'longest-matches';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  /** "Round 6" — the tag on the featured row. Null when the round has no countable match. */
  featuredTag: string | null;
  rows: LongestRowPayload[];
}

/**
 * The longest home-and-away matches on record, by points played
 * (`longestMatches()` in points.ts), with `round`'s own longest match lit —
 * and appended below the table if it didn't make it, so the post it was
 * rendered for always has its match on the slide.
 */
export async function longestMatchesPayload(
  season: number,
  round: RoundRef,
  opts: { limit?: number } = {}
): Promise<LongestMatchesPayload> {
  const limit = opts.limit ?? 8;
  const ranked = longestMatches(rows);
  const featured = ranked.find(
    (mp) => mp.match.season === season && mp.match.round === round.round
  );
  const picked = ranked.slice(0, limit);
  const detached = featured && !picked.includes(featured);
  if (detached) picked.push(featured);

  const out: LongestRowPayload[] = [];
  for (const mp of picked) {
    const m = mp.match;
    const config = await seasonTeamConfigs(m.season);
    const side = (i: 0 | 1): LongestSidePayload => ({
      team: m.sides[i].team,
      pairing: lineupPairingName(m.sides[i].players, config(m.sides[i].team)),
      sets: setsFor(m.sides[i]),
      won: m.sides[i].win,
      points: mp.sides[i].won,
    });
    const [a, b] = [side(0), side(1)];
    out.push({
      rank: mp.rank,
      when: `S${m.season} · R${m.round}`,
      sides: b.won ? [b, a] : [a, b],
      total: mp.total,
      games: mp.games,
      featured: mp === featured,
      detached: mp === featured && !!detached,
    });
  }

  return {
    kind: 'longest-matches',
    eyebrow: 'All-time · Home & away',
    title: 'The Long Nights',
    subtitle: `Most points in a match · ${ranked.length} matches counted`,
    footnote: '',
    featuredTag: featured ? (round.stage ? ROUND_TITLE[round.stage] : `Round ${round.round}`) : null,
    rows: out,
  };
}

export interface TiebreakRowPayload {
  rank: number;
  team: string;
  /** "Season 5" */
  when: string;
  pairing: string;
  tiebreaks: number;
  won: number;
  lost: number;
  matches: number;
  /** The record holder. */
  featured: boolean;
}

export interface TiebreakPayload {
  kind: 'tiebreaks';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  /** file:// URL, or null to render on the court-green field. */
  photo: string | null;
  rows: TiebreakRowPayload[];
  /** The next tier down, too many to print as rows: "4= · Three each". */
  restLabel: string | null;
  rest: { team: string; when: string }[];
}

const COUNT_WORD = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/**
 * The most tiebreaks played by one team in a home-and-away season
 * (`tiebreakSeasons()` in stats.ts). Rows down to third place, ties included;
 * the tier after that is named as chips, because six teams on three would
 * otherwise push the record off the slide.
 *
 * The photo defaults to the latest gallery shot from the record season tagged
 * with both of the record team's pair — the present-tense `pair`, so S5 Green
 * is Feikema and Hume. `photo` overrides it with a file path.
 */
export async function tiebreakPayload(opts: { photo?: string } = {}): Promise<TiebreakPayload> {
  const all = tiebreakSeasons(rows).filter((t) => t.tiebreaks > 0);
  const shown = all.filter((t) => t.rank <= 3);
  const nextRank = all.find((t) => t.rank > 3)?.rank;
  const rest = nextRank === undefined ? [] : all.filter((t) => t.rank === nextRank);

  const out: TiebreakRowPayload[] = [];
  for (const t of shown) {
    const config = await seasonTeamConfigs(t.season);
    out.push({
      rank: t.rank,
      team: t.team,
      when: `Season ${t.season}`,
      pairing: teamRoster(t.team, t.season, rows, config(t.team)).pairingName ?? '',
      tiebreaks: t.tiebreaks,
      won: t.won,
      lost: t.lost,
      matches: t.matches,
      featured: t === all[0],
    });
  }

  let photo: string | null = null;
  if (opts.photo) {
    photo = pathToFileURL(resolve(opts.photo)).href;
  } else if (all[0]) {
    const top = all[0];
    const config = await seasonTeamConfigs(top.season);
    const pair = (config(top.team)?.pair ??
      teamRoster(top.team, top.season, rows).core.map((c) => c.player)).map(playerSlug);
    const shot = playerPhotos(pair[0] ?? '')
      .filter((p) => p.season === top.season && pair.every((s) => p.players.includes(s)))
      .at(-1);
    if (shot) photo = photoUrl(shot.file);
  }

  const top = all[0];
  return {
    kind: 'tiebreaks',
    eyebrow: 'All-time · Home & away',
    title: 'Most Tiebreaks in a Season',
    subtitle: top ? `${top.team} went to a breaker in ${top.tiebreaks} of ${top.matches} matches` : '',
    footnote: '',
    photo,
    rows: out,
    restLabel: nextRank === undefined ? null : `${nextRank}${rest.length > 1 ? '=' : ''} · ${COUNT_WORD[rest[0].tiebreaks] ?? rest[0].tiebreaks} each`,
    rest: rest.map((t) => ({ team: t.team, when: `S${t.season}` })),
  };
}

export interface PointsPlayedRowPayload {
  rank: number;
  player: string;
  /** "Season 5" */
  when: string;
  /** In playing order — two when the player moved mid-season. */
  teams: string[];
  points: number;
  matches: number;
  /** "73.3" */
  perMatch: string;
  featured: boolean;
}

export interface PointsPlayedPayload {
  kind: 'points-played';
  eyebrow: string;
  title: string;
  subtitle: string;
  footnote: string;
  photo: string | null;
  rows: PointsPlayedRowPayload[];
}

/**
 * Most points played in a home-and-away season (`pointsPlayedSeasons()` in
 * points.ts), with matches against a withdrawn team struck for its opponents
 * and kept for its own players. The record holder is lit and fronts the slide:
 * their latest solo shot from that season, else the latest they're tagged in.
 */
export async function pointsPlayedPayload(
  opts: { photo?: string; limit?: number } = {}
): Promise<PointsPlayedPayload> {
  const ranked = pointsPlayedSeasons(rows, (season) => withdrawnBySeason.get(season) ?? []);
  const top = ranked[0];

  let photo: string | null = null;
  if (opts.photo) {
    photo = pathToFileURL(resolve(opts.photo)).href;
  } else if (top) {
    const mine = playerPhotos(playerSlug(top.player)).filter((p) => p.season === top.season);
    const shot = mine.filter((p) => p.players.length === 1).at(-1) ?? mine.at(-1);
    if (shot) photo = photoUrl(shot.file);
  }

  return {
    kind: 'points-played',
    eyebrow: 'All-time · Home & away',
    title: 'Most Points Played in a Season',
    subtitle: top
      ? `${shortName(top.player)}: ${top.points} points across ${top.matches} matches`
      : '',
    footnote: '',
    photo,
    rows: ranked.slice(0, opts.limit ?? 6).map((r) => ({
      rank: r.rank,
      player: r.player,
      when: `Season ${r.season}`,
      teams: r.teams,
      points: r.points,
      matches: r.matches,
      perMatch: r.perMatch.toFixed(1),
      featured: r === top,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tie preview — one finals tie as a fight poster
// ---------------------------------------------------------------------------

export interface TiePlayerPayload {
  name: string;
  captain: boolean;
  /** file:// URL, or null for no picture. */
  photo: string | null;
  /** A transparent PNG: drawn free-standing rather than as a faded frame. */
  cutout: boolean;
}

export interface TieFormPayload {
  /** "R7". */
  label: string;
  opponent: string;
  won: boolean;
  /** Awarded, not played — still a result on the ladder, so still a chip. */
  forfeit: boolean;
}

export interface TieSidePayload {
  team: string;
  /** "8th". */
  seed: string;
  /** Captain first, as the ladder prints it. */
  pairing: string;
  players: TiePlayerPayload[];
  wins: number;
  losses: number;
  /** Games ratio, rounded for print — the ladder's own number. */
  ratio: string;
  /** The last few home-and-away results, oldest first. */
  form: TieFormPayload[];
}

export interface TiePreviewPayload {
  kind: 'tie-preview';
  /** The tie's id in the season config — "QF2". */
  tie: string;
  eyebrow: string;
  title: string;
  /** "8th v 9th". */
  tag: string;
  /** When it's on — "Tonight", a date. Empty prints the tag alone. */
  subtitle: string;
  /** The fixture's `Start`, as the sign at the courts reads it. Null if not drawn with one. */
  date: string | null;
  time: string | null;
  sides: [TieSidePayload, TieSidePayload];
  /** Their home-and-away meeting this season, winner's sets first. */
  meeting: {
    label: string;
    winner: string;
    sets: RivalrySetPayload[];
    /** "B. Coutinho filled in for Orange" — a line-up that wasn't the pair. */
    note: string | null;
  } | null;
  /** "Winner plays Yellow (1st) in QF1". */
  stakes: string;
  /** "Loser's season is over", or where a double chance sends them. */
  stakesLose: string;
}

const TIE_TITLE: Record<string, string> = {
  WC: 'Wildcard',
  QF: 'Quarter Final',
  SF: 'Semi Final',
  F: 'Grand Final',
};

/**
 * One finals tie as a poster: both pairs pictured, their records off the final
 * ladder, their form, the night they met in the home and away, and what's at
 * stake. A slot is a ladder position, or the winner (or loser) of a tie whose
 * result is already in the CSV — QF1 once the wildcard is played. Refused
 * while home-and-away fixtures remain (the seeds aren't settled) and for a tie
 * fed by a result still to come.
 *
 * `photos` is four paths, home captain first: home captain, home partner, away
 * captain, away partner. A `.png` is taken as a cutout. Missing ones fall back
 * to the player's own photos for the season.
 */
export async function tiePreviewPayload(
  season: number,
  tieId: string,
  opts: { photos?: (string | undefined)[]; title?: string; subtitle?: string; formLength?: number } = {}
): Promise<TiePreviewPayload> {
  if (rows.some((r) => r.season === season && !r.isFinals && r.scheduled)) {
    throw new Error(
      `Season ${season} still has home-and-away fixtures to play — the finals seeds aren't settled yet.`
    );
  }
  const finals = (await getSeasonConfig(season))?.finals ?? [];
  const ties = finals.flatMap((r) => r.matches);
  const tie = ties.find((m) => m.id === tieId);
  if (!tie) {
    throw new Error(
      `Season ${season} has no finals tie "${tieId}" (has: ${ties.map((m) => m.id).join(', ') || 'none'}).`
    );
  }
  const teamConfig = await seasonTeamConfigs(season);
  const gone = await withdrawnTeams(season);
  const table = ladderWithPairings(
    season,
    rows.filter((r) => !r.isFinals),
    teamConfig,
    await declaredTeams(season),
    gone
  );
  const atSeed = (n: number) => {
    const l = table[n - 1];
    if (!l) throw new Error(`Season ${season}'s ladder has no ${ordinal(n)} for ${tieId}.`);
    return l;
  };

  // Home-and-away results, forfeits in and none against a withdrawn team — the
  // same matches the ladder's record is built from, so the chips add up to it.
  // A meeting has to have been played, so that one leaves the forfeits out.
  const matches = seasonMatches(rows, season);
  const results = matches.filter(
    (m) => !m.scheduled && !m.isFinals && !m.sides.some((s) => gone.includes(s.team))
  );
  const homeAway = results.filter(isPlayedMatch);
  // A tie's match in the CSV, played or only drawn: its stage is the id with
  // the number stripped (QF2 -> QF), its teams whoever the slots resolve to.
  const tieMatch = (t: (typeof ties)[number], teams: string[]) =>
    matches.find(
      (m) =>
        m.isFinals &&
        m.stage === t.id.replace(/\d+$/, '') &&
        teams.every((team) => m.sides.some((s) => s.team === team))
    );
  // The ladder position a slot resolves to: a seed as drawn, or whoever came
  // out of an earlier tie — off its `win?`, never the bracket's own `result`.
  const seedOf = (slot: FinalsSlot): number => {
    if ('seed' in slot) return slot.seed;
    const fromId = 'winnerOf' in slot ? slot.winnerOf : slot.loserOf;
    const from = ties.find((m) => m.id === fromId);
    if (!from) throw new Error(`${tieId} is fed by "${fromId}", which isn't in the bracket.`);
    const pair = [seedOf(from.home), seedOf(from.away)];
    const winner = tieMatch(from, pair.map((n) => atSeed(n).team))?.winner;
    if (!winner) {
      throw new Error(`${tieId} is fed by another tie's result (${fromId}) that isn't in the CSV yet.`);
    }
    const won = pair.find((n) => atSeed(n).team === winner)!;
    return 'winnerOf' in slot ? won : pair.find((n) => n !== won)!;
  };

  const photo = (path: string | undefined, name: string): { photo: string | null; cutout: boolean } => {
    if (path) return { photo: pathToFileURL(resolve(path)).href, cutout: /\.png$/i.test(path) };
    const shot = leaderPhoto(playerSlug(name), season);
    return { photo: shot ? photoUrl(shot.file) : null, cutout: false };
  };

  const side = (seed: number, offset: number): TieSidePayload => {
    const l = atSeed(seed);
    const pair =
      teamConfig(l.team)?.pair ?? teamRoster(l.team, season, rows).core.map((c) => c.player);
    const form = results
      .filter((m) => m.sides.some((s) => s.team === l.team))
      .slice(-(opts.formLength ?? 5))
      .map((m) => {
        const other = m.sides.find((s) => s.team !== l.team)!;
        return { label: `R${m.round}`, opponent: other.team, won: m.winner === l.team, forfeit: m.forfeit };
      });
    return {
      team: l.team,
      seed: ordinal(seed),
      pairing: l.pairingName,
      players: pair.slice(0, 2).map((name, i) => ({
        name,
        captain: i === 0,
        ...photo(opts.photos?.[offset + i], name),
      })),
      wins: l.wins,
      losses: l.losses,
      ratio: l.ratio.toFixed(2),
      form,
    };
  };
  const home = side(seedOf(tie.home), 0);
  const away = side(seedOf(tie.away), 2);
  const start = tieMatch(tie, [home.team, away.team])?.start ?? null;

  const met = homeAway.filter((m) =>
    [home.team, away.team].every((t) => m.sides.some((s) => s.team === t))
  ).at(-1);
  let meeting: TiePreviewPayload['meeting'] = null;
  if (met) {
    const won = met.sides.find((s) => s.team === met.winner) ?? met.sides[0];
    const fillIns = met.sides.flatMap((s) =>
      s.players.filter((p) => p.isFillIn).map((p) => `${shortName(p.player)} filled in for ${s.team}`)
    );
    meeting = {
      label: `Round ${met.round}`,
      winner: won.team,
      sets: won.setScores.map((s) => ({
        a: s.for,
        b: s.against,
        tbA: s.tiebreakFor,
        tbB: s.tiebreakAgainst,
      })),
      note: fillIns.length ? fillIns.join(' · ') : null,
    };
  }

  // Where the winner goes — the tie this one feeds — and whether the loser
  // gets a second life anywhere.
  const next = ties.find((m) =>
    [m.home, m.away].some((s) => 'winnerOf' in s && s.winnerOf === tieId)
  );
  let stakes = 'Winner goes through';
  if (next) {
    const waiting = [next.home, next.away].find((s) => !('winnerOf' in s && s.winnerOf === tieId))!;
    // Whoever is already waiting there, or the two who could be.
    const feeder = 'winnerOf' in waiting ? ties.find((m) => m.id === waiting.winnerOf) : undefined;
    let could: string[] | null = null;
    try {
      could = feeder ? [seedOf(feeder.home), seedOf(feeder.away)].map((n) => atSeed(n).team) : null;
    } catch {
      // fed in turn by a result still to come — say no more than where it goes
    }
    stakes =
      'seed' in waiting
        ? `Winner plays ${atSeed(waiting.seed).team} (${ordinal(waiting.seed)}) in ${next.id}`
        : could
          ? `Winner plays ${could.join(' or ')} in ${next.id}`
          : `Winner goes to ${next.id}`;
  }
  const second = ties.find((m) =>
    [m.home, m.away].some((s) => 'loserOf' in s && s.loserOf === tieId)
  );
  const stakesLose = second ? `Loser goes to ${second.id}` : 'Loser’s season is over';

  return {
    kind: 'tie-preview',
    tie: tieId,
    eyebrow: `Finals · ${eyebrowLabel(season)}`,
    title: opts.title ?? TIE_TITLE[tieId.replace(/\d+$/, '')] ?? tie.label ?? tieId,
    tag: `${home.seed} v ${away.seed}`,
    subtitle: opts.subtitle ?? '',
    date: formatDate(start),
    time: formatTime(start),
    sides: [home, away],
    meeting,
    stakes,
    stakesLose,
  };
}

// ---------------------------------------------------------------------------
// Finals drought — played finals, never won one
// ---------------------------------------------------------------------------

export interface DroughtChipPayload {
  /** "S1 QF". */
  label: string;
  team: string;
  fillIn: boolean;
  /** Played in the season the board is about — drawn with a gold edge. */
  current: boolean;
}

export interface DroughtRowPayload {
  /** "1", or "=1" for a shared place. */
  rank: string;
  player: string;
  /** "0–4". */
  record: string;
  chips: DroughtChipPayload[];
  /** "Next: QF2 v Red" for a player still in this season's finals. */
  note: string | null;
}

export interface FinalsDroughtPayload {
  kind: 'finals-drought';
  eyebrow: string;
  title: string;
  subtitle: string;
  /** The pictured player, out of the table. */
  feature: DroughtRowPayload & { photo: string | null; cutout: boolean; joint: string | null };
  rows: DroughtRowPayload[];
  /** Only when a fill-in final is on the board. */
  footnote: string;
}

/**
 * Four rows for a finals tie that hasn't been entered yet, as if `winner` had
 * won it: the line-ups are the season config's pairs, the stage the tie's id
 * (digits stripped), and no score or stats — `finalsRecords` reads only who
 * played and `win?`. For the post that has to be ready before the night it
 * describes. Refused once the real result is in the CSV, so a hypothetical
 * can never be rendered over a fact.
 */
async function assumedResult(season: number, tieId: string, winner: string): Promise<StatRow[]> {
  const ties = ((await getSeasonConfig(season))?.finals ?? []).flatMap((r) => r.matches);
  const tie = ties.find((m) => m.id === tieId);
  if (!tie) throw new Error(`Season ${season} has no finals tie "${tieId}".`);
  if (!('seed' in tie.home) || !('seed' in tie.away)) {
    throw new Error(`--assume only works on a tie between two seeds; ${tieId} is fed by another tie.`);
  }
  const teamConfig = await seasonTeamConfigs(season);
  const table = ladderWithPairings(
    season,
    rows.filter((r) => !r.isFinals),
    teamConfig,
    await declaredTeams(season),
    await withdrawnTeams(season)
  );
  const teams = [tie.home.seed, tie.away.seed].map((n) => table[n - 1]?.team);
  if (teams.some((t) => !t)) throw new Error(`${tieId}'s seeds aren't on the ladder yet.`);
  if (!teams.includes(winner)) {
    throw new Error(`--assume: ${winner} isn't in ${tieId} (${teams.join(' v ')}).`);
  }
  const stage = tieId.replace(/\d+$/, '');
  if (rows.some((r) => r.season === season && r.stage === stage && teams.includes(r.team) && !r.scheduled)) {
    throw new Error(`${tieId} is already in the CSV — drop --assume and use the real result.`);
  }
  const raws = teams.flatMap((team, i) => {
    const opponent = teams[1 - i]!;
    const pair = teamConfig(team!)?.pair ?? [];
    if (pair.length < 2) throw new Error(`Season ${season} config has no pair for ${team}.`);
    return pair.map((player) => ({
      Team: team!, Opponent: opponent, Season: String(season), Round: stage,
      Player: player, 'win?': team === winner ? 'TRUE' : 'FALSE',
    }));
  });
  return normalizeRows(raws);
}

/**
 * Everyone who has played finals and never won one, the longest wait
 * pictured. `finalsDroughts` in stats.ts does the counting; this ranks for
 * print (a shared place reads "=1"), pulls the pictured player out of the
 * table, and notes who on the list is still in this season's bracket and who
 * they play next.
 *
 * `assume` adds one finals result that isn't in the CSV yet — see
 * `assumedResult` — so the board for either outcome can be made the day
 * before. The board itself never says it was assumed: by the time it's
 * posted, it isn't.
 */
export async function finalsDroughtPayload(
  season: number,
  opts: {
    assume?: { tie: string; winner: string };
    player?: string;
    photo?: string;
    title?: string;
    subtitle?: string;
  } = {}
): Promise<FinalsDroughtPayload> {
  const data = opts.assume
    ? [...rows, ...(await assumedResult(season, opts.assume.tie, opts.assume.winner))]
    : rows;
  const droughts = finalsDroughts(data);
  if (!droughts.length) throw new Error('Nobody has lost every final they played.');

  // This season's bracket: who's seeded where, and who has already gone out.
  const ties = ((await getSeasonConfig(season))?.finals ?? []).flatMap((r) => r.matches);
  const teamConfig = await seasonTeamConfigs(season);
  const gone = await withdrawnTeams(season);
  const homeAwayDone = !data.some((r) => r.season === season && !r.isFinals && r.scheduled);
  const table = homeAwayDone
    ? ladderWithPairings(season, data.filter((r) => !r.isFinals), teamConfig, await declaredTeams(season), gone)
    : [];
  const seasonFinals = data.filter((r) => r.season === season && r.isFinals && !r.scheduled);
  const out = new Set(seasonFinals.filter((r) => !r.win).map((r) => r.team));
  const teamOf = (player: string) =>
    table.find((l) => !gone.includes(l.team) && teamConfig(l.team)?.pair?.includes(player))?.team;
  const seedTie = (team: string) => {
    const seed = table.findIndex((l) => l.team === team) + 1;
    const tie = ties.find((m) => [m.home, m.away].some((s) => 'seed' in s && s.seed === seed));
    if (!tie) return null;
    const other = [tie.home, tie.away].find((s) => !('seed' in s && s.seed === seed))!;
    const played = seasonFinals.some((r) => r.team === team && r.stage === tie.id.replace(/\d+$/, ''));
    const opponent =
      'seed' in other ? table[other.seed - 1]?.team : 'winnerOf' in other ? `winner of ${other.winnerOf}` : null;
    return { tie, opponent, played };
  };
  const noteFor = (player: string): string | null => {
    const team = teamOf(player);
    if (!team || out.has(team)) return null;
    const next = seedTie(team);
    if (!next) return null;
    return next.played ? 'Still alive' : `Next: ${next.tie.id} v ${next.opponent}`;
  };

  const rankOf = (losses: number) => {
    const first = droughts.findIndex((d) => d.losses === losses) + 1;
    const shared = droughts.filter((d) => d.losses === losses).length > 1;
    return `${shared ? '=' : ''}${first}`;
  };
  const toRow = (d: (typeof droughts)[number]): DroughtRowPayload => ({
    rank: rankOf(d.losses),
    player: d.player,
    record: `0–${d.losses}`,
    chips: d.appearances.map((a) => ({
      label: `S${a.season} ${a.stage}`,
      team: a.team,
      fillIn: a.fillIn,
      current: a.season === season,
    })),
    note: noteFor(d.player),
  });

  const lead = opts.player ? droughts.find((d) => d.player === opts.player) : droughts[0];
  if (!lead) throw new Error(`${opts.player} isn't on the list — they've won a final, or never played one.`);
  const tied = droughts.filter((d) => d !== lead && d.losses === lead.losses);
  let photo: string | null = null;
  let cutout = false;
  if (opts.photo) {
    photo = pathToFileURL(resolve(opts.photo)).href;
    cutout = /\.png$/i.test(opts.photo);
  } else {
    const shot = leadPhoto(lead.slug);
    if (shot) photo = photoUrl(shot.file);
  }

  return {
    kind: 'finals-drought',
    eyebrow: 'Finals · All-time',
    title: opts.title ?? 'Still Waiting',
    subtitle: opts.subtitle ?? '',
    feature: {
      ...toRow(lead),
      photo,
      cutout,
      joint: tied.length ? `Joint No. 1 with ${tied.map((t) => shortName(t.player)).join(' & ')}` : null,
    },
    rows: droughts.filter((d) => d !== lead).map(toRow),
    footnote: droughts.some((d) => d.appearances.some((x) => x.fillIn))
      ? 'Dashed: played as a fill-in. A final in borrowed colours still counts.'
      : '',
  };
}
