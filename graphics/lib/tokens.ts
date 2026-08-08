/**
 * `_tokens.css`, generated from `src/config/site.ts`.
 *
 * Team colours are decided in one place and one place only. Hand-copying nine
 * (now ten) hex values into a stylesheet is how Brown ends up on the site and
 * absent from the graphics, so the stylesheet is written by this file at render
 * time and committed only as output.
 *
 * Templates never build a variable name out of a team string. They set
 * `data-team="Light Blue"` on an element and read `var(--team)` beneath it —
 * one attribute, no slugging, and a team the map has never heard of falls
 * through to the neutral default rather than to `var(--team-undefined)`.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TEAMS } from '../../src/config/site.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOKENS_PATH = resolve(HERE, '../templates/_tokens.css');

/**
 * Constants that belong to the graphics and not to the website: the Instagram
 * canvas, and the ink/gold/paper the posts have always used. The deep green is
 * the site's own theme colour (`--grass-900` in `src/styles/global.css`) so a
 * post and the site read as the same brand.
 */
export const BRAND = {
  /** Instagram's tallest in-feed format. */
  width: 1080,
  height: 1350,
  /** Left/right gutter. Nothing load-bearing goes outside it. */
  safe: 64,
  /**
   * The band Instagram's profile grid crops off the top and bottom of a 4:5
   * post (1350 - 1080, halved). An eyebrow or a footnote can live in it; the
   * headline and the numbers can't.
   */
  crop: 135,
  ink: '#0a130d',
  ink2: '#101d14',
  inkDeep: '#050b07',
  paper: '#f4f1e8',
  gold: '#d9b96a',
  goldSoft: '#efd9a3',
};

export function tokensCss(): string {
  const teamBlocks = Object.values(TEAMS)
    .map(
      (t) =>
        `[data-team="${t.name}"] {\n` +
        `  --team: ${t.color};\n` +
        `  --team-2: ${t.color2};\n` +
        `  --team-ink: ${t.ink};\n` +
        `}`
    )
    .join('\n');

  return `/* ==========================================================================
   GENERATED from src/config/site.ts by graphics/lib/tokens.ts.
   Do not edit — run the renderer (or \`node graphics/render.mjs --tokens\`)
   and this file is rewritten from the TEAMS map.
   ========================================================================== */

:root {
  /* Canvas */
  --w: ${BRAND.width}px;
  --h: ${BRAND.height}px;
  --safe: ${BRAND.safe}px;
  --crop: ${BRAND.crop}px;

  /* Brand */
  --ink: ${BRAND.ink};
  --ink-2: ${BRAND.ink2};
  --ink-deep: ${BRAND.inkDeep};
  --paper: ${BRAND.paper};
  --gold: ${BRAND.gold};
  --gold-soft: ${BRAND.goldSoft};

  /* Neutral fallback for a team the TEAMS map has never seen. */
  --team: #8b8f99;
  --team-2: #4a4e57;
  --team-ink: #0d0d0d;
}

/* --- Team palette — one block per entry in TEAMS ------------------------- */
${teamBlocks}
`;
}

export function writeTokens(): string {
  writeFileSync(TOKENS_PATH, tokensCss(), 'utf8');
  return TOKENS_PATH;
}
