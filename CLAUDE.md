# CLAUDE.md

Guidance for working in this repo. See `README.md` for the owner-facing workflow.

## What this is

Static **Astro** site for Tuesday Night Tennis (TNT), a Melbourne social doubles
league. Everything on the site is generated **at build time** from one CSV:
`data/alltimestats.csv`. Deployed to GitHub Pages via `.github/workflows/deploy.yml`
on push to `main`.

## Golden rules

1. **The CSV is the single source of truth.** Don't hardcode stats anywhere.
2. **All data quirks live in one place:** `src/lib/normalize.ts`. If you're
   special-casing data anywhere else, move it here.
3. **Derived, never stored:** BOG (from votes), team pairings (from games
   played) and sets played (from the `Score` column) are computed — there is no
   BOG column, no roster list and no set count in the CSV.
4. **Adding a season needs zero code changes:** new CSV rows + a
   `src/config/seasons/season-N.ts` (auto-discovered by glob) + optional
   `content/seasons/season-N.md`. Update `currentSeason`/`seasonYears`/
   `sealedVoteSeasons` in `src/config/site.ts`.
5. **Preserve CSV formatting** when editing it programmatically: keep the UTF-8
   BOM, the trailing empty column, and existing line endings so diffs stay small.

## Commands

```bash
npm run dev          # local dev at /tnt-website/
npm run build        # static build -> dist/
npm test             # vitest (stats + normalization unit tests)
npm run check-data   # validate the CSV: coverage, out-of-range votes, ambiguous rows, missing bios
npm run ladder       # print derived ladders + pairings per season (sanity check)
npm run optimize-photos          # downsize new photos for the web (add `-- --dry-run` first)
npm run build-logo   # logos/ -> public/logo/ (crest mask, favicon, share card)
npm run graphics     # render this round's Instagram PNGs -> graphics/out/ (needs Node 22.18+)
```

Node 20+, except `npm run graphics` which needs **Node 22.18+**: the renderer
imports the site's `.ts` libraries directly and relies on built-in type
stripping. `--experimental-strip-types` is used to run the `.ts` scripts
directly; season configs use `import.meta.glob`, so they only load under Vite
(Astro), not plain Node — `ladder`/`check-data` deliberately avoid importing
them, and `graphics/lib/season-configs.ts` is a Node-safe re-implementation of
that auto-discovery for the renderer.

## Architecture

```
src/lib/normalize.ts     THE normalization layer: CSV -> StatRow[], all quirks here
                         (name merge, fill-in, SINGLES GAME, serve S1-only,
                          errors-forced S2+, EVERY stat null-if-blank, BOG
                          derivation, Round->stage, Score->sets)
src/lib/stats.ts         ladder, rosters/pairings, player aggregates, leaderboards, records
src/lib/ranks.ts         where a player sits in the field — the stat-panel badges
src/lib/site-data.ts     page-facing helpers (season ladder, MVP tally, fun stats)
src/lib/photos.ts        photo manifest loader (content/photos/photos.yaml): tags,
                         captions, seasons, avatar pick. Node-safe — no import.meta.env
src/lib/stats.test.ts    unit tests — keep these green
src/config/site.ts       currentSeason, sealedVoteSeasons, seasonYears, team colours, thresholds
src/config/aliases.ts    name alias map + slug/short-name helpers
src/config/seasons/*.ts  per-season honours, captains, pairing order, finals bracket
src/pages, src/components  UI (Astro)
content/                 bios, photos, recaps (owner-edited)
scripts/copy-assets.mjs  copies CSV + photos into public/ at build (pre-dev/build);
                         prunes public/ files content/ no longer has
scripts/optimize-photos.py  downsizes content/photos for the web (owner-run, idempotent)
scripts/build-logo.mjs   logos/ -> public/logo/ (owner-run when the artwork changes)
scripts/logo-marks.mjs   the source file + crop boxes, shared with the graphics
graphics/                Instagram PNGs, rendered from the same CSV — see graphics/README.md
```

## Instagram graphics (`graphics/`)

1080×1350 PNGs rendered by headless Chromium from the same CSV, so posting a
round is "append rows, push, collect PNGs". Three template families — ladder,
result card, stat board. **Read `graphics/README.md` before touching it**; the
rules that matter here:

- **No graphic computes a statistic.** `graphics/lib/payloads.ts` calls
  `stats.ts` and does presentation only. A stat the graphics need but `stats.ts`
  doesn't expose gets **added to `stats.ts` with a test** — never recomputed in
  the renderer. A test asserts the ladder payload equals the site's own ladder.
