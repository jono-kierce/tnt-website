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
node graphics/render.mjs --only scoreboard           # the round's results, one slide
node graphics/render.mjs --only finals              # the season's finals format, no teams
node graphics/render.mjs --only finalsfixture       # the same bracket with the final ladder's teams
node graphics/render.mjs --only tiepreview --tie WC --photos a.png,b.png,c.png,d.png  # one finals tie as a poster
node graphics/render.mjs --round WC --only results,players --photos ./photos/wc/   # a finals carousel per match
node graphics/render.mjs --help
```

With no arguments it renders `SITE.currentSeason` at the latest round in the
CSV — which is exactly the round you just added. PNGs land in `graphics/out/`
(gitignored) at 2160×2700, i.e. 2× for a retina phone.

| Flag | |
|---|---|
| `--season <n>` | Default `SITE.currentSeason`. |
| `--round <r>` | A round number, or `WC` / `QF` / `SF` / `F`. Default: the season's latest — except for `preview`, see below. |
| `--only <list>` | `ladder`, `results`, `scoreboard`, `boards`, `leaders`, `draft`, `preview`, `streaks`, `streakstory`, `headline`, `predictions`, `pair`, `rivalry`, `mvpsim`, `pointsladder`, `pairsplit`, `longest`, `tiebreaks`, `pointsplayed`, `finals`, `finalsfixture`, `tiepreview`, `drought`, `players` — comma-separated. Default `ladder,results,scoreboard,boards`; the rest are once-off posts, so they only render on request. |
| `--tie <id>` | The finals tie for `--only tiepreview`, by its id in the season config (`WC`, `QF2`…). Default `WC`. |
| `--look <name>` | Which tie poster: `poster` (default), `tape`, `split`, `print` or `cards` — see Tie preview. |
| `--pair <a,b>` | The two players for `--only pair` (team-mates) or `--only rivalry` (head to head), comma-separated. |
| `--sim <path>` | The MVP projection summary CSV, for `--only mvpsim`. Required — there is no default, because the file lives outside this repo. |
| `--runs <n>` | How many runs that projection was over, for the subtitle. Omitted, it reads "Simulated". |
| `--photos <dir>` | Photos for the result cards. |
| `--career` | Also render the all-time boards. |
| `--out <dir>` | Default `graphics/out`. |

Filenames are `s4-r09-ladder.png`, `s4-r09-match1-pink-v-white.png`,
`s4-r09-stat-mvp-race.png`, `s5-r02-scoreboard.png`, `s5-r01-preview.png`,
`s5-r05-mvp-sim-1.png`.
Rounds are zero-padded and finals sort last, so a folder listing is in playing
order.

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

**The one exemption is the MVP simulation board** (`--only mvpsim`), and it is
deliberate: that board prints a *projection* of where the race finishes, not the
recorded tally, and the whole point of posting it is to tease a live season. The
seal is untouched for every board that reads the CSV's own `votes` column —
`statBoardPayload` and `pairBoardPayload` still throw — and a test pins both
halves of that so the exemption can't quietly widen. The board also can't be
rendered by accident: it's out of the default `--only` set and needs an explicit
`--sim <path>`.

---

## The one rule

**No graphic computes a statistic.** Every number comes from
`src/lib/stats.ts` (or, for the points families, `src/lib/points.ts` — same
rules: a tested library in `src/lib`, never the renderer), every data quirk from `src/lib/normalize.ts`, and every
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
    mvp-sim.ts         the external MVP projection CSV -> typed rows (the one
                       input that isn't data/alltimestats.csv)
    tokens.ts          TEAMS + brand constants -> templates/_tokens.css
    season-configs.ts  re-exports src/config/seasons/node.ts (season-N.ts under plain Node)
    payloads.test.ts   score parsing + payload building
  scripts/
    fetch-fonts.mjs    vendors the webfonts (run when a family changes)
    build-assets.mjs   logo -> templates/_assets.css (run when the logo changes)
    cutout.m           macOS subject-lift: a match photo -> transparent PNG
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
    scoreboard.html
    mvp-sim-board.html
    points-ladder.html
    pair-split.html
    longest-matches.html
    finals-format.html  the bracket: format (--only finals) and fixture (--only finalsfixture)
    tie-preview.html    one seeded finals tie as a fight poster (--only tiepreview)
    tie-tape.html       the same tie, tale of the tape (--look tape)
    tie-split.html      the same tie, a half each (--look split)
    tie-print.html      the same tie, screen print on paper (--look print)
    tie-cards.html      the same tie, two trading cards (--look cards)
    finals-drought.html played finals, never won one (--only drought)
  cutouts/             transparent player PNGs for the posters, by season (see Cutouts)
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

## The template families

(The five below are the weekly ones; `streaks`, `headline`, `predictions` and
`pair` are the once-off posts, rendered only when asked for by `--only`.)

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

A **finals** card (any `WC`/`QF`/`SF`/`F` round) takes a gold "— Finals" mark
where the season eyebrow sits, with the stage and the round line in gold and a
second hairline under the panel's rule. Nothing else changes, so a finals night
still reads as the same set as a Tuesday.

### Player slides — `player-slide.html`

Slides 2–5 of a match's carousel, after its result card: one per player,
winners first and captain first within a side. The photo owns the right of the
frame and dissolves into the field with the team's glow behind it; the name and
three numbers from the match stack down the left — winners, errors forced,
unforced errors. No scoreline: slide 1 has just printed it.

```bash
node graphics/render.mjs --round WC --only results,players --photos ./photos/wc/
```

- **Numbers come from `matchPlayerLines` in `stats.ts`**: the match values,
  where each sits among the four on court, and his home-and-away season rate
  per set. The payload only labels them.
- **The line under a number** is a tag when he's at one end of the court —
  "Most on court" / "Joint most" in gold for winners and errors forced,
  "Fewest on court" in gold or "Most on court" in red for unforced errors —
  and otherwise his season rate ("Season rate 4.2", "… a set" when the match
  ran past one set).
- **A match with no player stats** (a scoreline-only final) gets no slides, and
  the CLI names it. A blank stat prints "–", never 0.
- **Photos come from the same `--photos` folder as the result cards**, matched
  by the player's slug (`jonathan-kierce.jpg`) or surname (`kierce-lunge.jpg`).
  Two players sharing a surname on court match on the slug only. Anyone without
  one falls back to his season photo from the manifest, and the CLI warns that
  it isn't from the match.
- Files are `s5-rWC-match1-orange-v-yellow-2-jimmy-gorton.png`, beside the
  match's own `…-match1-orange-v-yellow.png`. Nothing reads votes, so a sealed
  season is no obstacle.

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
- **The spotlight** — the leader pictured. Set `showPhoto` and #1 comes out
  of the table: their photo bleeds off the top-right corner and dissolves into
  the page (two intersected masks), their team colour glows behind it, and
  the name and the number take the left column, with #2–#8 beneath. The number
  is gold, or red on a `polarity: 'low'` board, because leading the unforced
  errors isn't an honour. A shared lead prints "Joint No. 1" and `=1` on the
  tied rows, judged on the printed value.
- **A season board only pictures that season** (`leaderPhoto` in
  `payloads.ts`): a solo photo tagged with the board's season, never an older
  frame, since a 2026 leaderboard fronted by a 2023 kit reads as a mistake. If
  there isn't one, the plain board renders and the CLI names the player whose
  photo is missing. A career board takes `leadPhoto()` — the site's avatar
  rule minus `avatar: true` headshots, which are too small for a 1080px slide.
  `photoIndex` picks a later frame so one player leading two consecutive
  slides isn't shown twice in the same pose. `cutout: true` is for a
  transparent PNG.

**Leaders** (`--only leaders`) is a carousel of eight stat boards off the same
template — winners, unforced errors, aces and errors forced, each as a season
total and per match (`leaderBoards` in `lib/boards.ts`), all with the
spotlight. Both halves are
home-and-away only. "Per match" is the per-set rate on that scope, which is the
same number because every Tuesday match is one set; a test pins sets == matches
so the label fails loudly rather than lying if that ever changes. Widening the
scope would let a three-set final count as one "match". On request only, like
the once-off posts, so the weekly default stays at four boards.

### Scoreboard — `scoreboard.html`

The whole round's results on one slide — the preview's twin, run the morning
after instead of the day before. Kickoff order down the page, winner's row on
top of each pair with the ladder leader's gold spine, set scores at the right,
byes at the foot. It needs no photos and no human input at all, which is the
point of it: a Tuesday nobody photographed still gets a post.

- **Winner first, and the winner comes from `win?`** — same rule as the result
  card, for the same reason. `MatchRecord.sides` is alphabetical by team, so
  the board reorders; a match with no winner recorded keeps that order and
  takes no gold.
- **Only played fixtures.** A drawn-but-unplayed round belongs to `preview`,
  and the board renders empty rather than printing a fixture as a result.
- It carries **no insight lines** — the scoreline is the story, and five
  matches of it fill the page. The banter goes on the preview.
- Renders alongside the result cards by default, so posting a round is still
  one command. Fits five matches comfortably; four sits looser.

### Pair board — `pair-board.html`

Two players' record as team-mates, on one slide — the post for a redraft that
splits a long-running pair, or for the week they first face each other.

```bash
node graphics/render.mjs --only pair --pair "Ed Simpson,Jimmy Gorton"
```

All-time, so it takes no `--season` and no `--round`, like `streaks`. The
record and the per-season strip come from `pairRecord()` in `stats.ts`; the
board itself does no arithmetic, and a test asserts its printed record equals
what `pairRecord` returned.

- **Counting stats only** — winners, aces, unforced errors, double faults,
  votes and best-on-ground. No rates: a per-set number would need
  `SITE.perGameMinGames` and a footnote about the denominator, and this board
  is meant to be read at a glance.
- **The bigger number is always the one lit, never "the better one"** — the
  same rule the stat boards rank by. `polarity` only decides which ink it
  takes, so leading the unforced errors reads red rather than gold.
- **Finals and fill-in matches both count**, as they do in `headToHead`: a
  premiership is what a pair is remembered for, and a night the two of them
  were on court together is a night they played together.
- **Refused, not rendered, for a pair who played together in a sealed season.**
  The board carries votes and BOG, so `sealedVoteSeasons` applies — checked
  against the seasons the pair actually shared, since there's no round to
  check against. The CLI reports the skip and carries on.
- The window spans whatever seasons the pair played, which is cross-era by
  nature, so **S1 votes are rescaled** exactly as a career tally rescales them.
  The footnote says so, and only when something was actually rescaled.

### MVP simulation — `mvp-sim-board.html`

The MVP race as a Monte Carlo projection: each player's chance of finishing 1st
/ top 3 / top 5 / top 10 across thousands of simulated runs of the rounds still
to come, plus their median projected vote tally.

```bash
node graphics/render.mjs --only mvpsim --sim path/to/summary.csv --runs 10000
```

**This is the one family whose numbers don't come from `data/alltimestats.csv`.**
The model lives outside this repo and hands over a summary CSV, so the usual
rule — every number from `stats.ts` — can't apply and isn't pretended to. What
applies instead:

- **`graphics/lib/mvp-sim.ts` reads and checks the file; it computes nothing.**
  Every figure is printed as given, because re-deriving half of them here would
  make a second, disagreeing model.
- **The repo still owns the colours.** A row's team comes from
  `src/config/seasons/season-N.ts`, not from the file's own `Team` column; a
  disagreement is a warning that says which one won. A player the season doesn't
  have gets a mute spine and a warning, and a player in the season with no row
  in the projection is reported too — a board that silently dropped someone
  reads as a demotion.
- **A renamed or missing column throws**, naming the column it wanted, rather
  than parsing as `NaN` and printing a blank.
- **Ranked by the median tally it prints**, ties broken on the mean, then MVP
  chance, then name — so the order is total and the votes column reads top to
  bottom. A votes column that didn't descend would just look broken.
- **Ten players a slide**, numbered continuously, one PNG each
  (`-mvp-sim-1.png`, `-2.png`). Every slide carries the same header on purpose:
  they're one carousel, and the filename is what tells them apart.
- **The heatmap is one sequential hue.** These are four readings of the same
  magnitude, so gold at varying alpha rather than the stat boards' green → pink
  → red, which is a *diverging* ramp and would say "good end, bad end" about a
  projection. The wash curve is `sqrt`, not linear: linear wastes both ends —
  6.6% is invisible and everything past 90% is the same block of colour.
- **A `0` prints as `0`, never as a dash.** The model genuinely never produced
  that finish; a dash means "not recorded" everywhere else in this repo and
  would be a different claim.
- **Exempt from `sealedVoteSeasons`** — see the Sealed votes section above for
  why, and for what that exemption deliberately does *not* cover.

### Streak story — `streak-story.html`

One player's win streak as a swipeable carousel: a cover (the count, tally
marks, the run's key facts), the loss it began after, one chapter per season
and team the run passed through, then the record book and the next fixture.
A rail of W chips runs along the foot of every slide, and each slide lights
its own stretch of it, so swiping reads like a strip of film.

```bash
node graphics/render.mjs --only streakstory                         # longest live streak
node graphics/render.mjs --only streakstory --player "Angus Hume"
node graphics/render.mjs --only streakstory --photos "cover.jpg,,s5.jpg"
```

- **Every number comes from `winStreakRun` in `stats.ts`**, which a test holds
  to `winStreaks`' count, edges and live flag. Same rules: finals count,
  fill-in nights neither extend nor break a run.
- **The one editorial input is `lib/streak-notes.ts`** — a line under a match
  the CSV can't describe (the S3 semi that ran over two nights), keyed by match
  and checkable against `content/seasons/`. Nothing numeric goes there.
- Photos default to the manifest: the player's latest in the run's last season
  for the cover, his first (solo preferred) in each chapter's season.
  `--photos` overrides them slide by slide, cover first.

### Tie preview — `tie-preview.html`

One seeded finals tie as a fight poster — the post for the day before the
wildcard or a quarter-final. The two halves split on a gold diagonal, each
washed in its team's glow with the seed ghosted huge behind the pair; the
captain stands in front, the partner behind and dimmed. Underneath: record and
games ratio off the final ladder, the last five home-and-away results as form
chips, the night they met in the home and away (with any fill-in named, since
"Orange won 6–3" means less when Godden wasn't playing), and what's on the
line.

```bash
C=graphics/cutouts/s5
node graphics/render.mjs --only tiepreview --tie WC \
  --photos "$C/jimmy-gorton.png,$C/lachy-godden.png,$C/will-mumme.png,$C/ed-simpson.png"
