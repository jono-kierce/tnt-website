import type { FinalsStage, LadderRow, MatchSide, StatRow } from './types.ts';
import { SITE } from '../config/site.ts';
import { shortName } from '../config/aliases.ts';
import { loadStatRows } from './normalize.ts';

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

/**
 * Every season the CSV knows about, including one that has only been drawn —
 * a season page has to exist before its first ball is hit.
 */
export function allSeasons(rows: StatRow[] = loadStatRows()): number[] {
  return [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);
}

const matchKey = (r: { season: number; round: number; team: string; opponent: string }) =>
  `${r.season}|${r.round}|${r.team}|${r.opponent}`;

// ---------------------------------------------------------------------------
// Played vs scheduled
// ---------------------------------------------------------------------------

/**
 * A fixture has no result, so it belongs in no total: not the ladder, not an
 * aggregate, not a leaderboard, not a record, not a streak. `StatRow.scheduled`
 * is where the concept is defined; this is the one gate everything else uses.
 *
 * It's applied inside the entry points below rather than left to callers,
 * because the callers include `graphics/lib/payloads.ts`, which loads the CSV
 * itself. A fixture leaking into a posted graphic is exactly the failure the
 * one-source-of-truth rule exists to prevent.
 */
export const isPlayed = (r: StatRow): boolean => !r.scheduled;

/** Rows for matches that have actually been played. */
export const playedRows = (rows: StatRow[]): StatRow[] => rows.filter(isPlayed);

/** Rows for matches that have been drawn but not yet played. */
export const scheduledRows = (rows: StatRow[]): StatRow[] =>
  rows.filter((r) => r.scheduled);

/**
 * Which matches an aggregate is built from.
 *
 * `regular` is the home-and-away season only. It's the scope for anything that
 * ranks players against each other on a raw total — career leaderboards, the
 * record books — because finals are played by eight teams, not eighteen, and
 * whoever went deepest would top every counting board on volume alone.
 *
 * `all` includes finals. It's the scope for win-loss, head-to-head, streaks and
 * every per-set rate, where the extra matches are the point and the set-based
 * denominator already handles the multi-set inflation.
 *
 * `finals` is the mirror image of `regular` — September only. It's what powers
 * the finals win-loss split and the Finals MVP, which is a separate award
 * (4-3-2-1) that happens to be written into the same `votes` column.
 */
export type StatScope = 'regular' | 'all' | 'finals';

export const inScope = (r: StatRow, scope: StatScope): boolean =>
  scope === 'all' ? true : scope === 'finals' ? r.isFinals : !r.isFinals;

/**
 * Collapse per-player rows into one record per team-side of each match. Uses all
 * rows (including SINGLES GAME) so singles matches still count for the ladder.
 * Defaults to the home-and-away season: the ladder is what seeds the finals, so
 * it must never contain them.
 */
