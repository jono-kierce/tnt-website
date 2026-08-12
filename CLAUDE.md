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
                          derivation, Round->stage, Score->sets, played-vs-fixture)
src/lib/stats.ts         ladder, rosters/pairings, player aggregates, leaderboards,
                         records, MatchRecord/seasonRounds (whole matches + byes),
                         the `contribution` ledger and the four match-up tiles
src/lib/predict.ts       the Elo model: win probabilities, power ratings, backtest
src/lib/insights.ts      rule-based "worth knowing" lines for a match page
src/lib/ranks.ts         where a player sits in the field — the stat-panel badges
src/lib/site-data.ts     page-facing helpers (season ladder, MVP tally, fun stats)
src/lib/datetime.ts      formats the Start column for display — string in, string
                         out, never a Date (see Data conventions)
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

- **Fixtures live in the CSV.** A drawn-but-unplayed match is 4 rows sharing
  Team/Opponent/Season/Round/Player with **every RESULT column blank** (`Start`
  may be filled — see below). The blank `win?` is the sole discriminator — a played row always carries one, even a
  finals result entered as a scoreline with no stats. Defined once, in
  `normalize.ts` (`StatRow.scheduled`); `isPlayed`/`playedRows` in `stats.ts` is
  the gate, applied inside `matchSides`, `playerRows`, `fixtureSides`,
  `winStreaks`, `bestSingleGame` and `teamRoster` so nothing downstream — the
  graphics included — has to remember. A fixture counts toward **nothing**.
  Filling in the stats and `win?` turns it into a played row with no other
  change. `allSeasons` counts a drawn season (the page must exist); `allPlayers`
  does not (a player with no played rows has no slug, so no page).
- **Byes are derived, never stored:** a round's byes are the season's declared
  teams minus the teams with a fixture. That team set can't come from the CSV —
  a team on a bye in round one has no rows at all — so it's passed in from the
  season config's `teams` keys (`declaredTeams` in `site-data.ts`), which is
  also what seeds a live ladder at 0/0/0. Round sizes vary on purpose: S5 runs
  five rounds of four matches and five of five. `check-data` reports byes and
  never warns about an uneven round; the one thing it errors on is a team drawn
  twice in the same round.
- **Match times are the `Start` column, in Melbourne wall time:**
  `2026-08-18T18:30`, exactly what the sign at the courts says. Optional
  everywhere — blank means "not recorded", which is every season before S5 —
  and repeated across a match's four rows the same way `Score` is, because it's
  a match-level fact and that's this file's grain. It is the one column that
  belongs on a *fixture*: it describes the draw, not the result, so it's in
  `FIXTURE_COLUMNS` in `check-data` and a fixture with a time is still a
  fixture. **Never parsed into a `Date` for display** (`src/lib/datetime.ts`
  formats the string directly): `new Date('2026-08-18T18:30')` resolves against
  the *build machine's* timezone, and CI runs in UTC. Storing wall time is also
  what makes the AEST→AEDT switch mid-season a non-event. `SeasonRound.date` is
  derived from the matches — earliest wins, so a rescheduled match doesn't drag
  the round's heading. Sorting a round by `start` is what puts its matches in
  playing order (`byPlayingOrder`); with no times it falls back to alphabetical
  as before. `check-data` errors on a malformed or impossible value and on a
  match whose rows disagree, and warns on a non-Tuesday or a round spanning two
  dates — both legal, both usually a typo.
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

## The prediction model (`src/lib/predict.ts`)

Per-player Elo, replayed chronologically over every played match from S1 R1. A
pair rates at the mean of its two players for prediction purposes, but each
player is *updated* individually against the opposing pair's mean rating —
not as a share of a team result. Rules that matter:

- **It never reads `votes`** — a test greps the file to prove it. That's what
  makes it safe against a sealed season.
