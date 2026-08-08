# TNT graphics

1080×1350 Instagram graphics rendered from `data/alltimestats.csv` — the same
file the website builds from, through the same code.

> **Status: Phase 1.** Three design directions are up for a decision; the
> template set, the CLI and the CI job land once one is picked. See
> [Design directions](#design-directions).

---

## Setup

Playwright and its Chromium are already dev dependencies:

```bash
npm install
npx playwright install chromium
```

Node 20 can't run this — the renderer imports the site's `.ts` libraries
directly and relies on Node's built-in type stripping (24.x here, 22.18+ is
enough).

Render the current design options:

```bash
node graphics/scripts/render-options.mjs
```

PNGs land in `graphics/out/` (gitignored).

---

## The one rule

**No graphic computes a statistic.** Every number comes from
`src/lib/stats.ts`, every data quirk from `src/lib/normalize.ts`, and every
team colour from the `TEAMS` map in `src/config/site.ts`. `graphics/lib/payloads.ts`
turns those into per-template data objects and is allowed to do exactly one
thing beyond that: presentation — labels, ordering, rounding for print.

If a graphic needs a number `stats.ts` doesn't expose, **add it to `stats.ts`
with a test** and import it. A ladder derived in two places is a ladder that
can disagree with itself, which is the failure this whole pipeline exists to
prevent.

The same goes for colour: `_tokens.css` is *generated* from `TEAMS` on every
render. Nobody hand-copies a hex value.

---

## Layout

```
graphics/
  lib/
    payloads.ts        stats.ts -> per-template data objects
    tokens.ts          TEAMS + brand constants -> templates/_tokens.css
    season-configs.ts  season-N.ts under plain Node (the site's loader is Vite-only)
  scripts/
    render-options.mjs Phase 1: renders every direction in options/
    fetch-fonts.mjs    vendors the webfonts (run when a family changes)
    build-assets.mjs   logo -> templates/_assets.css (run when the logo changes)
  templates/
    _tokens.css        GENERATED — canvas, brand, one block per team
    _fonts.css         GENERATED — @font-face for the vendored files
    _assets.css        GENERATED — the TNT mark, inlined as a mask
    _base.css          canvas, crop safety, grain, the mark, tiebreak type
    fonts/             vendored .woff2 (committed)
  options/             Phase 1 design directions, one folder each
  out/                 rendered PNGs — gitignored
```

### Why three of those stylesheets are generated

| File | Generated from | Re-run when |
|---|---|---|
| `_tokens.css` | `src/config/site.ts` | automatically, every render |
| `_fonts.css` + `fonts/` | Google Fonts | you add or change a family |
| `_assets.css` | `logos/` | the logo artwork changes |

Fonts are **vendored, not linked**. Google Fonts serves a different file to a
different user agent, and a CI runner would otherwise silently fall back to a
system face and reflow every graphic. `font-display: block` matters for the
same reason: a screenshot gets no second repaint, so the page has to wait for
the real face rather than bake a fallback into the PNG.

The logo is inlined as a **CSS mask** so it can take gold, paper or deep green
ink from whichever direction it lands in. Two gotchas are already handled, and
both are silent failures if you undo them:

- `mask-image` reads the image's **alpha** channel. A plain greyscale PNG has
  none, so it reads as fully opaque and masks to a solid rectangle. The mark
  ships as greyscale **+ alpha**.
- Chromium treats every `file://` document as its own opaque origin and refuses
  to load a mask across one — so a template opened straight off disk would mask
  itself to nothing. The mask is a `data:` URI, which has no origin to cross.

---

## Designing a template

Every template is **openable directly in a browser**. Each ships with a `DATA`
object of real-looking sample values and calls its own `window.__render(DATA)`
on load, so you can edit CSS and hit refresh with no build step. The renderer
then calls `window.__render(realData)` to overwrite the samples — the file you
design against is the file that ships.

Add `?guides` to the URL to overlay the crop margins:

```
file:///…/graphics/options/a-broadsheet/ladder.html?guides
```

- **Blue** — the left/right safe gutter (`--safe`, 64px).
- **Pink** — the square Instagram's profile grid crops to. The top and bottom
  135px are gone there. Eyebrows, footnotes and rules may sit in that band;
  the headline and the numbers may not.

Templates set `data-team="Light Blue"` on a row and read `var(--team)`,
`var(--team-2)` and `var(--team-ink)` beneath it. Never build a variable name
out of a team string — a team the map hasn't got falls through to a neutral
default that way, instead of to `var(--team-undefined)`.

---

## Design directions

Phase 1 puts three up against the same Season 4 data — the final ladder and the
grand final — so the comparison is about design and nothing else.
`graphics/out/options/_contact-sheet.png` shows all of them at the 161px the
profile grid actually uses.

| | Direction | In one line |
|---|---|---|
| **A** | `a-broadsheet` | Grand-slam programme: deep court green, gold hairlines, engraved caps. |
| **B** | `b-scoreboard` | Stadium board: solid team-colour slabs and the biggest numbers the frame allows. |
| **C** | `c-honours` | The club wall: warm paper, deep green ink, gold leaf — the only light one. |

Each has a `_theme.css` holding its colour and type; the layout lives in the
template. Once a direction is chosen its folder is promoted to `templates/` and
`options/` goes away.