export function matchSides(
  rows: StatRow[],
  season?: number,
  scope: StatScope = 'regular'
): MatchSide[] {
  const seen = new Map<string, MatchSide>();
  for (const r of rows) {
    if (r.scheduled) continue;
    if (season !== undefined && r.season !== season) continue;
    if (!inScope(r, scope)) continue;
    const key = matchKey(r);
    if (seen.has(key)) continue;
    seen.set(key, {
      season: r.season,
      round: r.round,
      stage: r.stage,
      roundLabel: r.roundLabel,
      score: r.score,
      setScores: r.setScores,
      sets: r.sets,
      team: r.team,
      opponent: r.opponent,
      teamScore: r.teamScore,
      opponentScore: r.opponentScore,
      win: r.win,
    });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Matches — the whole fixture, both sides, played or not
// ---------------------------------------------------------------------------

/**
 * One side of a match with its line-up intact.
 *
 * `MatchSide` above collapses a side to its team result, which is what the
 * ladder wants. This keeps the player rows, which is what a match page, the
 * prediction model and the insight detectors all want.
 */
export interface MatchLineup {
  team: string;
  /** The rows for this side, in CSV order. Two of them, normally. */
  players: StatRow[];
  /** Scoreline from this side's point of view; empty for a fixture. */
  score: string;
  setScores: StatRow['setScores'];
  gamesFor: number;
  gamesAgainst: number;
  /** As recorded in `win?`. Always false on both sides of a fixture. */
  win: boolean;
}

/**
 * A whole match: both sides, both line-ups, played or merely drawn.
 *
 * There is exactly one of these per fixture — the two team-sides are folded
 * together and the sides are ordered by team name, so a match has one identity
 * whichever row you found it from. That's what makes a stable URL possible.
 */
export interface MatchRecord {
  /** `season|round|teamA|teamB`, teams sorted. Stable across builds. */
  key: string;
  season: number;
  round: number;
  stage: FinalsStage | null;
  roundLabel: string;
  isFinals: boolean;
  /** No result recorded yet — see StatRow.scheduled. */
  scheduled: boolean;
  /** Both sides, ordered by team name. */
  sides: [MatchLineup, MatchLineup];
  /**
   * The winning team, from `win?` — never from counting sets. Null for a
   * fixture, and also for a played match where nobody recorded a winner.
   */
  winner: string | null;
  /** A real match with no side flagged as the winner. */
  isDraw: boolean;
  /** The SINGLES GAME sentinel stood in for the line-up. */
  isSingles: boolean;
  /**
   * Local start time, `2026-08-18T18:30`, or null where none is recorded.
   * A match-level fact like `score` is: taken from the rows, which all carry
   * the same value. `check-data` is what notices if they ever disagree.
   */
  start: string | null;
}

/**
 * Sort key: season, then round (finals sort last), then start time, then teams.
 *
 * `start` is what puts a round's matches in the order they're actually played
 * — the 6:30 before the 8:30. It sorts as a string because ISO 8601 does that
 * correctly, and it only breaks a tie *within* a round, so a season with no
 * times recorded falls back to the old alphabetical-by-key order unchanged.
 * Untimed matches sort after timed ones rather than jumping to the front.
 */
const byPlayingOrder = (a: MatchRecord, b: MatchRecord) =>
  a.season - b.season ||
  a.round - b.round ||
  (a.start ?? '￿').localeCompare(b.start ?? '￿') ||
  a.key.localeCompare(b.key);

/**
 * Every match in the CSV, folded from per-player rows into whole fixtures.
 * Scheduled and played alike — the `scheduled` flag on each is what tells them
 * apart, so a caller that wants only results filters on it.
 */
export function seasonMatches(
  rows: StatRow[] = loadStatRows(),
  season?: number
): MatchRecord[] {
  const bySide = new Map<string, StatRow[]>();
  for (const r of rows) {
    if (season !== undefined && r.season !== season) continue;
    const key = matchKey(r);
    (bySide.get(key) ?? bySide.set(key, []).get(key)!).push(r);
  }

  const out = new Map<string, MatchRecord>();
  for (const [, side] of bySide) {
    const r = side[0];
    const [teamA, teamB] = [r.team, r.opponent].sort();
    const key = `${r.season}|${r.round}|${teamA}|${teamB}`;
    if (out.has(key)) continue;

    const lineup = (team: string, other: string): MatchLineup => {
      const players = bySide.get(`${r.season}|${r.round}|${team}|${other}`) ?? [];
      const first = players[0];
      return {
        team,
        players,
        score: first?.score ?? '',
        setScores: first?.setScores ?? [],
        gamesFor: first?.teamScore ?? 0,
        gamesAgainst: first?.opponentScore ?? 0,
        win: first?.win ?? false,
      };
    };

    const sides: [MatchLineup, MatchLineup] = [
      lineup(teamA, teamB),
      lineup(teamB, teamA),
    ];
    // A fixture is a whole match's property, not a row's: a half-entered match
    // is still unplayed until both sides have a result.
    const scheduled = sides.some(
      (s) => !s.players.length || s.players.every((p) => p.scheduled)
    );
    const winner = sides.find((s) => s.win)?.team ?? null;

    out.set(key, {
      key,
      season: r.season,
      round: r.round,
      stage: r.stage,
      roundLabel: r.roundLabel,
      isFinals: r.isFinals,
      scheduled,
      sides,
      winner: scheduled ? null : winner,
      // Both sides flagged the same way — nobody won it. TNT has never
      // recorded one, but the model has to do something sane if it ever does.
      isDraw: !scheduled && sides[0].win === sides[1].win,
      isSingles: sides.some((s) => s.players.some((p) => p.isSingles)),
      start: r.start,
    });
  }

  return [...out.values()].sort(byPlayingOrder);
}

/** The matches in one round of one season, played or scheduled. */
export function roundMatches(
  rows: StatRow[],
  season: number,
  round: number
): MatchRecord[] {
  return seasonMatches(rows, season).filter((m) => m.round === round);
}

export interface SeasonRound {
  round: number;
  stage: FinalsStage | null;
  roundLabel: string;
  matches: MatchRecord[];
  /**
   * The night this round is played, `2026-08-18`, or null if no match in it has
   * a start time. Derived from the matches, never stored — a round is a night
   * because its matches are all on one, not the other way around.
   *
   * It's the *earliest* date among them, so a match moved to a later night
   * doesn't drag the round's heading with it. `check-data` warns when a round
   * spans two dates, since that's usually a typo and occasionally a washout.
   */
  date: string | null;
  /** True once any match in the round has a result. */
  played: boolean;
  /**
   * Declared teams with no fixture this round. Derived, never stored.
   *
   * Home-and-away only. Missing out on September isn't a bye, it's a season —
   * a finals round would otherwise list every team that didn't qualify.
   */
  byes: string[];
}

/**
 * A season's rounds in playing order, each with its matches and its byes.
 *
 * `declaredTeams` is the season's full field — see `ladder`. Without it the
 * byes are computed against whoever appears in the CSV that season, which
 * under-reports: a team on a bye in round one, with no fixture drawn yet for
 * any later round, isn't in the CSV at all.
 */
export function seasonRounds(
  rows: StatRow[],
  season: number,
  declaredTeams?: string[]
): SeasonRound[] {
  const matches = seasonMatches(rows, season);
  const field = new Set([
    ...(declaredTeams ?? []),
    ...matches.flatMap((m) => m.sides.map((s) => s.team)),
  ]);

  const byRound = new Map<number, MatchRecord[]>();
  for (const m of matches) {
    (byRound.get(m.round) ?? byRound.set(m.round, []).get(m.round)!).push(m);
  }

  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, ms]) => {
      const playing = new Set(ms.flatMap((m) => m.sides.map((s) => s.team)));
      const dates = ms.map((m) => m.start?.slice(0, 10)).filter((d) => d);
      return {
        round,
        stage: ms[0].stage,
        roundLabel: ms[0].roundLabel,
        matches: ms,
        date: dates.length ? (dates.sort()[0] as string) : null,
        played: ms.some((m) => !m.scheduled),
        byes: ms[0].isFinals ? [] : [...field].filter((t) => !playing.has(t)).sort(),
      };
    });
}

