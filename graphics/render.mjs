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
  ladderPayload,
  latestRound,
  resolveRound,
  resultCardPayloads,
  rows as allRows,
  statBoardPayload,
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
  --only <list>    Comma-separated: ladder, results, boards, draft.
                   Default: ladder,results,boards — the draft board is a
                   once-a-season post, so it only renders when you ask for it.
  --photos <dir>   Folder of match photos for the result cards. A file is
                   matched to a fixture by name — "pink-v-white.jpg", any name
                   containing both team colours, or "match1.jpg" positionally.
                   A fixture with no photo renders on the scrim and warns.
  --career         Also render the all-time boards.
  --subtitle <s>   Override the draft board's subtitle.
  --footnote <s>   Small print bottom-right of the draft board (date, venue).
  --out <dir>      Output folder. Default: graphics/out.
`);
  process.exit(0);
}

const season = Number(argv.season ?? SITE.currentSeason);
if (!Number.isFinite(season)) {
  console.error(`Not a season: ${argv.season}`);
  process.exit(1);
}

// `draft` is deliberately not in the default set — it's a once-a-season post,
// not part of a round.
const KINDS = ['ladder', 'results', 'boards', 'draft'];
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
