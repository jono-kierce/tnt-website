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
3. **Derived, never stored:** BOG (from votes) and team pairings (from games
   played) are computed — there is no BOG column and no roster list in the CSV.
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
```

Node 20+. `--experimental-strip-types` is used to run the `.ts` scripts directly;
season configs use `import.meta.glob`, so they only load under Vite (Astro), not
plain Node — `ladder`/`check-data` deliberately avoid importing them.

## Architecture

```
src/lib/normalize.ts     THE normalization layer: CSV -> StatRow[], all quirks here
                         (name merge, fill-in, SINGLES GAME, serve S1-only,
                          errors-forced S2+, votes null-if-blank, BOG derivation)
src/lib/stats.ts         ladder, rosters/pairings, player aggregates, leaderboards, records
src/lib/site-data.ts     page-facing helpers (season ladder, MVP tally, fun stats)
src/lib/stats.test.ts    unit tests — keep these green
src/config/site.ts       currentSeason, sealedVoteSeasons, seasonYears, team colours, thresholds
src/config/aliases.ts    name alias map + slug/short-name helpers
src/config/seasons/*.ts  per-season honours, captains, pairing order, finals bracket
src/pages, src/components  UI (Astro)
content/                 bios, photos, recaps (owner-edited)
scripts/copy-assets.mjs  copies CSV + photos into public/ at build (pre-dev/build)
```

## Data conventions (must respect)

- **Canonical names:** `Lachlan Jenkin` (not Lachie), `Jim Papa` (not James).
  Aliases applied after stripping `(Fill-in)`.
- **Pairing display order is captain-first, draftee-second.** Set via `pair` in
  the season config; captain is element 0. If unset, pairing is derived from
  games played (top non-fill-in members).
- **Votes eras:** S1 = 2/1 + Player-of-the-Round; S2+ = two voters × 3-2-1
  (max 6/game). Blank votes are treated as missing (never 0).
- **Serve stats:** S1 only. **Errors Forced:** S2+ only.
- **BOG = most votes in a match** (both sides of the fixture); ties share it.
- **Fill-in games** are excluded from leaderboards by default (toggle to include).

## Current state / open TODOs (owner to fill)

- S4 (2025) votes are loaded and **unsealed**; `sealedVoteSeasons` is empty.
- Finals brackets for S1–S3 are empty `finals: []`; S4 has the structure only
  (no scores).
- Most team **captains** are blank except S4 and Kierce's teams.
- Some Season MVP / Finals MVP honours and finals scores are marked `TODO`.
- `npm run check-data` flags 2 ambiguous S1 R8 rows (Hume, Dickson — two
  non-fill-in rows in one round); pre-existing data, left as-is.