/** The latest round with a result, or null for a season yet to be played. */
export function latestPlayedRound(
  rows: StatRow[],
  season: number
): SeasonRound | null {
  const played = seasonRounds(rows, season).filter((r) => r.played);
  return played.length ? played[played.length - 1] : null;
}

/** The earliest round with a fixture still to play, or null. */
export function nextScheduledRound(
  rows: StatRow[],
  season: number
): SeasonRound | null {
  return seasonRounds(rows, season).find((r) => r.matches.some((m) => m.scheduled)) ?? null;
}

// ---------------------------------------------------------------------------
// Rosters / pairings
// ---------------------------------------------------------------------------

export interface TeamRoster {
  team: string;
  season: number;
  /** Core members (the regular pairing), ordered by games played desc. */
  core: { player: string; games: number }[];
  /** Every player who logged a game for the team (incl. one-off subs). */
  all: { player: string; games: number; fillInGames: number }[];
  /** Display label, e.g. "L. Sharrock & A. Hume". */
  pairingName: string;
  captain?: string;
}

/**
 * Derive a team's roster for a season from the CSV. Team size varies by season,
 * so we don't assume pairs. Core members are those whose non-fill-in games reach
 * `coreMemberMinShare` of the team's matches — this separates the regular
 * pairing from one-off subs (some of which the CSV never flagged as fill-ins).
 * A season config may override the pairing label and set the captain.
 */
export function teamRoster(
  team: string,
  season: number,
  rows: StatRow[],
  override?: { pair?: string[]; captain?: string }
): TeamRoster {
  // Home-and-away only: the regular pairing is who turned up on Tuesdays, and
  // adding up to three finals would skew the core-member threshold. Nights not
  // yet played count for nothing either — a fixture is a plan, not a turnout.
  const teamRows = rows.filter(
    (r) =>
      isPlayed(r) && r.season === season && r.team === team && !r.isSingles && !r.isFinals
  );
  const matches = new Set(teamRows.map((r) => `${r.round}`)).size;
  const threshold = Math.max(2, Math.ceil(matches * SITE.coreMemberMinShare));

  const byPlayer = new Map<string, { games: number; fillInGames: number }>();
  for (const r of teamRows) {
    const e = byPlayer.get(r.player) ?? { games: 0, fillInGames: 0 };
    e.games += 1;
    if (r.isFillIn) e.fillInGames += 1;
    byPlayer.set(r.player, e);
  }

  const all = [...byPlayer.entries()]
    .map(([player, e]) => ({ player, ...e }))
    .sort((a, b) => b.games - a.games || a.player.localeCompare(b.player));

  const core = all
    .filter((p) => p.games - p.fillInGames >= threshold)
    .map((p) => ({ player: p.player, games: p.games }));

  const pairNames =
    override?.pair && override.pair.length
      ? override.pair
      : core.map((c) => c.player);

  return {
    team,
    season,
    core,
    all,
    pairingName: pairNames.map(shortName).join(' & '),
    captain: override?.captain,
  };
}

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

/**
 * Season ladder. Ranked by wins desc, then games ratio (for:against) desc.
 * `pairings` optionally supplies pairing labels (from teamRoster) per team.
 *
 * `declaredTeams` is the season's full field, for a season that has been drawn
 * but not played out. Those teams enter at 0/0/0 so a live season shows every
 * side from the first week rather than filling in as they take the court — and
 * so a team on a bye in round one isn't missing from the table. It can't be
 * read off the CSV: a team whose first fixture is round three has no rows at
 * all yet. `site-data.ts` takes it from the season config.
 */
