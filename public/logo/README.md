# Logo & crest files

Drop your TNT artwork here. The site looks for these exact filenames:

| File | Used for | Recommended |
|------|----------|-------------|
| `crest.svg` (or `crest.png`) | Header mark + watermark behind pages | Square, transparent background |
| `wordmark.svg` (or `.png`)   | Optional text logo in the header | Transparent background |
| `favicon.png`                | Browser tab icon | 512×512 PNG |
| `og.png`                     | Social share preview image | 1200×630 PNG |

If `crest.svg`/`crest.png` is missing, the header falls back to a text "TNT"
mark and the watermark is hidden — everything still works. SVG is preferred for
the crest so the watermark stays crisp at any size.

Files in `public/` are served from the site root, so `crest.svg` here is
reachable at `/logo/crest.svg`.
