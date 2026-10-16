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

/** WCAG relative luminance of a `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The team colour as a light source on the dark canvas: unchanged when it
 * already reads (Orange, Pink, Yellow), mixed toward white until it does when
 * it doesn't. Navy's own #26346f is a hole in the page, not a glow — a rim
 * light or a wash in it is invisible, which is the one place a poster needs
 * the team to show.
 */
export function glowColor(hex: string, floor = 0.16): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  // Lift lightness in HSL rather than mixing in white: white greys a dark
  // colour out (Navy goes lavender), HSL keeps it the same blue, brighter.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l0 = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  const h =
    d === 0 ? 0
    : max === r ? ((g - b) / d + 6) % 6
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;
  const hsl = (l: number) => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = l - c / 2;
    const [r1, g1, b1] =
      h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x]
      : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return '#' + [r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  };
  let l = l0;
  while (l < 0.9 && luminance(hsl(l)) < floor) l += 0.01;
  return l === l0 ? hex : hsl(l);
}

export function tokensCss(): string {
  const teamBlocks = Object.values(TEAMS)
    .map(
      (t) =>
        `[data-team="${t.name}"] {\n` +
        `  --team: ${t.color};\n` +
        `  --team-2: ${t.color2};\n` +
        `  --team-ink: ${t.ink};\n` +
        `  --team-glow: ${glowColor(t.color)};\n` +
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
  --team-glow: #a4a8b0;
}

/* --- Team palette — one block per entry in TEAMS ------------------------- */
${teamBlocks}
`;
}

export function writeTokens(): string {
  writeFileSync(TOKENS_PATH, tokensCss(), 'utf8');
  return TOKENS_PATH;
}