export function ladder(
  season: number,
  rows: StatRow[] = loadStatRows(),
  pairings?: Record<string, string>,
  declaredTeams?: string[]
): LadderRow[] {
  const sides = matchSides(rows, season);
  const teams = new Map<
    string,
    { matchesPlayed: number; wins: number; gamesFor: number; gamesAgainst: number }
  >();

  for (const team of declaredTeams ?? []) {
    teams.set(team, { matchesPlayed: 0, wins: 0, gamesFor: 0, gamesAgainst: 0 });
  }

  for (const s of sides) {
    const t = teams.get(s.team) ?? {
      matchesPlayed: 0,
      wins: 0,
      gamesFor: 0,
      gamesAgainst: 0,
    };
    t.matchesPlayed += 1;
    if (s.win) t.wins += 1;
    t.gamesFor += s.teamScore;
    t.gamesAgainst += s.opponentScore;
    teams.set(s.team, t);
  }

  const table: LadderRow[] = [...teams.entries()].map(([team, t]) => ({
    team,
    pairingName: pairings?.[team] ?? team,
    matchesPlayed: t.matchesPlayed,
    wins: t.wins,
    losses: t.matchesPlayed - t.wins,
    gamesFor: t.gamesFor,
    gamesAgainst: t.gamesAgainst,
    ratio: t.gamesAgainst === 0 ? t.gamesFor : t.gamesFor / t.gamesAgainst,
    rank: 0,
  }));

  table.sort(
    (a, b) => b.wins - a.wins || b.ratio - a.ratio || a.team.localeCompare(b.team)
  );
  table.forEach((row, i) => (row.rank = i + 1));
  return table;
}

/**
 * The ladder as it's actually displayed: every team's pairing label resolved
 * through `teamRoster` first, so the rows read "L. Sharrock & A. Hume" rather
 * than "Pink", captain-first where a season config says so.
 *
 * This is the whole composition — derive the labels, then rank — and it lives
 * here so there's exactly one of it. The site's ladder page and the Instagram
 * renderer both call it; a second copy of these six lines is how the printed
 * ladder and the posted ladder start disagreeing about who's third.
 *
 * `rows` is a parameter rather than a default so a caller can hand over a
 * mid-season slice (rounds 1..N) and get the ladder as it stood that night.
 */
export function ladderWithPairings(
  season: number,
  rows: StatRow[],
  teamConfig?: (team: string) => { pair?: string[]; captain?: string } | undefined,
  declaredTeams?: string[]
): LadderRow[] {
  // Fixtures count here even though they count nowhere else: a team that has
  // been drawn to play still needs its pairing label resolved. The label comes
  // from the season config's `pair` when there is one, and from games played
  // when there isn't — which is why a drawn-but-unplayed season needs `pair`.
  const teams = [
    ...new Set([
      ...(declaredTeams ?? []),
      ...rows.filter((r) => r.season === season).map((r) => r.team),
    ]),
  ];
  const pairings: Record<string, string> = {};
  for (const team of teams) {
    // A team with no games played and no `pair` override has nothing to label
    // itself with; leaving the key unset lets `ladder` fall back to the colour.
    const label = teamRoster(team, season, rows, teamConfig?.(team)).pairingName;
    if (label) pairings[team] = label;
  }
  return ladder(season, rows, pairings, declaredTeams);
}

// ---------------------------------------------------------------------------
// Player aggregates
// ---------------------------------------------------------------------------

/** Stats that accumulate during play, and can be missing from a given game. */
export const COUNTING_STATS = [
  'winners',
  'unforcedErrors',
  'aces',
  'doubleFaults',
  'forcedErrors',
  'errorsForced',
  'votes',
] as const;

export type CountingStat = (typeof COUNTING_STATS)[number];

/**
 * A running total plus its own denominators.
 *
 * Coverage varies per stat, not just per game: Errors Forced only exists from
 * S2, serve stats only in S1, and a finals night reconstructed from an
 * Instagram post might give up winners and unforced errors and nothing else.
 * Carrying the denominators alongside the total is what stops a missing cell
 * from quietly reading as a zero.
 */
export interface StatTally {
  /** Sum across the games where this stat was recorded. */
  total: number;
  /** Games that contributed to `total`. */
  games: number;
  /** Sets that contributed to `total` — the denominator for a per-set rate. */
  sets: number;
}

export type StatTallies = Record<CountingStat, StatTally>;

