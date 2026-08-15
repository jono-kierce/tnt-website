# TNT graphics

1080×1350 Instagram graphics rendered from `data/alltimestats.csv` — the same
file the website builds from, through the same code. Posting a round is:
append the CSV rows, push, collect the PNGs.

---

## Setup

```bash
npm install
npx playwright install chromium
```

Node 22.18+ (24.x here). The renderer imports the site's `.ts` libraries
directly and relies on Node's built-in type stripping — Node 20 can't run it.
`npm test` still runs anywhere, because vitest does its own transform.

---

## Rendering

```bash
npm run graphics                                    # this week
node graphics/render.mjs --season 4 --round 9
node graphics/render.mjs --season 4 --round 9 --only ladder
node graphics/render.mjs --season 4 --round F --photos ./photos/2025-11-04/
node graphics/render.mjs --only preview               # next Tuesday's fixtures
node graphics/render.mjs --help
```

With no arguments it renders `SITE.currentSeason` at the latest round in the
CSV — which is exactly the round you just added. PNGs land in `graphics/out/`
(gitignored) at 2160×2700, i.e. 2× for a retina phone.

| Flag | |
|---|---|
| `--season <n>` | Default `SITE.currentSeason`. |
| `--round <r>` | A round number, or `QF` / `SF` / `F`. Default: the season's latest — except for `preview`, see below. |
| `--only <list>` | `ladder`, `results`, `boards`, `draft`, `preview` — comma-separated. Default `ladder,results,boards`; `draft` and `preview` are once-off posts, so they only render on request. |
| `--photos <dir>` | Photos for the result cards. |
| `--career` | Also render the all-time boards. |
| `--out <dir>` | Default `graphics/out`. |

Filenames are `s4-r09-ladder.png`, `s4-r09-match1-pink-v-white.png`,
`s4-r09-stat-mvp-race.png`, `s5-r01-preview.png`. Rounds are zero-padded and
finals sort last, so a folder listing is in playing order.

### Photos — the one human input

Point `--photos` at a folder and each fixture is matched to a file three ways,
most specific first:

1. the fixture slug — `pink-v-white.jpg`
2. any name mentioning both colours — `2025-final-pink-white.jpg`
3. positionally — `match1.jpg`, or just `1.jpg`

A fixture with no photo **renders on the scrim and warns** with the exact
filename that would fix it. It never crashes; a Tuesday night nobody
photographed is normal, and CI has no photos at all.

### Sealed votes

`sealedVoteSeasons` in `src/config/site.ts` exists so a season's votes stay
hidden until awards night. Any vote-derived board — the MVP race, finals votes,
and BOG, which is derived from votes — is **refused, not rendered**, for a
sealed season. The CLI says which board it skipped and why, and renders the
rest. A graphic that quietly printed the count would be a worse leak than a
web page that did, because a graphic gets posted.

---

## The one rule

**No graphic computes a statistic.** Every number comes from
`src/lib/stats.ts`, every data quirk from `src/lib/normalize.ts`, and every
team colour from the `TEAMS` map in `src/config/site.ts`. `lib/payloads.ts`
turns those into per-template data objects and is allowed to do exactly one
thing beyond that: presentation — labels, ordering, rounding for print.

If a graphic needs a number `stats.ts` doesn't expose, **add it to `stats.ts`
with a test** and import it. A ladder derived in two places is a ladder that
can disagree with itself, which is the failure this pipeline exists to prevent.
`graphics/lib/payloads.test.ts` asserts the ladder payload equals what the
site's own ladder produces, so a divergence fails the build rather than getting
posted.

The same goes for colour: `_tokens.css` is *generated* from `TEAMS` on every
render. Nobody hand-copies a hex value.

---

## Layout

```
graphics/
  render.mjs           the CLI
  lib/
    payloads.ts        stats.ts -> per-template data objects
    boards.ts          which stat boards get rendered (pure config)
    tokens.ts          TEAMS + brand constants -> templates/_tokens.css
    season-configs.ts  season-N.ts under plain Node (the site's loader is Vite-only)
    payloads.test.ts   score parsing + payload building
  scripts/
    fetch-fonts.mjs    vendors the webfonts (run when a family changes)
    build-assets.mjs   logo -> templates/_assets.css (run when the logo changes)
  templates/
    _tokens.css        GENERATED — canvas, brand, one block per team
    _fonts.css         GENERATED — @font-face for the vendored files
    _assets.css        GENERATED — the TNT mark, inlined as a mask
    _base.css          canvas, crop safety, grain, the mark, tiebreak type
    _theme.css         colour and type — the "broadsheet" direction
    ladder.html
    result-card.html
    stat-board.html
    preview.html
    fonts/             vendored .woff2 (committed)
  out/                 rendered PNGs — gitignored
```

### Why three stylesheets are generated

| File | Generated from | Re-run when |
|---|---|---|
| `_tokens.css` | `src/config/site.ts` | automatically, every render |
| `_fonts.css` + `fonts/` | Google Fonts | you add or change a family |
| `_assets.css` | `logos/` | the logo artwork changes |