- **Team colours are generated**, not copied: `graphics/lib/tokens.ts` writes
  `templates/_tokens.css` from `TEAMS` on every render, one `[data-team="…"]`
  block per team. Templates never build a variable name from a team string.
- **Fonts are vendored** under `templates/fonts/` with `font-display: block`, so
  a render here and a render in CI lay out identically and no fallback face
  gets baked into a PNG.
- **The logo is an inlined CSS mask** (`templates/_assets.css`, generated from
  `logos/`). It must stay greyscale **+ alpha** and stay a `data:` URI —
  `mask-image` reads the alpha channel, and Chromium won't load a mask across a
  `file://` opaque origin. Break either and it silently becomes a gold rectangle.
  The **crops** come from `scripts/logo-marks.mjs`, shared with the site's own
  generator so a post and the site header can't crop the mark differently.
- **Sealed votes are refused, not rendered.** Any vote-derived board (votes,
  finals votes, BOG) on a season in `sealedVoteSeasons` throws; the CLI reports
  the skip. A graphic gets posted, so leaking there is worse than on a page.
- **Match winners come from `win?`, never from counting sets** — S4 R9 has a
  `5-5` that neither side won.
- CI renders the current round on push to `main` and uploads the PNGs as an
  artifact. It runs alongside the Pages build and is `continue-on-error`, so it
  can't slow or block a deploy. **Nothing is committed to the repo.**

## Data conventions (must respect)

- **Canonical names:** `Lachlan Jenkin` (not Lachie), `Jim Papa` (not James).
  Aliases applied after stripping `(Fill-in)`.
- **Pairing display order is captain-first, draftee-second.** Set via `pair` in
  the season config; captain is element 0. If unset, pairing is derived from
  games played (top non-fill-in members).
- **Votes eras:** S1 = 2/1 + Player-of-the-Round; S2+ = two voters × 3-2-1
  (max 6/match). Blank votes are treated as missing (never 0).
- **S1 votes are era-adjusted in cross-era windows only:** a career/all-time
  tally counts an S1 home-and-away 2 as 6 and a 1 as 4 (`adjustedVotes`, mapped
  in `normalize.ts` from `SITE.voteEraMap`), so a best-on-court night weighs the
  same in every era. Season windows, the S1 MVP tally, BOG derivation and the
  match log always use votes as cast; `PlayerAgg.votesEraAdjusted` tells the UI
  when to footnote. Finals rows are never rescaled.
- **Finals MVP votes are 4-3-2-1** and live in the same `votes` column, on
  finals rows. They are a separate award: never part of the season MVP tally or
  the Votes leaderboard, and only a `'finals'`-scoped aggregate reports them
  (the skip lives in `aggregateRows` in `stats.ts`). They do drive BOG in a
  final, same rule as any other match.
- **Serve stats:** S1 only. **Errors Forced:** S2+ only.
- **BOG = most votes in a match** (both sides of the fixture); ties share it.
- **Fill-in games** are excluded from leaderboards by default (toggle to include).
  On a **player page it depends on the window**: career numbers count them (a
  night on court is a night on court), a season panel doesn't — that match was
  played for another team — and says so, with the record it dropped
  ("Fill-in matches excluded (1–0)"). Rank badges follow the same rule, so a
  badge always ranks the number printed above it (`fillInRecord` in `stats.ts`).
  **Votes are the exception: never counted in any window**, career included —
  they were cast for whichever team you turned out for — but both vote tiles
  report what was set aside (`fillInVotes`).
- **Every blank stat cell is `null`, not 0** — coverage is tracked per stat
  (`PlayerAgg.tally[stat].{total,games,sets}`), so a partial finals entry never
  drags an average toward zero. Don't reintroduce `num()` for a stat column.
- **Finals** live in the CSV with `Round` = `QF`/`SF`/`F` and the scoreline in
  `Score`. They count for win-loss, H2H, streaks and per-set rates; they're
  excluded from the ladder, career totals, the record books and MVP votes
  (`StatScope` in `stats.ts` is the switch — `'regular'`, `'all'` or `'finals'`).