export interface PlayerAgg {
  player: string;
  slug: string;
  scope: StatScope;
  /** Matches played. (Named `games` for historical reasons; the UI says matches.) */
  games: number;
  /** Sets played across those matches. Two or three for a semi or final. */
  sets: number;
  /** How many of `games` were finals (0 when scope is 'regular'). */
  finalsGames: number;
  wins: number;
  losses: number;
  winPct: number;
  /** Per-stat totals with their own coverage. The source of every rate. */
  tally: StatTallies;
  /** Flat totals for convenience. null means "never recorded", not zero. */
  winners: number | null;
  unforcedErrors: number | null;
  aces: number | null;
  doubleFaults: number | null;
  forcedErrors: number | null;
  errorsForced: number | null;
  /**
   * Season MVP votes. Finals votes are a separate award and never counted here
   * — a `finals`-scoped aggregate is what reports them. In a cross-era window
   * (no season given) S1 votes are counted era-adjusted, 2 -> 6 and 1 -> 4,
   * so a best-on-court night weighs the same in every era; a season window
   * counts them as cast. `votesEraAdjusted` says which happened.
   */
  votes: number | null;
  /** True when the vote tally above actually rescaled an S1 vote. */
  votesEraAdjusted: boolean;
  winnerToUe: number | null;
  /** Votes are awarded per match, not per set, so this rate stays per match. */
  votesPerGame: number | null;
  bog: number;
  /** Serve % (S1 only): firstServeIn / (in + out). null outside S1 scope. */
  firstServeIn: number;
  firstServeOut: number;
  servePct: number | null;
}

export interface AggOptions {
  season?: number; // undefined = all-time
  includeFillIns?: boolean; // default false
  team?: string;
  /** Default 'all' — finals included. See StatScope. */
  scope?: StatScope;
}

/** Per-set rate for a counting stat. null when the stat was never recorded. */
export function perSet(agg: PlayerAgg, stat: CountingStat): number | null {
  const t = agg.tally[stat];
  return t.sets ? t.total / t.sets : null;
}

/**
 * True when a stat is missing from some of the games in scope — the cue for the
 * UI to show coverage rather than let a partial total pass as a complete one.
 */
export function isPartial(agg: PlayerAgg, stat: CountingStat): boolean {
  const t = agg.tally[stat];
  return t.games > 0 && t.games < agg.games;
}

const emptyTallies = (): StatTallies =>
  Object.fromEntries(
    COUNTING_STATS.map((s) => [s, { total: 0, games: 0, sets: 0 }])
  ) as StatTallies;

/** Aggregate a set of already-filtered rows for one player into a PlayerAgg. */
function aggregateRows(
  player: string,
  slug: string,
  rows: StatRow[],
  scope: StatScope,
  eraAdjustVotes: boolean
): PlayerAgg {
  const tally = emptyTallies();
  let wins = 0,
    sets = 0,
    finalsGames = 0,
    bog = 0,
    votesEraAdjusted = false;
  let fsIn = 0,
    fsOut = 0,
    serveGames = 0;

  for (const r of rows) {
    if (r.win) wins++;
    sets += r.sets;
    if (r.isFinals) finalsGames++;
    if (r.bog) bog++;

    for (const stat of COUNTING_STATS) {
      // A cross-era window counts S1 votes rescaled onto the modern 3-2-1
      // scale (2 -> 6, 1 -> 4); a season window counts them as cast.
      const v = stat === 'votes' && eraAdjustVotes ? r.adjustedVotes : r[stat];
      if (v === null) continue;
      // Finals votes are a different award on a different scale (4-3-2-1 for
      // the Finals MVP) that shares the `votes` column. They never join the
      // season MVP tally — only a finals-scoped aggregate counts them.
      if (stat === 'votes' && r.isFinals && scope !== 'finals') continue;
      if (stat === 'votes' && v !== r.votes) votesEraAdjusted = true;
      const t = tally[stat];
      t.total += v;
      t.games += 1;
      t.sets += r.sets;
    }

    if (r.firstServeIn !== null || r.firstServeOut !== null) {
      fsIn += r.firstServeIn ?? 0;
      fsOut += r.firstServeOut ?? 0;
      serveGames++;
    }
  }

  const total = (s: CountingStat) => (tally[s].games ? tally[s].total : null);
  const games = rows.length;
  const winners = total('winners');
  const ue = total('unforcedErrors');

  return {
    player,
    slug,
    scope,
    games,
    sets,
    finalsGames,
    wins,
    losses: games - wins,
    winPct: games ? wins / games : 0,
    tally,
    winners,
    unforcedErrors: ue,
    aces: total('aces'),
    doubleFaults: total('doubleFaults'),
    forcedErrors: total('forcedErrors'),
    errorsForced: total('errorsForced'),
    votes: total('votes'),
    votesEraAdjusted,
    winnerToUe:
      winners === null ? null : ue ? winners / ue : winners > 0 ? Infinity : null,
    votesPerGame: tally.votes.games ? tally.votes.total / tally.votes.games : null,
    bog,
    firstServeIn: fsIn,
    firstServeOut: fsOut,
    servePct: serveGames && fsIn + fsOut > 0 ? fsIn / (fsIn + fsOut) : null,
  };
}