Fonts are **vendored, not linked**. Google Fonts serves a different file to a
different user agent, and a CI runner would otherwise fall back to a system
face and reflow every graphic. Same reason for `font-display: block`: a
screenshot gets no second repaint, so the page has to wait for the real face
rather than bake a fallback into the PNG. (Vendoring makes *layout* identical
everywhere; macOS and Linux still rasterise glyph edges slightly differently,
so the files won't be bit-identical across the two — the type will be.)

The logo is inlined as a **CSS mask** so it can take gold, paper or deep green
ink from whatever it sits on. Two gotchas are handled, and both fail *silently*
to a solid gold rectangle if undone:

- `mask-image` reads the image's **alpha** channel. A plain greyscale PNG has
  none, so it reads as fully opaque. The mark ships as greyscale **+ alpha**.
- Chromium treats every `file://` document as its own opaque origin and refuses
  to load a mask across one, so a template opened off disk would mask itself to
  nothing. The mask is a `data:` URI, which has no origin to cross.

---

## Designing a template

Every template is **openable directly in a browser**. Each ships with a `DATA`
object of real-looking sample values and calls its own `window.__render(DATA)`
on load, so you can edit CSS and hit refresh with no build step. The renderer
calls `window.__render(realData)` to overwrite the samples — the file you
design against is the file that ships.

Add `?guides` to the URL to overlay the crop margins:

```
file:///…/graphics/templates/ladder.html?guides
```

- **Blue** — the left/right safe gutter (`--safe`, 64px).
- **Pink** — the square Instagram's profile grid crops to. The top and bottom
  135px are gone there. Eyebrows, footnotes and rules may live in that band;
  the headline and the numbers may not.

Templates set `data-team="Light Blue"` on a row and read `var(--team)`,
`var(--team-2)` and `var(--team-ink)` beneath it. **Never build a variable name
out of a team string** — with `data-team`, a team the map hasn't got falls
through to a neutral default instead of to `var(--team-undefined)`.

### Adding a template

1. Copy the closest existing one. Keep the five `<link>`s and the `.canvas`
   wrapper — that's the 1080×1350 frame.
2. Define `window.__render(d)` and call it once with a sample `DATA`.
3. Add a payload builder to `lib/payloads.ts`, with a test. It reads
   `stats.ts`; it does not do arithmetic.
4. Add a `shoot(...)` call in `render.mjs`.

---

## The four families

### Ladder — `ladder.html`

Position, team colour bar, pairing, played, wins, games ratio. Below the finals
cutoff the rows lose their gold and ease back; the leader takes a gold spine
and a wash. The cut is drawn *between* rows, because it's a line the season
draws rather than a property of the team above it.

Pairings are captain-first where `src/config/seasons/season-N.ts` says so.
Handles 8, 9 or 10 teams — Season 5 adds Brown, and it was checked at ten.

### Result card — `result-card.html`

One per fixture. Photo with a gradient scrim, frosted panel below carrying the
wordmark, the round, and both sides: seed, colour bar, pairing, set scores.

A set lost on a breaker prints its points small and high — `7-6³` — the way the
site does it (`src/lib/score.ts`). One, two and three-set matches all fit.

**Who won the match comes from the CSV's `win?`, never from counting sets.**
Season 4's Round 9 has a `5-5` where nobody recorded the breaker: neither side
won that set, so a card that inferred a winner from the scoreline would show
none at all. The winning side gets a gold spine and wash that owe nothing to
the numbers.

### Stat board — `stat-board.html`

A ranked leaderboard. Configure one in `lib/boards.ts`: title, subtitle, metric
label, row count, season or career, per-set or total, and `polarity`.

- **Value chips** run a green → pink → red ramp, interpolated from four stops
  in `_theme.css`. `polarity: 'low'` flips which end is green, so most winners
  reads green at the top and most unforced errors reads red at the top.
  **Ranking never flips** — `#1` is always the biggest number, as on the site.
- **Coverage** prints under a name ("32 of 43 matches") whenever the stat is
  missing from some of them. A blank cell means *not recorded*, never zero, so
  a partial total is never allowed to pass as a complete one.
- **Rate boards** apply `SITE.perGameMinGames` and say so in the footnote.
- **Fill-ins are excluded** by default, as on the site, and the footnote says so.
- **The hero band** — the leader pictured — appears only if that player has a
  photo in `content/photos/photos.yaml`, and the board drops to seven rows to
  make room. Set `cutout: true` for a transparent PNG and it sits unframed;
  an ordinary photo gets a frame rather than pretending to be a cut-out.
  The photo is whatever `avatarPhoto()` picks, so it's as good as the manifest.

### Preview — `preview.html`

Every unplayed fixture in a round, one board: colour bar, pairing and kickoff
time each side, byes listed at the foot. Meant for the day before — run
`--only preview` with no `--round` and it renders the **next round with an
unplayed fixture**, not the latest one in the CSV (that's the played-rounds
default every other family uses, which would render nothing for a season not
yet started).

- **No prediction ever appears here.** The board doesn't import `predict.ts`
  at all — a graphic posted to hype up next Tuesday is not the place for a
  win-probability tip.
- **At most one insight per fixture**, the single top-weighted line from
  `insightsFor` — a stat-backed, non-numeric fact ("on an 11-match win
  streak", "first meeting"), never a percentage. Silent when nothing fires,
  same discipline as the match page.
- **Kickoff order, not seed order** — `MatchRecord.start` sorts the fixtures
  the way `byPlayingOrder` sorts them everywhere else, so the board reads top
  to bottom the way the night actually runs. A season with no times recorded
  falls back to alphabetical, same as the site.
- Renders nothing, cleanly, once a season's fixtures are exhausted — `draft`'s
  and CI's philosophy applied to the other end of a season.

---

## CI

The `graphics` job in `.github/workflows/deploy.yml` renders the current
round on every push to `main` and uploads the PNGs as a build artifact
(`graphics-s4-rF`, 30-day retention). **Nothing is committed.**

It runs *alongside* the Pages build rather than before it, and is
`continue-on-error`, so it adds nothing to the time the site takes to ship and
a broken template can't stop a data fix going live. It installs Chromium only,
and caches it by Playwright version.

CI has no match photos, so the result cards it produces are scrim-only. Re-run
locally with `--photos` when you have the night's pictures.
