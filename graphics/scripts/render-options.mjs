#!/usr/bin/env node
/**
 * PHASE 1 — render every design direction in `graphics/options/` so they can be
 * compared side by side before one of them becomes the real template set.
 *
 *   node graphics/scripts/render-options.mjs
 *
 * Each direction gets the same real Season 4 data (the final ladder and the
 * grand final) so the comparison is about the design and nothing else, plus a
 * thumbnail-sized copy of the ladder — that's how most of the feed is read, and
 * a direction that only works at full size hasn't worked.
 *
 * Once a direction is picked, its folder is promoted to `graphics/templates/`
 * and this script goes away.
 */

import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { writeTokens, BRAND } from '../lib/tokens.ts';
import { ladderPayload, resultCardPayloads, resolveRound } from '../lib/payloads.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OPTIONS = resolve(ROOT, 'options');
const OUT = resolve(ROOT, 'out/options');

const SEASON = 4;
/** The final ladder, and the match everyone remembers — including a tiebreak. */
const LADDER_ROUND = resolveRound('9');
const CARD_ROUND = resolveRound('F');
/** A real photo from the repo, so the scrim is judged against a real image. */
const PHOTO = resolve(ROOT, '../content/photos/season-4/s4-celebration.jpg');

writeTokens();

const ladder = await ladderPayload(SEASON, LADDER_ROUND);
const cards = await resultCardPayloads(SEASON, CARD_ROUND, {
  photos: existsSync(PHOTO) ? { 'pink-v-white': pathToFileURL(PHOTO).href } : {},
});
const card = cards[0];

const directions = readdirSync(OPTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name)
  .sort();

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: BRAND.width, height: BRAND.height },
  deviceScaleFactor: 2,
});

/** Render one template with one payload and write a PNG. */
async function shoot(file, data, out, scale = 2) {
  await page.setViewportSize({ width: BRAND.width, height: BRAND.height });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate((d) => window.__render(d), data);
  // Fonts are self-hosted and `font-display: block`, so this resolves as soon
  // as they're parsed — but a screenshot gets no second repaint, so wait.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, scale: scale === 2 ? 'device' : 'css' });
  console.log('  ✓', out.replace(`${ROOT}/`, ''));
}

for (const dir of directions) {
  console.log(`\n${dir}`);
  const base = resolve(OPTIONS, dir);
  await shoot(resolve(base, 'ladder.html'), ladder, resolve(OUT, `${dir}-ladder.png`));
  await shoot(resolve(base, 'result-card.html'), card, resolve(OUT, `${dir}-result.png`));
}

/**
 * Contact sheet at the size Instagram's grid actually shows a post — 161px
 * wide, cropped square. A direction that only reads at 1080 hasn't read.
 */
const cell = (d, suffix) =>
  `<figure><img src="${d}-${suffix}.png"><figcaption>${d}</figcaption></figure>`;

const sheet = `<meta charset="utf-8">
<style>
  body { margin:0; background:#1a1a1a; padding:22px 22px 6px;
         font:12px/1.6 ui-monospace, SFMono-Regular, monospace; color:#8a8a8a; }
  h2 { font:600 13px/1 ui-monospace, monospace; color:#d9b96a; margin:0 0 12px;
       letter-spacing:.14em; text-transform:uppercase; }
  section { margin-bottom:26px; }
  .strip { display:flex; gap:14px; }
  figure { margin:0; }
  /* The profile grid crops a 4:5 post to a centre square. */
  img { width:161px; height:161px; object-fit:cover; object-position:center; display:block;
        border-radius:2px; }
  figcaption { text-align:center; padding-top:7px; }
</style>
<section><h2>Ladder — profile grid (161px, square crop)</h2>
  <div class="strip">${directions.map((d) => cell(d, 'ladder')).join('')}</div></section>
<section><h2>Result card — profile grid</h2>
  <div class="strip">${directions.map((d) => cell(d, 'result')).join('')}</div></section>`;

const sheetPath = resolve(OUT, '_contact-sheet.html');
writeFileSync(sheetPath, sheet, 'utf8');
await page.setViewportSize({
  width: 44 + directions.length * 175,
  height: 460,
});
await page.goto(pathToFileURL(sheetPath).href, { waitUntil: 'load' });
await page.screenshot({ path: resolve(OUT, '_contact-sheet.png'), fullPage: true });
console.log('\n  ✓ out/options/_contact-sheet.png');

await browser.close();
console.log(`\n${directions.length} directions → graphics/out/options/\n`);
