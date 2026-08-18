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
import { seasonBoards, careerBoards } from './lib/boards.ts';
import {
  SealedVotesError,
  draftPayload,
  eyebrowLabel,
  ladderPayload,
  latestRound,
  nextPreviewRound,
  predictionsPayloads,
  previewPayload,
  resolveRound,
  resultCardPayloads,
  rows as allRows,
  statBoardPayload,
  streakBoardPayload,
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
    career: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (argv.help) {
  console.log(`
TNT graphics renderer

  --season <n>     Season to render. Default: SITE.currentSeason (${SITE.currentSeason}).
  --round <r>      Round number, or QF / SF / F. Default: the season's latest
                   round in the CSV.
  --only <list>    Comma-separated: ladder, results, boards, draft, preview,
                   streaks, headline, predictions. Default: ladder,results,boards
                   — draft, preview, streaks, headline and predictions are
                   once-off posts, so they only render when asked.
                   predictions renders one card per analyst (the pundits'
                   pre-season picks); it needs no --round.
                   streaks is the all-time record book (longest win streaks);
                   it needs no --season or --round.
                   preview needs no --round: it defaults to the next round
                   with an unplayed fixture, which is the point of it — run it
                   the day before with no flags and get next Tuesday's card.
  --photos <dir>   Folder of match photos for the result cards. A file is
                   matched to a fixture by name — "pink-v-white.jpg", any name
                   containing both team colours, or "match1.jpg" positionally.
                   A fixture with no photo renders on the scrim and warns.
  --career         Also render the all-time boards.
  --subtitle <s>   Override the draft board's subtitle.
  --footnote <s>   Small print bottom-right of the draft board (date, venue).
  --out <dir>      Output folder. Default: graphics/out.

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
const KINDS = ['ladder', 'results', 'boards', 'draft', 'preview', 'streaks', 'headline', 'predictions'];
const only = new Set(
  (argv.only ?? 'ladder,results,boards').split(',').map((s) => s.trim()).filter(Boolean)
);
const unknown = [...only].filter((k) => !KINDS.includes(k));
if (unknown.length) {
  console.error(`Unknown --only value(s): ${unknown.join(', ')}. Pick from: ${KINDS.join(', ')}`);
  process.exit(1);
}

// A draft happens before a ball is hit, so it needs no round — and a season
// that has only been drafted has no rows to infer one from.
const needsRound = ['ladder', 'results', 'boards'].some((k) => only.has(k));
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

if (only.has('ladder')) {
  await shoot('ladder.html', await ladderPayload(season, round), `${stem}-ladder.png`);
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

if (only.has('boards')) {
  const specs = [...seasonBoards(season), ...(argv.career ? careerBoards() : [])];
  for (const spec of specs) {
    let payload;
    try {
      payload = statBoardPayload(spec);
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
    await shoot('stat-board.html', payload, `${stem}-stat-${spec.id}.png`);
  }
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
