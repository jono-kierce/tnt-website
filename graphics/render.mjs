#!/usr/bin/env node
/**
 * TNT graphics renderer.
 *
 *   node graphics/render.mjs --season 4 --round 9
 *   node graphics/render.mjs --season 4 --round 9 --only ladder
 *   node graphics/render.mjs --season 4 --round F --photos ./photos/2025-11-04/
 *
 * Reads `data/alltimestats.csv` through the site's own `stats.ts`, renders each
 * template in headless Chromium at 1080x1350, and writes 2x PNGs to
 * `graphics/out/`. The only human input is the folder of match photos.
 *
 * Run `--help` for the full set of flags.
 */

import { chromium } from 'playwright';
import { appendFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { writeTokens, BRAND } from './lib/tokens.ts';
import { seasonBoards, careerBoards, leaderBoards } from './lib/boards.ts';
import {
  SealedVotesError,
  draftPayload,
  eyebrowLabel,
  finalsFormatPayload,
  finalsFixturePayload,
  tiePreviewPayload,
  finalsDroughtPayload,
  ladderPayload,
  latestRound,
  nextPreviewRound,
  predictionsPayloads,
  previewPayload,
  resolveRound,
  resultCardPayloads,
  playerSlidePayloads,
  rows as allRows,
  scoreboardPayload,
  pairBoardPayload,
  rivalryBoardPayload,
  pairSplitPayload,
  pointsLadderPayload,
  longestMatchesPayload,
  tiebreakPayload,
  pointsPlayedPayload,
  mvpSimPayloads,
  statBoardPayload,
  streakBoardPayload,
  streakStoryPayloads,
} from './lib/payloads.ts';
import { SITE } from '../src/config/site.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(HERE, 'templates');
const OUT_DEFAULT = resolve(HERE, 'out');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const { values: argv } = parseArgs({
  options: {
    season: { type: 'string' },
    round: { type: 'string' },
    only: { type: 'string' },
    photos: { type: 'string' },
    out: { type: 'string' },
    subtitle: { type: 'string' },
    footnote: { type: 'string' },
    headline: { type: 'string' },
    subhead: { type: 'string' },
    eyebrow: { type: 'string' },
    pair: { type: 'string' },
    tie: { type: 'string' },
    assume: { type: 'string' },
    player: { type: 'string' },
    sim: { type: 'string' },
    runs: { type: 'string' },
    career: { type: 'boolean', default: false },
    'no-cut': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (argv.help) {
  console.log(`
TNT graphics renderer

  --season <n>     Season to render. Default: SITE.currentSeason (${SITE.currentSeason}).
  --round <r>      Round number, or WC / QF / SF / F. Default: the season's latest
                   round in the CSV.
  --only <list>    Comma-separated: ladder, results, scoreboard, boards, draft,
                   preview, streaks, streakstory, headline, predictions,
                   pair, rivalry, mvpsim, leaders, pointsladder, pairsplit, longest,
                   tiebreaks, pointsplayed, finals, finalsfixture.
                   Default: ladder,results,scoreboard,boards
                   — draft, preview, streaks, headline, predictions and pair
                   are once-off posts, so they only render when asked.
                   scoreboard is the whole round's results on one slide — the
                   post for a night nobody photographed.
                   predictions renders one card per analyst (the pundits'
                   pre-season picks); it needs no --round.
                   streaks is the all-time record book (longest win streaks);
                   it needs no --season or --round.
                   streakstory is one player's streak as a carousel — see
                   below.
                   leaders is the season's winners, unforced errors, aces
                   and errors forced — each as a total and per match, eight
                   stat boards in all.
                   pointsladder ranks the season's teams by share of points
                   won (every point rebuilt from the stat sheets) beside
                   their real ladder position.
                   pairsplit is "ball hogs": each pair's share of
                   their point-ending shots, most lopsided first.
                   longest is the all-time home-and-away matches with the
                   most points played, --round's longest match lit in gold
                   (and added below the table if it didn't make the top 8).
                   tiebreaks is the all-time record for tiebreaks played by
                   one team in a home-and-away season, fronted by a photo of
                   the record holders (--photos <file> to pick another); it
                   needs no --season or --round.
                   pointsplayed is the all-time record for points played by
                   a player in a home-and-away season, fronted by the record
                   holder (--photos <file> to pick another); no --season or
                   --round.
                   players is slides 2–5 of each match's carousel: one per
                   player, winners first, captain first, with his winners,
                   errors forced and unforced errors from the match. Finals
                   rounds take the gold "Finals" mark, like the result card.
                   pair is two players' record as team-mates; it needs --pair
                   and no --season or --round.
                   preview needs no --round: it defaults to the next round
                   with an unplayed fixture, which is the point of it — run it
                   the day before with no flags and get next Tuesday's card.
  --photos <dir>   Folder of match photos for the result cards. A file is
                   matched to a fixture by name — "pink-v-white.jpg", any name
                   containing both team colours, or "match1.jpg" positionally.
                   A fixture with no photo renders on the scrim and warns.
                   The same folder feeds --only players: a file is matched to
                   a player by slug ("jonathan-kierce.jpg") or surname
                   ("kierce-lunge.jpg"); anyone without one falls back to his
                   season photo from the manifest, with a warning.
  --career         Also render the all-time boards.
  --no-cut         Draw the ladder without the finals cut: no line, no
                   greyed-out rows, and no "Top 8 play finals" subtitle.
  --subtitle <s>   Override the draft board's subtitle.
  --footnote <s>   Small print bottom-right of the draft board (date, venue).
  --pair <a,b>     The two players for --only pair or rivalry, comma-separated:
                   --pair "Ed Simpson,Jimmy Gorton".
  --out <dir>      Output folder. Default: graphics/out.

Pair board (--only pair) — two players' record as team-mates:

  --pair <a,b>     The two players, comma-separated, as the CSV names them:
                   --pair "Ed Simpson,Jimmy Gorton". Refused for a pair who
                   played together in a season whose votes are still sealed.

Rivalry board (--only rivalry) — two players' record against each other:

  --pair <a,b>     The two players, as the CSV names them. Every meeting,
                   finals and fill-ins included. No votes, so no seal.

MVP simulation (--only mvpsim) — the MVP race as a Monte Carlo projection:

  --sim <path>     The simulation summary CSV (required). Produced outside this
                   repo; every other number on every other graphic comes from
                   data/alltimestats.csv, this one doesn't.
  --runs <n>       How many runs the projection was over, for the subtitle.
                   Omit and it reads "Simulated".

                   Renders one slide per ten players, ranked by projected
                   tally: s5-r05-mvp-sim-1.png, -2.png. Unlike every other
                   vote-derived board it is NOT refused for a sealed season —
                   a projection is not the tally. See mvpSimPayloads().

Streak story (--only streakstory) — one win streak as a swipeable carousel:

  --player <name>  Whose streak. Default: the longest live streak in the CSV.
  --photos <list>  Optional comma-separated overrides, cover first then one per
                   chapter; blank entries keep the manifest's pick:
                   --photos "cover.jpg,,s5.jpg". Default: from photos.yaml.

                   Cover, the loss it began after, one chapter per season and
                   team, then the record book and the next fixture — with a
                   W-chip rail along the foot of every slide.

Finals format (--only finals) — the season's bracket as a structure explainer:
                   seeds and "winner of / loser of" slots, no teams. Needs no
                   --round. --headline overrides the title ("The New Finals").

Finals fixture (--only finalsfixture) — the same bracket with each seed slot
                   naming the team that finished there on the final ladder.
                   Refused until home-and-away is over. --headline overrides the
                   title ("Finals Fixture"); --subhead sets the footer note.

Tie preview (--only tiepreview) — one seeded finals tie as a poster: both
                   pairs pictured, records and form off the final ladder, the
                   night they met in the home and away, what's at stake.
  --tie <id>       The tie, by its id in the season config. Default: WC.
  --photos <list>  Four images, comma-separated: home captain, home partner,
                   away captain, away partner. A .png is drawn as a cutout
                   (knee-cropped, centred on the head — see graphics/cutouts/);
                   anything else as a fading frame. Blank or missing entries
                   fall back to the player's own photos for the season.
                   --headline overrides the title; --subhead says when it's
                   on, after the seeds ("Tonight", a date). Omitted, the
                   seeds print alone.

Finals drought (--only drought) — everyone who has played finals and never
                   won one, the longest wait pictured, with who's still in
                   this season's bracket and who they play next.
  --assume <t:w>   Add one finals result that isn't in the CSV yet, e.g.
                   WC:Navy ("if Navy win the wildcard"), so a board for each
                   outcome can be made the day before. Refused once that tie
                   is in the CSV. The filename says which outcome it assumed;
                   the graphic doesn't.
  --player <name>  Who to picture. Default: the top of the list.
  --photos <path>  Their photo; a .png is drawn as a cutout. Default: their
                   lead photo from the manifest.

Headline card (--only headline) — an ad-hoc news/banter post:

  --headline <s>   The big headline (required for the headline card).
  --subhead <s>    The sub-headline along the bottom.
  --eyebrow <s>    Small label top-left. Default: "TNT NEWS · Season <n>".
  --photos <p>     1–2 photos. Either a folder (first 1–2 images, sorted) or a
                   comma-separated list of file paths in left-to-right order.
                   No photo renders on the court-green field.
`);
  process.exit(0);
}

const season = Number(argv.season ?? SITE.currentSeason);
if (!Number.isFinite(season)) {
  console.error(`Not a season: ${argv.season}`);
  process.exit(1);
}

// `draft` and `preview` are deliberately not in the default set — a draft is a
// once-a-season post, and a preview is a once-a-week one you ask for the day
// before, not something every CI push should render.
const KINDS = ['ladder', 'results', 'scoreboard', 'boards', 'draft', 'preview', 'streaks', 'streakstory', 'headline', 'predictions', 'pair', 'rivalry', 'mvpsim', 'leaders', 'pointsladder', 'pairsplit', 'longest', 'tiebreaks', 'pointsplayed', 'finals', 'finalsfixture', 'tiepreview', 'drought', 'players'];
const only = new Set(
  (argv.only ?? 'ladder,results,scoreboard,boards').split(',').map((s) => s.trim()).filter(Boolean)
);
const unknown = [...only].filter((k) => !KINDS.includes(k));
if (unknown.length) {
  console.error(`Unknown --only value(s): ${unknown.join(', ')}. Pick from: ${KINDS.join(', ')}`);
  process.exit(1);
}

// A draft happens before a ball is hit, so it needs no round — and a season
// that has only been drafted has no rows to infer one from.
const needsRound = ['ladder', 'results', 'players', 'scoreboard', 'boards', 'leaders', 'pointsladder', 'pairsplit', 'longest'].some((k) => only.has(k));
const latest = latestRound(season);
if (needsRound && !latest && argv.round === undefined) {
  // A season whose draw is in the CSV but whose first night hasn't happened is
  // the normal state of things every January — not a failure. CI renders on
  // every push to main, so this has to exit clean or it reports a broken build
  // for the months between the draft and the first result.
  const drawn = allRows.some((r) => r.season === season && r.scheduled);
  const message =
    `Season ${season} has no played rounds in data/alltimestats.csv, so there's ` +
    `nothing to render. (SITE.currentSeason is ${SITE.currentSeason}.)\n` +
    (drawn
      ? `Its fixtures are drawn but unplayed — a round with no scores, no stats ` +
        `and no winner is not something a result card can show. Add the results ` +
        `and run again.`
      : `That season has no rows at all.`) +
    `\nIf the season has only been drafted, try: --only draft`;

  if (drawn) {
    console.log(message);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}
const round = argv.round === undefined ? latest : resolveRound(argv.round);

const OUT = argv.out ? resolve(process.cwd(), argv.out) : OUT_DEFAULT;

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

/**
 * Map each fixture to a photo file. Three ways in, most specific first, because
 * naming a file after the tie is worth rewarding but nobody should have to:
 *
 *   pink-v-white.jpg    the fixture slug
 *   final-pink-white.jpg  any name mentioning both colours
 *   match1.jpg / 1.jpg  positional, in the order the cards are rendered
 */
function matchPhotos(dir, cards) {
  const files = readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .sort();
  const byStem = new Map(files.map((f) => [basename(f, extname(f)).toLowerCase(), f]));
  const out = {};

  cards.forEach((card, i) => {
    const teams = card.sides.map((s) => s.team.toLowerCase().replace(/[^a-z]/g, ''));
    const hit =
      byStem.get(card.slug) ??
      files.find((f) => {
        const stem = basename(f, extname(f)).toLowerCase().replace(/[^a-z]/g, '');
        return teams.every((t) => stem.includes(t));
      }) ??
      byStem.get(`match${i + 1}`) ??
      byStem.get(String(i + 1));
    if (hit) out[card.slug] = pathToFileURL(resolve(dir, hit)).href;
  });
  return out;
}

/**
 * Match each player slide to a photo from the night, by name: a file whose
 * name contains the player's slug (`jonathan-kierce.jpg`) wins, then one that
 * contains his surname (`wc-kierce-lunge.jpg`). Surnames shared on court
 * (Ed and Charlie Simpson) only match on the full slug.
 */
function playerPhotoMap(dir, slides) {
  const files = readdirSync(dir).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())).sort();
  const stem = (f) => basename(f, extname(f)).toLowerCase();
  const surname = (slug) => slug.split('-').at(-1);
  const out = {};
  for (const s of slides) {
    const shared = slides.some(
      (o) => o.match === s.match && o.playerSlug !== s.playerSlug && surname(o.playerSlug) === surname(s.playerSlug)
    );
    const hit =
      files.find((f) => stem(f).includes(s.playerSlug)) ??
      (shared ? undefined : files.find((f) => stem(f).split(/[^a-z]+/).includes(surname(s.playerSlug))));
    if (hit) out[s.playerSlug] = pathToFileURL(resolve(dir, hit)).href;
  }
  return out;
}

/**
 * Resolve the headline card's 1–2 photos to absolute file:// URLs. `--photos`
 * is either a comma-separated list of file paths (explicit left→right order) or
 * a folder (first 1–2 images, sorted). Returns `{ photos, warnings }`; caps at
 * two and warns about anything past that.
 */
function headlinePhotos(spec) {
  const warnings = [];
  const target = resolve(process.cwd(), spec);

  let paths;
  if (existsSync(target) && statSync(target).isDirectory()) {
    paths = readdirSync(target)
      .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
      .sort()
      .map((f) => resolve(target, f));
  } else {
    paths = spec.split(',').map((s) => s.trim()).filter(Boolean)
      .map((p) => resolve(process.cwd(), p));
  }

  const missing = paths.filter((p) => !existsSync(p));
  for (const p of missing) warnings.push(`--photos: no such file "${p}" — skipped.`);
  paths = paths.filter((p) => existsSync(p));

  if (paths.length > 2) {
    warnings.push(`--photos: ${paths.length} images given; the headline card uses the first 2.`);
    paths = paths.slice(0, 2);
  }
  return { photos: paths.map((p) => pathToFileURL(p).href), warnings };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

writeTokens();
mkdirSync(OUT, { recursive: true });

const warnings = [];
const written = [];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: BRAND.width, height: BRAND.height },
  deviceScaleFactor: 2,
});
page.on('pageerror', (e) => warnings.push(`template error: ${e.message}`));

/** Render one template with one payload. */
async function shoot(template, data, file) {
  const path = resolve(OUT, file);
  await page.goto(pathToFileURL(resolve(TEMPLATES, template)).href, {
    waitUntil: 'load',
  });
  await page.evaluate((d) => window.__render(d), data);
  // Fonts are vendored and `font-display: block`, but a screenshot gets no
  // second repaint — so wait for them rather than bake a fallback into the PNG.
  await page.evaluate(() => document.fonts.ready);
  // Same for the photo: a decode still in flight is a grey card.
  await page.evaluate(() =>
    Promise.all(
      [...document.images].filter((i) => i.src).map((i) => i.decode().catch(() => {}))
    )
  );
  await page.screenshot({ path, scale: 'device' });
  written.push(file);
  console.log(`  ✓ ${file}`);
}

/** `s4-r09` — sorts chronologically, says what it is. */
const stem = round ? `s${season}-${round.fileTag}` : `s${season}`;

console.log(
  `\nTNT graphics — Season ${season}${round ? `, ${round.label}` : ''}\n`
);

if (only.has('draft')) {
  await shoot(
    'draft.html',
    await draftPayload(season, {
      subtitle: argv.subtitle,
      footnote: argv.footnote,
    }),
    `s${season}-draft.png`
  );
}

if (only.has('preview')) {
  // Never `latestRound` — that's the last *played* round, and the whole point
  // here is the round that hasn't been played yet.
  const previewRound =
    argv.round === undefined ? await nextPreviewRound(season) : resolveRound(argv.round);
  if (!previewRound) {
    warnings.push(`Season ${season} has no upcoming fixtures to preview.`);
  } else {
    const payload = await previewPayload(season, previewRound);
    if (!payload.matches.length) {
      warnings.push(`No unplayed fixtures found for season ${season}, ${previewRound.label}.`);
    } else {
      await shoot('preview.html', payload, `s${season}-${previewRound.fileTag}-preview.png`);
    }
  }
}

if (only.has('streaks')) {
  // All-time record book — no season, no round. A once-off post, so it's out
  // of the default set like draft and preview.
  await shoot('streak-board.html', streakBoardPayload(), 'longest-win-streaks.png');
}

if (only.has('streakstory')) {
  // One player's streak, slide by slide — all-time like streaks, so no season
  // and no round. `--photos` here is a list, not a folder: cover, then chapters.
  const [cover, ...chapters] = (argv.photos ?? '').split(',').map((s) => s.trim() || undefined);
  const slides = await streakStoryPayloads(argv.player, { cover, chapters });
  const who = slides[0].player.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  for (const s of slides) {
    if (s.slide !== 'before' && !s.photo && s.slide !== 'record') {
      warnings.push(`streak story ${s.index} (${s.slide}): no photo for ${s.player} — rendered without one.`);
    }
    await shoot('streak-story.html', s, `streak-${who}-${s.index}-${s.slide}.png`);
  }
}

if (only.has('pair')) {
  // A partnership, all-time — no season, no round, like streaks. The board
  // carries votes and BOG, so a pair who played together in a sealed season is
  // refused rather than rendered; the CLI reports the skip and carries on, the
  // same way a sealed stat board does.
  const names = (argv.pair ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length !== 2) {
    warnings.push('--only pair needs --pair "First Last,First Last". Nothing rendered.');
  } else {
    try {
      const board = pairBoardPayload(names[0], names[1]);
      await shoot('pair-board.html', board, `${board.id}.png`);
    } catch (err) {
      if (err instanceof SealedVotesError) warnings.push(err.message);
      else throw err;
    }
  }
}

if (only.has('rivalry')) {
  // Two players across the net, all-time. Reuses --pair for the names.
  const names = (argv.pair ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length !== 2) {
    warnings.push('--only rivalry needs --pair "First Last,First Last". Nothing rendered.');
  } else {
    const board = rivalryBoardPayload(names[0], names[1]);
    await shoot('rivalry-board.html', board, `${board.id}.png`);
  }
}

if (only.has('mvpsim')) {
  // The MVP race as a projection. A once-off post, out of the default set, and
  // the only family whose numbers come from outside this repo — so it renders
  // nothing at all without an explicit --sim path. That's also what keeps it
  // honest against `sealedVoteSeasons`: it can't be rendered by accident.
  if (!argv.sim) {
    warnings.push('--only mvpsim needs --sim <path-to-summary.csv>. Nothing rendered.');
  } else {
    const simPath = resolve(process.cwd(), argv.sim);
    if (!existsSync(simPath)) {
      warnings.push(`--sim ${argv.sim}: no such file. Nothing rendered.`);
    } else {
      const runs = argv.runs === undefined ? undefined : Number(argv.runs);
      if (runs !== undefined && !Number.isFinite(runs)) {
        console.error(`Not a run count: ${argv.runs}`);
        process.exit(1);
      }
      const sim = await mvpSimPayloads(simPath, season, round, { runs });
      warnings.push(...sim.warnings);
      for (const slide of sim.slides) {
        await shoot(
          'mvp-sim-board.html',
          slide,
          `${stem}-mvp-sim-${slide.slide}.png`
        );
      }
    }
  }
}

if (only.has('headline')) {
  // Ad-hoc news/banter card — all human input, no stats. A once-off post, so
  // it's out of the default set like draft, preview and streaks.
  if (!argv.headline) {
    warnings.push('--only headline needs --headline "<text>". Nothing rendered.');
  } else {
    let photos = [];
    if (argv.photos) {
      const resolved = headlinePhotos(argv.photos);
      photos = resolved.photos;
      warnings.push(...resolved.warnings);
    }
    if (!photos.length) {
      warnings.push('No --photos for the headline card — rendered on the court-green field.');
    }
    await shoot(
      'headline.html',
      {
        eyebrow: argv.eyebrow ?? `TNT News · ${eyebrowLabel(season)}`,
        headline: argv.headline,
        sub: argv.subhead ?? '',
        photos,
      },
      `s${season}-headline.png`
    );
  }
}

if (only.has('predictions')) {
  // The analysts' pre-season picks — one card per pundit. Pure human input like
  // the headline card, so no round and no stats; a once-off post out of the
  // default set. The card leaves its bottom-right quarter clear for a cut-out
  // added in Canva after the render.
  const cards = await predictionsPayloads(season);
  for (const card of cards) {
    await shoot('predictions.html', card, `s${season}-predictions-${card.slug}.png`);
  }
}

if (only.has('finalsfixture')) {
  // The same bracket with the final ladder's teams in the seed slots. Refused
  // (and reported) while home-and-away fixtures are still to play.
  try {
    await shoot(
      'finals-format.html',
      await finalsFixturePayload(season, { title: argv.headline, footnote: argv.subhead }),
      `s${season}-finals-fixture.png`
    );
  } catch (err) {
    console.warn(`  skip finals fixture: ${err.message}`);
  }
}

if (only.has('tiepreview')) {
  // A once-off poster for one finals tie. Refused (and reported) while the
  // seeds aren't settled, or for a tie fed by another tie's result.
  const tie = argv.tie ?? 'WC';
  const photos = (argv.photos ?? '').split(',').map((p) => p.trim() || undefined);
  for (const p of photos) if (p && !existsSync(p)) warnings.push(`--photos: no such file "${p}" — using the default.`);
  try {
    await shoot(
      'tie-preview.html',
      await tiePreviewPayload(season, tie, {
        photos: photos.map((p) => (p && existsSync(p) ? p : undefined)),
        title: argv.headline,
        subtitle: argv.subhead,
      }),
      `s${season}-${tie.toLowerCase()}-preview.png`
    );
  } catch (err) {
    console.warn(`  skip tie preview: ${err.message}`);
  }
}

if (only.has('drought')) {
  let assume;
  if (argv.assume) {
    const [tie, winner] = argv.assume.split(':').map((x) => x.trim());
    if (!tie || !winner) {
      console.error(`--assume wants <tie>:<winning team>, e.g. WC:Navy — got "${argv.assume}".`);
      process.exit(1);
    }
    assume = { tie, winner };
  }
  try {
    await shoot(
      'finals-drought.html',
      await finalsDroughtPayload(season, {
        assume,
        player: argv.player,
        photo: argv.photos,
        title: argv.headline,
        subtitle: argv.subhead,
      }),
      assume
        ? `s${season}-finals-drought-if-${assume.winner.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-win-${assume.tie.toLowerCase()}.png`
        : `s${season}-finals-drought.png`
    );
  } catch (err) {
    console.warn(`  skip finals drought: ${err.message}`);
  }
}

if (only.has('finals')) {
  // The bracket's shape off the season config — no match data, so no round.
  await shoot(
    'finals-format.html',
    await finalsFormatPayload(season, { title: argv.headline }),
    `s${season}-finals-format.png`
  );
}

if (only.has('ladder')) {
  await shoot('ladder.html', await ladderPayload(season, round, { noCut: argv['no-cut'] }), `${stem}-ladder.png`);
}

if (only.has('pointsladder')) {
  // Points won, not matches won — the ladder's sibling, from src/lib/points.ts.
  const payload = await pointsLadderPayload(season, round);
  if (!payload.rows.length) {
    warnings.push(`No countable matches for season ${season} up to ${round.label} — points ladder skipped.`);
  } else {
    await shoot('points-ladder.html', payload, `${stem}-points-ladder.png`);
  }
}

if (only.has('longest')) {
  // All-time, but rendered for a round: that round's longest match is the one lit.
  const payload = await longestMatchesPayload(season, round);
  if (!payload.featuredTag) {
    warnings.push(`longest: no countable home-and-away match in season ${season}, ${round.label} — nothing is highlighted.`);
  }
  await shoot('longest-matches.html', payload, `${stem}-longest-matches.png`);
}

if (only.has('tiebreaks')) {
  // All-time record book like streaks: no season, no round. `--photos` here is
  // one file; the default is the record holders' latest shot in photos.yaml.
  const payload = await tiebreakPayload({ photo: argv.photos });
  if (!payload.photo) {
    warnings.push('tiebreaks: no season photo tagged with the record pair — rendered on the court-green field.');
  }
  await shoot('tiebreaks.html', payload, 'most-tiebreaks-season.png');
}

if (only.has('pointsplayed')) {
  // All-time record book: no season, no round. `--photos` is one file.
  const payload = await pointsPlayedPayload({ photo: argv.photos });
  if (!payload.photo) {
    warnings.push('pointsplayed: no season photo of the record holder — rendered on the court-green field.');
  }
  await shoot('points-played.html', payload, 'most-points-played-season.png');
}

if (only.has('pairsplit')) {
  const payload = await pairSplitPayload(season, round);
  if (!payload.rows.length) {
    warnings.push(`No pair has a countable match together in season ${season} — pair split skipped.`);
  } else {
    for (const r of payload.rows.filter((r) => r.matches < 3)) {
      warnings.push(`pair split: ${r.players.map((p) => p.name).join(' & ')} (${r.team}) have only ${r.matches} match${r.matches === 1 ? '' : 'es'} together — flagged on the board.`);
    }
    await shoot('pair-split.html', payload, `${stem}-pair-split.png`);
  }
}

if (only.has('results')) {
  const cards = await resultCardPayloads(season, round);
  if (!cards.length) {
    warnings.push(`No fixtures found for season ${season}, ${round.label}.`);
  }

  let photos = {};
  if (argv.photos) {
    const dir = resolve(process.cwd(), argv.photos);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      warnings.push(`--photos ${argv.photos} is not a folder; cards render on the scrim.`);
    } else {
      photos = matchPhotos(dir, cards);
    }
  }

  for (const [i, card] of cards.entries()) {
    card.photo = photos[card.slug] ?? null;
    if (!card.photo) {
      warnings.push(
        `No photo for ${card.slug} — rendered on the scrim. ` +
          `Drop "${card.slug}.jpg" (or "match${i + 1}.jpg") into --photos to fix.`
      );
    }
    await shoot('result-card.html', card, `${stem}-match${i + 1}-${card.slug}.png`);
  }
}