- **Outcomes come from `win?`**, via `MatchRecord.winner`, never from counting
  sets. A match with both sides flagged alike scores 0.5 (no such match exists;
  the S4 R9 `5-5` has a winner — it's the *set* that has no breaker recorded).
- **A player's own score blends the result with personal performance against
  the pair across the net**, not a share of a team-wide delta. `outcomeWeight`
  (0.3) of the score is the match result — the same for both team-mates, a win
  or a loss; the rest is `0.5 + 0.5 × tanh((own net stat − opponent pair's mean
  net stat) / performanceScale)`, where net stat is `(winners + aces + errors
  forced) − (unforced errors + double faults)`. Forced errors stay out of the
  ledger — they're the opponent's credit, already counted on their side. This
  is the direct fix for the old model's blind spot: a player who performed well
  personally could previously only ever lose *less* on a losing side, never
  gain — because the team's delta was fixed by the result and only reallocated.
  Now each player is rated against the opponent pair's rating directly, so a
  standout night against a strong pair can be a net gain even in a loss, and a
  passenger's rating no longer rides on a team-mate's night. **Opponent
  strength is priced in only once**, through the surrounding Elo expectation
  (`expectedScore(playerRating, opponentPairRating)`) — the stat comparison
  itself doesn't also weight by opponent rating, which would double-count the
  same signal. Falls back to the result alone when either side has no stat
  line, which is every finals night on record bar Season 3's.
- **The model gives up classic Elo's zero-sum property, on purpose.** A
  player's delta no longer depends on a team-mate's, so a match's four deltas
  don't have to net to zero. That's the price of rating performance instead of
  just result.
- **Most constants are tuned, not guessed; `k` and `scale` are the exception.**
  `tune()` grid-searches `k`, `seasonRegression`, `outcomeWeight` and
  `performanceScale` and a test re-runs it, so new results can't leave the
  search itself stale. Ranked on accuracy among settings passing a
  face-validity gate (four named players inside the top eight of twenty-six
  qualified players) — an editorial judgement, documented as one. At eight,
  185 of 1225 settings searched clear it, for a cost of two calls out of 166
  against the best setting with no gate at all; at six, **nothing in the
  search clears it** — not a stricter gate, an unsatisfiable one.
  `outcomeWeight` is floored at 0.3 in the search grid itself: the
  unconstrained accuracy-best wants 0.1, but a win needs to stay "a large
  part" of a player's score on principle, not just whatever the backtest
  prefers. `k` (20) and `ELO.scale` (250, down from Elo's own 400) are then
  hand-pushed bolder than the pure accuracy-best pick, on purpose — the
  committed constants no longer equal `tune()`'s own top result, only a test
  that they still clear the face-validity gate. `scale` in particular costs
  nothing in raw call-correctness (`favourite`/`correct` come from the *sign*
  of a rating gap, which `scale` never touches) — it only makes a given gap
  read as a bolder percentage, at a real cost to calibration (Brier). `k`
  genuinely does trade accuracy for reactivity: the tuned k=16 called 66.9% of
  166; the committed k=20 with scale=250 calls 62.7%.
- **Between-season regression dropped to zero** — the opposite of the old
  team-split model's 0.9, and worth flagging because that file used to call
  the relationship monotonic in the other direction. The difference: a rating
  built from personal stat performance already tracks current form more
  closely than one built purely from accumulated team win/loss, so there's
  less staleness left to regress away in January.
- **It still cannot genuinely call an opening round — it just no longer looks
  that humble about it.** Backtest accuracy on rounds 1–2 sits at 50%, no
  better than a coin, same as ever: after a redraft, prior form says nothing,
  and no amount of `scale` changes that. What `scale=250` changes is the
  *display* — an S5 opener can now read as 65% instead of pinned near even,
  which is a deliberate boldness trade, not a claim that the model learned
  something new about redrafted pairings. `PredictionBar` still prints
  "line-ball" inside 4% of even.

## Match insights (`src/lib/insights.ts`)

Pure detectors over `stats.ts`, each returning `Insight | null`, **silent when
nothing qualifies**. A detector only ever sees matches played *strictly before*
the one being described, so an insight on a 2023 match reads as the preview it
would have been. Keep them stingy: "revenge match" once fired on 78% of the
fixture list (it looked back across seasons, where a redraft means the two teams
share only a colour), and a label that's nearly always true says nothing. A test
fails if the share of matches with an insight leaves the 40–85% band.

## The match-up tiles (`formMatchups` in `src/lib/stats.ts`)

A player page shows four, in a 2×2. The top pair (`bestWorstOpponent`) answers
"who do you beat?" off the scoreboard; the bottom pair (`formMatchups`) answers
"who do you play *well* against?" off the stat sheet. Rules:

- **One ledger, shared with the model.** `contribution` — winners + aces +
  errors forced, less unforced errors and double faults — now lives in
  `stats.ts` and is re-exported from `predict.ts`, which is where it used to
  live. Don't write a second performance score. (`insights.ts` has a private
  `net()` that predates the move and duplicates it; fold it in if you're
  passing.)
- **Every match is centred on its season's league par** (`leaguePar`, memoised
  on the row array). This is not optional. `Errors Forced` doesn't exist in S1,
  so raw contribution per set runs S1 −3.93, S2 −2.54, S3 −2.02, S4 −1.61, and
  a player whose meetings with someone happened mostly in 2022 would be labelled
  "worst form against" them on the CSV's column history. Centring also absorbs
  the general drift, which continues past the S1 gap. There's a test whose only
  job is to stop someone simplifying it away.