export function playerRows(
  player: string,
  rows: StatRow[],
  opts: AggOptions = {}
): StatRow[] {
  const { season, includeFillIns = false, team, scope = 'all' } = opts;
  return rows.filter(
    (r) =>
      isPlayed(r) &&
      !r.isSingles &&
      r.player === player &&
      inScope(r, scope) &&
      (season === undefined || r.season === season) &&
      (includeFillIns || !r.isFillIn) &&
      (team === undefined || r.team === team)
  );
}

export function playerAgg(
  player: string,
  rows: StatRow[],
  opts: AggOptions = {}
): PlayerAgg {
  const filtered = playerRows(player, rows, opts);
  const slug = filtered[0]?.slug ?? '';
  // No season means a cross-era window, and cross-era vote tallies are counted
  // era-adjusted so an S1 best-on-court weighs the same as a modern one.
  return aggregateRows(player, slug, filtered, opts.scope ?? 'all', opts.season === undefined);
}

/**
 * A player's fill-in appearances in a window — the matches a season panel
 * leaves out, so it can own up to leaving them out. Career-wide they count:
 * a night on court is a night on court.
 */
export function fillInRecord(
  player: string,
  rows: StatRow[],
  season?: number,
  scope: StatScope = 'all'
): { matches: number; wins: number; losses: number } {
  const played = rows.filter(
    (r) =>
      isPlayed(r) &&
      !r.isSingles &&
      r.player === player &&
      r.isFillIn &&
      inScope(r, scope) &&
      (season === undefined || r.season === season)
  );
  const wins = played.filter((r) => r.win).length;
  return { matches: played.length, wins, losses: played.length - wins };
}

/**
 * Votes won while filling in. They were earned for somebody else's team, so
 * they never join the MVP tally in any window — but the panel still says how
 * many there were. Blank votes count as nothing, not zero. The count follows
 * the window's currency: era-adjusted career-wide, as cast inside a season.
 */
export function fillInVotes(
  player: string,
  rows: StatRow[],
  season?: number,
  scope: StatScope = 'all'
): number {
  return rows
    .filter(
      (r) =>
        isPlayed(r) &&
        !r.isSingles &&
        r.player === player &&
        r.isFillIn &&
        inScope(r, scope) &&
        (season === undefined || r.season === season)
    )
    .reduce((sum, r) => sum + ((season === undefined ? r.adjustedVotes : r.votes) ?? 0), 0);
}

/**
 * Canonical list of real players (excludes SINGLES GAME).
 *
 * Played rows only, unlike `allSeasons`. A player who appears in nothing but a
 * fixture has no aggregate to show and — because `playerAgg` takes its slug
 * from the rows it found — no slug either, so a page built for them would have
 * an empty URL. A draftee joins this list the night they first play; until
 * then a fixture prints their name without a link.
 */