if (only.has('players')) {
  // Slides 2–5 of each match's carousel, after its result card. The photos
  // come from the same --photos folder as the cards, matched by player name.
  let { slides, unrecorded } = await playerSlidePayloads(season, round);
  for (const m of unrecorded) {
    warnings.push(`players: ${m} has no player stats in the CSV — no player slides.`);
  }
  if (argv.photos) {
    const dir = resolve(process.cwd(), argv.photos);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      warnings.push(`--photos ${argv.photos} is not a folder; player slides use the manifest.`);
    } else {
      ({ slides } = await playerSlidePayloads(season, round, { photos: playerPhotoMap(dir, slides) }));
    }
  }
  for (const s of slides) {
    const name = `${s.player.first} ${s.player.last}`;
    if (!s.photo) {
      warnings.push(`players: no photo of ${name} — rendered on the court-green field. Drop "${s.playerSlug}.jpg" into --photos.`);
    } else if (!s.photoFromMatch) {
      warnings.push(`players: ${name} is pictured from the manifest, not this match. Drop "${s.playerSlug}.jpg" into --photos.`);
    }
    await shoot('player-slide.html', s, `${stem}-match${s.matchIndex}-${s.match}-${s.slide}-${s.playerSlug}.png`);
  }
}

if (only.has('scoreboard')) {
  // The same round the result cards just drew, on one slide. No photo, no
  // human input — which is the point of it: a Tuesday nobody photographed
  // still gets a post.
  const payload = await scoreboardPayload(season, round);
  if (!payload.matches.length) {
    warnings.push(`No played fixtures found for season ${season}, ${round.label}.`);
  } else {
    await shoot('scoreboard.html', payload, `${stem}-scoreboard.png`);
  }
}