```

- **Seeds and records come off `ladderWithPairings`**, the same ladder the
  site prints; a test holds each side's wins and ratio to the ladder payload.
  Form chips are the matches that ladder counts — a result against a withdrawn
  team isn't one, so the chips add up to the record printed beside them.
- **What's at stake comes from the bracket config**: the tie this one's winner
  feeds, and whoever is already seeded into it; "Loser's season is over"
  unless some tie takes the loser.
- **A slot fed by another tie** (QF1 after a wildcard, a semi) is filled once
  that tie is in the CSV, off its `win?` — never the bracket config's own
  `result`. Until then it's **refused**, as is everything while home-and-away
  fixtures remain. A slot still waiting on two teams reads as both ("Winner
  plays White or Pink in SF1").
- **When it's on is the fixture's `Start`** (`date`, `time` in the payload),
  so a drawn-but-unplayed finals row with a time is all it needs. `--subhead`
  ("Tonight") replaces the date.
- **Form includes forfeits**, flagged: the ladder counts them, so the chips
  still add up to the record. `cards` draws a forfeit chip hollow.
- **No prediction**, like the weekly preview: posted the day before, a
  percentage reads as a tip.
- **Photos are four, home captain first**: home captain, home partner, away
  captain, away partner. A `.png` is drawn as a free-standing cutout; anything
  else as a frame dissolving into the poster (it works, but cutouts are the
  point). Missing entries fall back to the player's own photos for the season.
- Navy's own colour is invisible as a light on this canvas, so the washes and
  rim light use `--team-glow` — generated in `_tokens.css`, the team colour with
  its HSL lightness lifted until it reads. A light team keeps its colour as is.

**Four more looks, same payload** (`--look`), for a night with several ties —
a carousel of four identical posters reads as one post four times. Each prints
less than the diagonal poster, on purpose: the photos carry it, and a line of
small grey context under every number is what makes a poster feel busy.

| Look | What's on it |
|---|---|
| `tape` | Pairs down each side, a frosted spine of seed / record / ratio / their home-and-away games between them. |
| `split` | Home's colour fills the top half, away's the bottom, a gold band across the seam with the tie and the time. Seed, record, names. |
| `print` | Paper, not ink: each pair breaking out of a halftone block of its colour, the blocks stepping down the page. Seed, record, names, and the one line "Last met". |
| `cards` | Two trading cards with the seed on a badge and record, names and form on the name plate; the time underneath. |

```bash
C=graphics/cutouts/s5
node graphics/render.mjs --only tiepreview --tie QF1 --look tape \
  --photos "$C/luke-sharrock.png,$C/jack-raines.png,$C/jimmy-gorton-2.png,$C/lachy-godden-2.png"