export function allPlayers(rows: StatRow[] = loadStatRows()): string[] {
  return [
    ...new Set(rows.filter((r) => isPlayed(r) && !r.isSingles).map((r) => r.player)),
  ].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Head to head (the "easiest" / "hardest" opponent tiles)
// ---------------------------------------------------------------------------

/** One meeting between two players, from the first player's point of view. */
export interface H2HGame {
  season: number;
  round: number;
  /** "5", "QF", "SF", "Final". */
  roundLabel: string;
  /** Finals stage, or null. Needed to build the match's URL. */
  stage: FinalsStage | null;
  isFinals: boolean;
  /** Scoreline from this player's point of view, e.g. "4-6 7-6(4) 6-1". */
  score: string;
  sets: number;
  setsWon: number;
  setsLost: number;
  /** The player's team that night. */
  team: string;
  /** The opponent's team that night. */
  opponentTeam: string;
  teamScore: number;
  opponentScore: number;
  win: boolean;
  /** The player was filling in. */
  fillIn: boolean;
  /** The opponent was filling in. */
  opponentFillIn: boolean;
}

/** A player's career record against one opponent. */
export interface HeadToHead {
  opponent: string;
  slug: string;
  meetings: number;
  wins: number;
  losses: number;
  winPct: number;
  gamesFor: number;
  gamesAgainst: number;
  /** gamesFor / gamesAgainst, guarded to gamesFor (as on the ladder). */
  ratio: number;
  /** Every meeting, oldest first. */
  games: H2HGame[];
}

/** Index every team-side of every match, so we can look up the other side. */
function fixtureSides(rows: StatRow[]): Map<string, StatRow[]> {
  const sides = new Map<string, StatRow[]>();
  for (const r of rows) {
    if (r.scheduled || r.isSingles) continue;
    const key = matchKey(r);
    (sides.get(key) ?? sides.set(key, []).get(key)!).push(r);
  }
  return sides;
}

/**
 * A player's record against every opponent they've faced. Fill-in games count
 * on both sides — you still played them — and so do finals, which are the
 * meetings people actually remember. Sorted by meetings desc.
 */
export function headToHead(
  player: string,
  rows: StatRow[] = loadStatRows()
): HeadToHead[] {
  const sides = fixtureSides(rows);
  const byOpponent = new Map<string, HeadToHead>();

  for (const r of rows) {
    if (r.scheduled || r.isSingles || r.player !== player) continue;
    const across = sides.get(`${r.season}|${r.round}|${r.opponent}|${r.team}`) ?? [];
    for (const o of across) {
      if (o.player === player) continue;
      const h =
        byOpponent.get(o.player) ??
        byOpponent
          .set(o.player, {
            opponent: o.player,
            slug: o.slug,
            meetings: 0,
            wins: 0,
            losses: 0,
            winPct: 0,
            gamesFor: 0,
            gamesAgainst: 0,
            ratio: 0,
            games: [],
          })
          .get(o.player)!;
      h.meetings += 1;
      if (r.win) h.wins += 1;
      else h.losses += 1;
      h.gamesFor += r.teamScore;
      h.gamesAgainst += r.opponentScore;
      h.games.push({
        season: r.season,
        round: r.round,
        roundLabel: r.roundLabel,
        stage: r.stage,
        isFinals: r.isFinals,
        score: r.score,
        sets: r.sets,
        setsWon: r.setsWon,
        setsLost: r.setsLost,
        team: r.team,
        opponentTeam: r.opponent,
        teamScore: r.teamScore,
        opponentScore: r.opponentScore,
        win: r.win,
        fillIn: r.isFillIn,
        opponentFillIn: o.isFillIn,
      });
    }
  }

  const out = [...byOpponent.values()];
  for (const h of out) {
    h.winPct = h.meetings ? h.wins / h.meetings : 0;
    h.ratio = h.gamesAgainst === 0 ? h.gamesFor : h.gamesFor / h.gamesAgainst;
    h.games.sort((a, b) => a.season - b.season || a.round - b.round);
  }
  return out.sort(
    (a, b) => b.meetings - a.meetings || a.opponent.localeCompare(b.opponent)
  );
}

/**
 * Win% first, then meetings — 5–0 beats 4–0 beats 3–0 — and the games ratio
 * only settles a dead heat on both.
 */
const bestFirst = (a: HeadToHead, b: HeadToHead) =>
  b.winPct - a.winPct ||
  b.meetings - a.meetings ||
  b.ratio - a.ratio ||
  a.opponent.localeCompare(b.opponent);

/** Same shape inverted: 0–5 is a worse hoodoo than 0–3. */
const worstFirst = (a: HeadToHead, b: HeadToHead) =>
  a.winPct - b.winPct ||
  b.meetings - a.meetings ||
  a.ratio - b.ratio ||
  a.opponent.localeCompare(b.opponent);

export interface OpponentSplit {
  /** Meetings needed to qualify — chosen adaptively for this player. */
  minMeetings: number;
  best: HeadToHead;
  worst: HeadToHead;
}

/**
 * The opponents a player has the best and worst record against.
 *
 * The sample sizes here are small (nobody has faced the same opponent more than
 * six times), so a fixed threshold would either be meaningless or leave half
 * the field without a tile. Instead we take the highest bar between
 * `h2hPreferredMeetings` and `h2hMinMeetings` that still leaves two distinct
 * opponents to compare, and give up if even the floor can't manage that.
 */
export function bestWorstOpponent(
  player: string,
  rows: StatRow[] = loadStatRows()
): OpponentSplit | null {
  const all = headToHead(player, rows);
  const floor = SITE.h2hMinMeetings;

  let minMeetings = floor;
  for (let n = SITE.h2hPreferredMeetings; n >= floor; n--) {
    if (all.filter((h) => h.meetings >= n).length >= 2) {
      minMeetings = n;
      break;
    }
  }

  const qualified = all.filter((h) => h.meetings >= minMeetings);
  if (qualified.length < 2) return null;

  return {
    minMeetings,
    best: [...qualified].sort(bestFirst)[0],
    worst: [...qualified].sort(worstFirst)[0],
  };
}

// ---------------------------------------------------------------------------
// Per-season trend for a player (winners/game, UE/game)
// ---------------------------------------------------------------------------

export function playerTrend(
  player: string,
  rows: StatRow[],
  includeFillIns = false
) {
  return allSeasons(rows)
    .map((season) => {
      const agg = playerAgg(player, rows, { season, includeFillIns });
      return {
        season,
        games: agg.games,
        winnersPerSet: perSet(agg, 'winners') ?? 0,
        uePerSet: perSet(agg, 'unforcedErrors') ?? 0,
      };
    })
    .filter((t) => t.games > 0);
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export type LeaderStat = CountingStat | 'winPct' | 'winnerToUe' | 'bog' | 'finalsVotes';

/**
 * Rates are compared across all matches; raw totals only over the H&A season.
 * The Finals MVP is the exception in both directions — it only exists in
 * September, so its board is finals-only whichever mode you're in.
 */
export const defaultScope = (stat: LeaderStat, perSet: boolean): StatScope =>
  stat === 'finalsVotes' ? 'finals'
  : perSet || stat === 'winPct' || stat === 'winnerToUe' ? 'all'
  : 'regular';

export interface LeaderOptions extends AggOptions {
  /** Rank on the per-set rate rather than the raw total. */
  perSet?: boolean;
  minGames?: number; // for rate boards
}

/**
 * Build a leaderboard for a stat. Returns players ranked desc by the metric.
 * Rate boards apply a minimum-games threshold so 2-game wonders don't win.
 *
 * Scope follows the metric unless you override it: a raw total counts the
 * home-and-away season only (finals would reward whoever went deepest), while
 * rates and win-loss metrics count everything, normalised per set.
 */
export function leaderboard(
  stat: LeaderStat,
  rows: StatRow[],
  opts: LeaderOptions = {}
): { player: string; slug: string; value: number; games: number; agg: PlayerAgg }[] {
  const { perSet: rate = false, minGames = SITE.perGameMinGames } = opts;
  const scope = opts.scope ?? defaultScope(stat, rate);
  const players = allPlayers(rows);

  const entries = players
    .map((p) => {
      const agg = playerAgg(p, rows, { ...opts, scope });
      return { player: p, slug: agg.slug, agg, games: agg.games };
    })
    .filter((e) => e.games > 0);

  const metric = (agg: PlayerAgg): number | null => {
    switch (stat) {
      case 'winPct':
        return agg.winPct;
      case 'winnerToUe':
        return agg.winnerToUe === Infinity ? agg.winners : agg.winnerToUe;
      case 'bog':
        return agg.bog;
      // Votes are awarded once per match however many sets it ran to. The
      // finals board reads the same column under a finals-only scope.
      case 'votes':
      case 'finalsVotes':
        return rate ? agg.votesPerGame : agg.votes;
      default:
        return rate ? perSet(agg, stat) : agg[stat];
    }
  };

  return entries
    .map((e) => ({ ...e, value: metric(e.agg) }))
    .filter(
      (e): e is typeof e & { value: number } =>
        e.value !== null && (!rate || e.games >= minGames)
    )
    .sort((a, b) => b.value - a.value || b.games - a.games);
}

// ---------------------------------------------------------------------------
// Records (single-game and career extremes, streaks)
// ---------------------------------------------------------------------------

export interface GameRecord {
  player: string;
  slug: string;
  value: number;
  season: number;
  round: number;
  team: string;
  opponent: string;
}

/**
 * Best single-match performances. Home-and-away only: a semi or final runs to
 * three sets, so those nights would own every board on court time alone.
 * Games where the stat wasn't recorded are skipped, not counted as zero.
 */
function bestSingleGame(
  rows: StatRow[],
  pick: (r: StatRow) => number | null
): GameRecord[] {
  return rows
    .filter((r) => isPlayed(r) && !r.isSingles && !r.isFillIn && !r.isFinals)
    .map((r) => ({
      player: r.player,
      slug: r.slug,
      value: pick(r),
      season: r.season,
      round: r.round,
      team: r.team,
      opponent: r.opponent,
    }))
    .filter((r): r is GameRecord => r.value !== null)
    .sort((a, b) => b.value - a.value);
}

/**
 * Longest win streak per player in chronological order. Finals count — a run
 * that survives September is the whole point of a streak.
 */
export function winStreaks(rows: StatRow[]) {
  // Map each player to their team-side results in order.
  const byPlayer = new Map<string, { win: boolean; season: number; round: number }[]>();
  const playerRowsAll = rows.filter((r) => isPlayed(r) && !r.isSingles && !r.isFillIn);
  for (const r of playerRowsAll) {
    const arr = byPlayer.get(r.player) ?? [];
    arr.push({ win: r.win, season: r.season, round: r.round });
    byPlayer.set(r.player, arr);
  }
  const out: { player: string; slug: string; streak: number }[] = [];
  for (const [player, results] of byPlayer) {
    results.sort((a, b) => a.season - b.season || a.round - b.round);
    let best = 0,
      cur = 0;
    for (const g of results) {
      cur = g.win ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    out.push({
      player,
      slug: playerRowsAll.find((r) => r.player === player)!.slug,
      streak: best,
    });
  }
  return out.sort((a, b) => b.streak - a.streak);
}

export function records(rows: StatRow[] = loadStatRows()) {
  return {
    mostWinnersGame: bestSingleGame(rows, (r) => r.winners).slice(0, 5),
    mostAcesGame: bestSingleGame(rows, (r) => r.aces).slice(0, 5),
    biggestUeGame: bestSingleGame(rows, (r) => r.unforcedErrors).slice(0, 5),
    mostDoubleFaultsCareer: leaderboard('doubleFaults', rows, {}).slice(0, 5),
    longestWinStreaks: winStreaks(rows).slice(0, 5),
  };
}
