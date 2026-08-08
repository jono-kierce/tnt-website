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
import { mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { writeTokens, BRAND } from './lib/tokens.ts';
import { seasonBoards, careerBoards } from './lib/boards.ts';
import {
  SealedVotesError,
  ladderPayload,
  latestRound,
  resolveRound,
  resultCardPayloads,
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
  --only <list>    Comma-separated: ladder, results, boards. Default: all.
  --photos <dir>   Folder of match photos for the result cards. A file is
                   matched to a fixture by name — "pink-v-white.jpg", any name
                   containing both team colours, or "match1.jpg" positionally.
                   A fixture with no photo renders on the scrim and warns.
  --career         Also render the all-time boards.
  --out <dir>      Output folder. Default: graphics/out.
`);
  process.exit(0);
}

const season = Number(argv.season ?? SITE.currentSeason);
if (!Number.isFinite(season)) {
  console.error(`Not a season: ${argv.season}`);
  process.exit(1);
}

const latest = latestRound(season);
if (!latest && argv.round === undefined) {
  console.error(
    `Season ${season} has no rows in data/alltimestats.csv, so there's nothing ` +
      `to render. (SITE.currentSeason is ${SITE.currentSeason}.)`
  );
  process.exit(1);
}
const round = argv.round === undefined ? latest : resolveRound(argv.round);

const only = new Set(
  (argv.only ?? 'ladder,results,boards').split(',').map((s) => s.trim()).filter(Boolean)
);
const unknown = [...only].filter((k) => !['ladder', 'results', 'boards'].includes(k));
if (unknown.length) {
  console.error(`Unknown --only value(s): ${unknown.join(', ')}`);
  process.exit(1);
}

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
const stem = `s${season}-${round.fileTag}`;

console.log(`\nTNT graphics — Season ${season}, ${round.label}\n`);

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
        warnings.push(`Skipped "${spec.title}" — ${err.message}`);
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

console.log(`\n${written.length} graphic${written.length === 1 ? '' : 's'} → ${OUT}`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
console.log('');