node graphics/render.mjs --only tiepreview --tie QF2 --look split \
  --photos "$C/lachlan-jenkin.png,$C/jamie-harris.png,$C/quinn-feikema.png,$C/angus-hume.png"
node graphics/render.mjs --only tiepreview --tie QF3 --look print \
  --photos "$C/adam-dickson.png,$C/ted-angel.png,$C/shayl-inlander.png,$C/ethan-seamer.png"
node graphics/render.mjs --only tiepreview --tie QF4 --look cards \
  --photos "$C/jonathan-kierce.png,$C/jackson-virgona.png,$C/charlie-simpson.png,$C/damon-maurice.png"
```

Files are `s5-qf2-preview-split.png`; the default look keeps its old name.
`print` puts the partner on the outside of each block, so a captain's raised
racket can't cross his face — pick that captain's frame with it in mind.

### Finals drought — `finals-drought.html`

Everyone who has played a final and never won one — "Still Waiting". The
longest wait is pictured with his record in red and a chip per final lost; the
rest are a table of the same chips, so the length of a wait reads before the
number does. Anyone still in this season's bracket gets a gold "Next: QF3 v
Brown" line, and a chip from this season gets a gold edge. No tagline by
default (`--subhead` adds one).

```bash
node graphics/render.mjs --only drought --player "Declan Croucher" \
  --photos graphics/cutouts/s4/declan-croucher.png
