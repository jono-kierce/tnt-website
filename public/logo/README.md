# Logo assets — generated

Everything in this folder except this file is **generated** from the artwork in
`logos/` at the repo root:

```bash
npm run build-logo
```

| File | Used for | How it's made |
|------|----------|---------------|
| `crest.png` | Header, footer and the watermark behind every page | Greyscale **mask** — the drawing lives in the alpha channel and CSS supplies the colour, so one file is gold in the header and ivory at 3.5% behind the page |
| `favicon.png` | Browser tab (512×512) | Gold crest on the deep green, baked in |
| `og.png` | Link previews (1200×630) | The full lockup, gold on the deep green |

The output is committed, so building the site needs neither the source artwork
nor Python. Re-run `npm run build-logo` when the artwork in `logos/` changes —
and `node graphics/scripts/build-assets.mjs` too, which crops the same marks for
the Instagram templates (`scripts/logo-marks.mjs` holds the crops both use).

Files in `public/` are served from the site root, so `crest.png` here is
reachable at `<base>/logo/crest.png`. `Crest.astro` is what renders it; if the
file is missing the header falls back to a text "TNT" mark and the watermark
disappears — the site still builds.