- **Set-weighted, like every other rate here:** `sum(centred) / sum(sets)`, so a
  three-set final outweighs a one-set Tuesday. Per-match weighting was
  considered and rejected.
- **Statted meetings only.** Three of the four finals brackets are scorelines
  with no player stats; a match with no ledger is not evidence about form, so it
  joins neither the tally, the baseline, nor the qualifying count. 25 of 30
  players qualify, against 26 for the record tiles.
- **The baseline excludes the opponent**, so it's per opponent, not one number
  per player. Two tiles on a page can quote slightly different norms. Correct.
- **No shrinkage, on purpose.** Raw argmax. Shrinking moved 3 of 50 picks, which
  didn't justify the tile's number no longer matching its popover. The cost is
  owned in the fine print: 26% of picks rest on two matches, they're the most
  extreme ones, and a tile can flip on one new meeting. **Don't add shrinkage
  back without asking.**
- **The justification line is the stat with the largest absolute deviation**,
  among the five that make up the ledger, and it's direction-aware — the biggest
  mover is more often a *drop* in unforced errors than a rise in winners. A stat
  with no coverage on either side of the split is skipped, never read as zero;
  with nothing left, the tile shows the delta alone rather than a placeholder.
- **It never reads `votes`** — a test greps the section, same guarantee as
  `predict.ts`, so the tiles are safe on a sealed season.
- **Known and not worth fixing:** this is doubles, so "form against X" is always
  "form against X *and whoever partnered X*". The record tiles have the identical
  confound. Damon Maurice is several players' best match-up, which is partly
  signal and partly "some opponents are easier for everyone"; the metric can't
  separate them, and 2–6 meetings won't support a partner-adjusted version. One
  sentence of fine print, not a bigger model.

## Current state / open TODOs (owner to fill)

- **S4 (2025) is complete** — full results, honours filled, votes loaded and
  unsealed.
- **Season 5 (2026) is LIVE and yet to be played.** `currentSeason` is 5 and
  `sealedVoteSeasons` is `[5]`. **The full ten-round draw is in the CSV** — 45
  fixtures across ten Tuesdays, 18 Aug to 20 Oct 2026, nine matches a team, five
  rounds of four and five of five. Nothing has been played, so the ladder shows
  all ten teams at 0/0/0 and every S5 prediction sits near 50/50 — which is
  honest, not a bug. S5 is the first **ten-team** season; **Brown** is in
  `TEAMS` alongside the original nine. `season-5.ts` has all ten pairings,
  captain-first; honours and finals fill in at season's end. **Remove 5 from
  `sealedVoteSeasons`** on awards night.
- **`npm run graphics` with no arguments exits 0 and renders nothing** while S5
  has fixtures but no results — a round with no scores is not something a result
  card can show. That's deliberate, so the CI graphics job stays green between
  the draft and the first result. Pass `--season 4` to render the archive.
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

### Deliberately not built (hooks left, nothing wired)

- **Model accuracy tracker UI.** `backtest()` already returns every match with
  its pre-match call, so a "how the model is doing" page is a component away.
- **Round-preview Instagram graphic.** `predictionFor` + `insightsFor` give a
  preview card everything it needs; it would be a fourth template family and a
  payload builder, following the same "no graphic computes a statistic" rule.
- **Finals odds / Monte Carlo ladder.** `replay()` is deterministic and cheap,
  so simulating the run home is tractable — but it needs a story about how to
  present uncertainty, not just the numbers.