node graphics/render.mjs --only drought --assume WC:Orange ...   # as if Orange win the wildcard
```

- **Counted in `finalsRecords` / `finalsDroughts` (stats.ts)**: fill-in finals
  count, forfeits don't, the result is `win?`. Players who never reached a
  final aren't on it — that's a different list.
- **`--assume <tie>:<winner>`** adds one result that isn't in the CSV yet, so
  the post for each outcome can be ready before the night. It's four rows off
  the season config's pairs with no score or stats — this board reads only who
  played and who won. **Refused once that tie is in the CSV**, so a guess can
  never be rendered over the real result. The filename says which outcome was
  assumed (`s5-finals-drought-if-orange-win-wc.png`); the graphic doesn't, because
  by the time it's posted it isn't an assumption.

### Cutouts — `cutouts/`

Transparent PNGs of players, made with `scripts/cutout.m` (macOS's built-in
subject lift — the same model Photos uses; build line in the file's header).
Raw frames come from the owner's library at `~/Documents/TNT/TNT Media/S<n>
Photos/r<round>/`, which has far more than `content/photos/` does — a whole
night per folder, so the frame from the night two teams actually met is often
there. Identify players the usual way (fixture elimination, then the face —
never the kit alone). The owner can also cut one in Canva if the model makes a
mess of a racket or a net.

The tie-preview slots place a figure by **its head and its height** and nothing
else, so a cutout has to follow two conventions:

1. **Cropped at the knee** (mid-thigh to knee). The legs dissolve into the
   panel below, and a knee crop keeps faces near the same size across a
   standing, a crouching and a stretching player.
2. **Centred on the head**: pad the narrower side with transparency until the
   head sits at the PNG's horizontal centre. A racket or a raised fist then
   hangs off one side without dragging the player off his mark.

3. **Face at about an eighth of the height.** A frame the net or the edge cut
   at the waist reads bigger than a knee crop in the same box, so pad it with
   transparency below and fade its cut edge until the face box is ~12.5% of
   the PNG's height. A knee crop is already there.

Named by slug under the season: `cutouts/s5/jimmy-gorton.png`; a second frame
of the same player is `-2` (`jimmy-gorton-2.png`), so an earlier poster still
re-renders as posted. ~1600px tall is plenty (a captain is drawn 720px tall at
2×). macOS Vision finds the face box for you — `VNDetectFaceRectanglesRequest`,
the same framework as `cutout.m`.

### Points ladder — `points-ladder.html`

```bash
node graphics/render.mjs --only pointsladder
```

The season's teams ranked by **share of points won**, beside where the real
ladder has them. Every point is rebuilt from the stat sheets by
`src/lib/points.ts` — winners, aces, unforced errors and double faults once
each, forced errors once per direction (the MAX of the errors-forced and
forced-errors ledgers, because a scorer sometimes fills in only one side).

- **Same field and window as the ladder**: declared teams, withdrawn teams
  off, home and away up to `--round`. A test holds the shares to
  `teamPoints()` and the ladder column to the site's own ladder.
- **The diverging bar is on a fixed ±10-point scale**, not the season's
  spread, so a runaway leader looks like one and a flat season looks flat.
- **The ladder column's arrow is the two ranks compared, nothing more**: red
  ▼ when the ladder has a team lower than its points would, green ▲ when
  higher. No "luck" number is printed — that's for the caption.
- **No footnote on either points board** — the definition of a point goes in
  the caption, where there's room to explain it.

### Pair split — `pair-split.html`

```bash
node graphics/render.mjs --only pairsplit
```

"Ball hogs": each active team's pair, split by their share of the
point-ending shots between them (`pairSplit()` in `points.ts`) — winners, aces,
errors forced, unforced errors, double faults and forced errors — most
lopsided first, heavier hitter on the left.

- **The pair is the season config's present-tense `pair`**, falling back to
  the roster's core two, and only the matches the two played *together* count.
- **A share is a per-match average**, so one long night can't outweigh a
  season of Tuesdays.
- **A thin sample owns up to it**: fewer than three matches together prints
  the match count in pink, and the CLI warns. It isn't dropped — a board that
  silently lost a team reads as a demotion.

### Longest matches — `longest-matches.html`

```bash
node graphics/render.mjs --season 5 --round 6 --only longest
```

"The Long Nights": the eight home-and-away matches with the most points
played, all-time (`longestMatches()` in `points.ts`), with `--round`'s own
longest match lit in gold and tagged with the round. If that match isn't in
the top eight it's appended below a break with its real rank, so the slide
always carries the match the post is about.

- **Home and away only.** A final runs to three sets, so it would win on
  format, not on the night. Ties share a rank (1, 1, 3).
- **Winner first, off `win?`**, each side with the points it won — a match
  can be won on fewer points (S4 R3, Light Blue 40–45 Black).
- **Unrecorded breakers print level** (`5` over `5`) until the score is
  back-filled; nothing is guessed.

### Tiebreak record — `tiebreaks.html`

```bash
node graphics/render.mjs --only tiebreaks
node graphics/render.mjs --only tiebreaks --photos content/photos/season-5/green-slap.jpg
```

The most tiebreaks played by one team in a home-and-away season, all-time
(`tiebreakSeasons()` in `stats.ts`), fronted by a photo of the record holders.
Rows down to third place, ties included; the tier after that prints as team
chips. Writes `most-tiebreaks-season.png`.

- **A breaker is a breaker score, a 7-6, or a set level at five or more** —
  the sheet records an unscored breaker as `5-5`. S3 R6's `1-1` is a short
  night, not a breaker.
- **Home and away only**, played matches only. Matches against a withdrawn
  team count — the strike is a ladder and MVP ruling.
- **The photo is the record season's latest gallery shot tagged with both of
  the record team's `pair`.** `--photos <file>` overrides it; none found renders
  on the court-green field and warns.

### Points played record — `points-played.html`

```bash
node graphics/render.mjs --only pointsplayed
```

The most points a player has been on court for in a home-and-away season,
all-time (`pointsPlayedSeasons()` in `points.ts`) — both sides' points, every
countable match, fill-in nights out. Top six, the record lit and fronting the
slide in their latest solo shot from that season (`--photos <file>` overrides).
Writes `most-points-played-season.png`.

- **Matches against a withdrawn team are struck for its opponents** and kept
  for its own players — the MVP ruling. Feikema's S5 loses his R4 against
  Black; Hume's keeps his four Black rounds.
- **A player who moved mid-season** prints both colours, `Black → Green`, with
  a split bar.

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
