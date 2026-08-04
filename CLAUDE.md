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
```

Node 20+. `--experimental-strip-types` is used to run the `.ts` scripts directly;
season configs use `import.meta.glob`, so they only load under Vite (Astro), not
plain Node — `ladder`/`check-data` deliberately avoid importing them.

## Architecture

```
src/lib/normalize.ts     THE normalization layer: CSV -> StatRow[], all quirks here
                         (name merge, fill-in, SINGLES GAME, serve S1-only,
                          errors-forced S2+, EVERY stat null-if-blank, BOG
                          derivation, Round->stage, Score->sets)
src/lib/stats.ts         ladder, rosters/pairings, player aggregates, leaderboards, records
src/lib/ranks.ts         where a player sits in the field — the stat-panel badges
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
  (max 6/match). Blank votes are treated as missing (never 0).
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

## Current state / open TODOs (owner to fill)

- **S4 (2025) is complete** — full results, honours filled, votes loaded and
  **unsealed**; `sealedVoteSeasons` is empty. All honours for all four seasons
  are filled in (no `TODO` honours remain).
- **Season 5 (2026) is scaffolded but not live**: `season-5.ts` exists (teams/
  honours/finals empty) and `seasonYears` maps 5 → 2026. When the first S5
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