- **Rank badges** (`ranks.ts`) rank a player inside the window the panel is
  showing — all-time or one season, totals or per set — against everyone with
  `SITE.rankMinMatches`+ matches in it. Short samples get no badge and are kept
  out of everyone else's field. **A tier is only ever put on a normalised
  number**: the per-set boards always, win rate / finals win rate / winner-to-UE
  in both modes (they don't change with the switch, so their badge mustn't
  either), and matches played never — turnout is ranked, not graded. Tiers are
  shares of the field (`rankTiers`), shown as a tier word except for the podium,
  which keeps its number. **Ungraded boards** — every total, plus matches played
  — badge the top `rankTopTotals` and stay quiet about the rest. `#1` always means the biggest
  number: for unforced errors and double faults the colour flips instead, so
  leading that board reads as the disgrace it is. Per set is the default view.
- **The UI says "matches", not "games"** — "games" is reserved for game scores
  (the ladder's for/against and ratio). `PlayerAgg.games` keeps its old name.
- **Rates are per set, never per match** — a semi or final runs to three sets.
  Votes are the exception: awarded once a match, so `votesPerGame` stays.
- **Photos:** `content/photos/photos.yaml` is the manifest — file, tagged player
  slugs, season, caption. Folders (`season-N/`, `misc/`) are just storage. A
  photo not in the manifest is invisible; `check-data` and `copy-assets` both
  warn. Manifest order = gallery order; avatar = first solo-tagged photo.
- **Photos are served unprocessed.** They go through `public/`, the one
  directory Astro copies byte-for-byte, so `astro:assets` never sees them —
  whatever is on disk is what a visitor downloads into a 200px tile. **Run
  `npm run optimize-photos` after adding any**: it caps the long edge at
  2000px, re-encodes as JPEG, bakes in EXIF orientation and keeps only the
  capture date (camera model and GPS coordinates are dropped — these files are
  publicly downloadable). It's idempotent, and renames PNG→JPEG, updating
  `photos.yaml` to match. `check-data` warns above 1 MB.
- **The logo is generated, never hand-edited.** `public/logo/` is written by
  `npm run build-logo` from `logos/`; the output is committed. `crest.png` is a
  **mask**, same trick as the graphics: the drawing lives in the alpha channel
  and `.mark` in `global.css` paints `currentColor` through it, which is how one
  file is gold in the header and ivory at 3.5% behind the page. Size a `.mark`
  by height *or* width and let the other follow — `Crest.astro` supplies the
  aspect ratio (read out of the PNG) and the mask URL (only it knows the deploy
  base path, so the URL can't move into the stylesheet). `favicon.png` and
  `og.png` bake the colour in instead: a tab and a link preview are composited
  by somebody else's renderer.

## Current state / open TODOs (owner to fill)

- **S4 (2025) is complete** — full results, honours filled, votes loaded and
  **unsealed**; `sealedVoteSeasons` is empty. All honours for all four seasons
  are filled in (no `TODO` honours remain).
- **Season 5 (2026) is drafted but not live**: `season-5.ts` has all ten teams
  from the draft (honours/finals still empty) and `seasonYears` maps 5 → 2026.
  S5 is the first **ten-team** season — **Brown** was added to `TEAMS` in
  `site.ts` alongside the original nine. When the first S5
  rows land in the CSV, flip `currentSeason` to 5 in `src/config/site.ts` —
  until then the homepage keeps showing S4, because a season with no rows has
  an empty ladder and no `/seasons/5/` page to link to. Add 5 to
  `sealedVoteSeasons` at the same time if votes are to stay hidden until
  awards night.
- All four brackets have full results. Finals **player stats**: S3 has finals
  MVP votes in the CSV (28/28 rows; the derived 4-3-2-1 tally matches the
  recorded Finals MVP). S1, S2 and S4 finals are **scorelines only** — no
  player stats yet.
- S1–S3 finals (line-ups and scores) came from the owner's sheet
  `~/Documents/TNT/alltime_with_finalsresv2.csv`; S4's were derived from the
  bracket and have been **verified against the real sheet**.
- **Tiebreak sets:** the owner's sheet records them level (`6-6`, `5-5`); the
  brackets normalise to `7-6(4)` etc. where the breaker score is known. Both
  live in the repo — S1 F, S3 QF4 and S3 SF1 use the normalised form; the S2
  final keeps `6-6`/`3-3` because nobody recorded those two breakers. A level
  set is a `check-data` warning, never an error: `win?` settles the match.
- Most team **captains** are blank except S4 and Kierce's teams.
- `npm run check-data` flags 2 ambiguous S1 R8 rows (Hume, Dickson — two
  non-fill-in rows in one round); pre-existing data, left as-is.
