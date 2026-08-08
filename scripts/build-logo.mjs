#!/usr/bin/env node
/**
 * Turn the artwork in `logos/` into the website's logo assets.
 *
 *   npm run build-logo
 *
 * Writes three files into `public/logo/`:
 *
 *   crest.png    the crest as a greyscale **mask** — header, footer, watermark
 *   favicon.png  512×512, gold crest on the deep green, for the browser tab
 *   og.png       1200×630 social card, the gold lockup on the deep green
 *
 * The crest is a mask rather than a picture for the same reason the graphics
 * templates use one (`graphics/scripts/build-assets.mjs`): the mark has to take
 * the ink of whatever it sits on — gold in the header, ivory at 3.5% for the
 * watermark — and one file that inherits `currentColor` beats three tinted
 * PNGs. `mask-image` reads the image's *alpha* channel, so the mark ships as
 * flat luminance + the drawing in alpha; a plain greyscale PNG has no alpha,
 * reads as fully opaque and masks to a solid gold rectangle.
 *
 * The other two are ordinary pictures: a favicon and an OG card are composited
 * by someone else's renderer (a browser tab, a link preview), so the colour has
 * to be baked in. They're also the only place the full lockup appears — on the
 * site itself the wordmark is set in type beside the crest.
 *
 * Run it when the artwork changes. The output is committed, so nobody needs the
 * source files — or Python — to build the site.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { LOGO_SOURCE, MARKS } from './logo-marks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT_DIR = resolve(ROOT, 'public/logo');

/** The site's own brand colours — `--grass-900` and `--gold` in global.css. */
const INK = '#0a130d';
const GOLD = '#d9b96a';

const JOBS = {
  /**
   * The watermark draws the crest at up to 640 CSS px, so 768 covers it with
   * room over. `alphaBits: 5` is the reason this file is ~75 KB instead of
   * ~155: 32 levels of alpha are plenty for line art that is either 34 px tall
   * or sitting at 3.5% opacity, and the coarser edges halve what every page
   * has to download.
   */
  mask: { name: 'crest', box: MARKS.crest, width: 768, alphaBits: 5 },
  favicon: { box: MARKS.crest, size: 512, pad: 0.12 },
  og: { box: MARKS.lockup, width: 1200, height: 630, mark: 0.62 },
};

/**
 * Pillow does the pixel work. It's already a dependency of
 * `scripts/optimize-photos.py`, and this script runs about as often as that one
 * does — when the owner changes an asset, never at build time.
 */
const PY = `
import json, sys
from PIL import Image, ImageOps

src, out_dir, jobs, ink, gold = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4], sys.argv[5]
written = []

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def alpha(box):
    """The mark's alpha channel, trimmed to the ink."""
    a = Image.open(src).crop(tuple(box)).getchannel("A")
    return a.crop(a.getbbox())

def fit(a, w):
    """Scale to a given width, keeping the drawing's proportions."""
    return a.resize((w, round(a.height * w / a.width)), Image.LANCZOS)

def fit_box(a, w, h):
    """Scale to sit inside a w×h box, keeping proportions."""
    s = min(w / a.width, h / a.height)
    return a.resize((round(a.width * s), round(a.height * s)), Image.LANCZOS)

def ink_through(base, mark, colour):
    """Stamp the mark (an alpha channel) onto the base in a flat colour, centred."""
    base.paste(Image.new("RGB", mark.size, hex_rgb(colour)),
               ((base.width - mark.width) // 2, (base.height - mark.height) // 2), mark)
    # Two flat colours and the antialiasing between them: a 64-entry palette is
    # more than the picture contains, and a quarter of the bytes of truecolour.
    return base.quantize(colors=64, dither=Image.Dither.NONE)

def save(im, name, **kw):
    p = f"{out_dir}/{name}"
    im.save(p, "PNG", optimize=True, **kw)
    written.append(name)

# 1. The mask: flat white luminance, the drawing in alpha. "LA" keeps the file
#    small and needs no 'mask-mode' override, so Safari and Firefox get it right
#    from the same bytes Chromium does.
m = jobs["mask"]
a = ImageOps.posterize(fit(alpha(m["box"]), m["width"]), m["alphaBits"])
save(Image.merge("LA", (Image.new("L", a.size, 255), a)), m["name"] + ".png")

# 2. Favicon: gold crest on a full-bleed deep green square. A transparent
#    favicon disappears into whichever tab bar it lands in; the square reads the
#    same in a light theme and a dark one.
f = jobs["favicon"]
inner = round(f["size"] * (1 - 2 * f["pad"]))
mark = fit_box(alpha(f["box"]), inner, inner)
save(ink_through(Image.new("RGB", (f["size"], f["size"]), hex_rgb(ink)), mark, gold),
     "favicon.png")

# 3. OG card: the lockup, gold, centred on the same green. No text baked in —
#    a card that named a season would go stale the week after it was made.
o = jobs["og"]
h = round(o["height"] * o["mark"])
mark = fit_box(alpha(o["box"]), o["width"], h)
save(ink_through(Image.new("RGB", (o["width"], o["height"]), hex_rgb(ink)), mark, gold),
     "og.png")

print(json.dumps(written))
`;

mkdirSync(OUT_DIR, { recursive: true });

const written = JSON.parse(
  execFileSync(
    'python3',
    ['-c', PY, resolve(ROOT, LOGO_SOURCE), OUT_DIR, JSON.stringify(JOBS), INK, GOLD],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
);

for (const name of written) {
  const kb = statSync(resolve(OUT_DIR, name)).size / 1024;
  console.log(`  ✓ ${name.padEnd(12)} ${kb.toFixed(0)} KB`);
}
console.log(`\n→ ${relative(ROOT, OUT_DIR)}/`);