async function shootBoards(specs) {
  // One carousel: a repeat leader gets a fresh frame, a shared lead whoever
  // hasn't been pictured yet (see `Pictured` in payloads.ts).
  const pictured = new Map();
  for (const spec of specs) {
    let payload;
    try {
      payload = statBoardPayload(spec, pictured);
    } catch (err) {
      if (err instanceof SealedVotesError) {
        // The error already names the board and says what to do about it.
        warnings.push(err.message);
        continue;
      }
      throw err;
    }
    if (!payload.rows.length) {
      warnings.push(`Skipped "${spec.title}" — no player qualifies yet.`);
      continue;
    }
    if (spec.showPhoto && !payload.hero) {
      warnings.push(
        `"${spec.title}" (${spec.id}) has no ${spec.season ? `season ${spec.season} ` : ''}` +
          `solo photo of ${payload.rows[0].player} in content/photos/photos.yaml — ` +
          `rendered without the spotlight.`
      );
    }
    await shoot('stat-board.html', payload, `${stem}-stat-${spec.id}.png`);
  }
}

if (only.has('boards')) {
  await shootBoards([...seasonBoards(season), ...(argv.career ? careerBoards() : [])]);
}

if (only.has('leaders')) {
  await shootBoards(leaderBoards(season));
}

await browser.close();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

// Let a GitHub Actions step name its artifact after what was actually
// rendered, rather than the workflow guessing the round ahead of time.
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `stem=${stem}\ncount=${written.length}\n`,
    'utf8'
  );
}

console.log(`\n${written.length} graphic${written.length === 1 ? '' : 's'} → ${OUT}`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
console.log('');
