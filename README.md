# Tuesday Night Tennis

The official record of TNT — a static site built from a single CSV, deployed to
GitHub Pages on every push to `main`.

- **Framework:** [Astro](https://astro.build) (static output, minimal client JS)
- **Source of truth:** `data/alltimestats.csv` — parsed at **build time**
- **Deploy:** GitHub Actions → GitHub Pages (`.github/workflows/deploy.yml`)

---

## Your weekly workflow

1. Append this week's rows to `data/alltimestats.csv`.
2. Commit and push to `main`.
3. GitHub Actions rebuilds and redeploys the site automatically. Done.

That's the whole loop. Everything on the site — ladders, player stats,
leaderboards, records, MVP tallies — is recomputed from the CSV each build.

---

## Local development

```bash
npm install
npm run dev        # http://localhost:4321/tnt-website/
npm run build      # static build into dist/
npm run preview    # serve the built site
npm test           # run the stats unit tests
npm run ladder     # print derived ladders + pairings for every season (sanity check)
```

Requires Node 20+.

---

## Where to drop your files

| What | Where | Notes |
|------|-------|-------|
| **Match data** | `data/alltimestats.csv` | The one source of truth. Schema below. |
| **Logo / crest** | `public/logo/` | `crest.svg` (or `.png`), `favicon.png`, `og.png`. See `public/logo/README.md`. A placeholder crest ships in the repo — replace it. |
| **Player bios** | `content/bios/<slug>.md` | ~150 words of markdown. See `content/bios/README.md`. |
| **Player photos** | `content/photos/<slug>/` | 3–4 images per player. Falls back to an initials avatar. |
| **Season recaps** | `content/seasons/season-<N>.md` | Optional prose per season. |

A player's **slug** is their canonical name lowercased with spaces as hyphens,
e.g. `Luke Sharrock` → `luke-sharrock`. Photos and the CSV are copied into the
built site automatically (`scripts/copy-assets.mjs`); you never touch `public/`
except for the logo files.

---

## The CSV schema

Columns (a stray unnamed 19th column is ignored):

```
Team, Opponent, Season, Round, Player,
Aces, Unforced Errors, Forced Errors, 1st Serve In, 1st Serve Out,
Double Faults, Winners, Errors Forced, win?, Team Score, Opponent Score,
votes
```

One row = one player's stat line in one match. `win?` is `TRUE`/`FALSE`.

**Best on Ground (BOG) is not a column** — it's derived: the player(s) with the
most votes in a match. Ties share it; a match with no recorded votes has no BOG.
Just record votes and BOG follows automatically.

### Data quirks — all handled in one place (`src/lib/normalize.ts`)

- **Name variants** are merged via `src/config/aliases.ts` (e.g. `Lachie Jenkin`
  → `Lachlan Jenkin`). Add a line there for any new spelling.
- **`(Fill-in)` suffix** is stripped and merged onto the base player; the row
  keeps an `isFillIn` flag (shown as a badge, excluded from leaderboards by
  default).
- **`SINGLES GAME`** rows are excluded from player stats but still count for the
  ladder.
- **Serve stats** (`1st Serve In/Out`) were only tracked in Season 1 — never
  shown elsewhere; labelled "S1 only".
- **`Errors Forced`** only exists from Season 2; per-game figures use the correct
  denominator.
- **Votes** may be blank (a sealed season, or simply unrecorded) — treated as
  missing, never zero. Averages only cover games that actually have votes.

### Votes systems

- **Season 1:** 2 (best) / 1 (second) per match, plus a Player-of-the-Round bonus.
- **Season 2 onward:** two voters each award 3-2-1 per match → max **6 per game**.

---

## Configuration

### `src/config/site.ts`
- `currentSeason` — which season the home page / ladder shows.
- `sealedVoteSeasons` — seasons whose votes are hidden until awards night. Remove
  a season from this list once you commit its real votes.
- `seasonYears` — season number → calendar year label.
- `perGameMinGames` — minimum games to qualify on per-game leaderboards.
- Team colours live in the `TEAMS` map.

### `src/config/seasons/season-<N>.ts`
Everything the CSV can't tell us about a season:
- **`honours`** — Champions, Runners-up, Season MVP, Finals MVP.
- **`teams`** — each team's captain and pairing display order (captain first).
  If omitted, the pairing is derived from the CSV.
- **`finals`** — the finals bracket structure and results (see below).

---

## Adding a new season (Season 5 and beyond) — zero code changes

1. Append the season's rows to `data/alltimestats.csv`.
2. Create `src/config/seasons/season-5.ts` (copy an existing one). It's picked up
   automatically.
3. (Optional) Add `content/seasons/season-5.md` for a recap.
4. Add `5` to `seasonYears` in `site.ts`, and to `sealedVoteSeasons` while its
   votes are sealed. Update `currentSeason`.
5. Commit and push.

## Finals brackets

The bracket is data-driven. Seeds reference the final ladder position; later
matches reference earlier ones by id. Add a `result` to each match as scores
come in:

```ts
{ id: 'F', home: { winnerOf: 'SF1' }, away: { winnerOf: 'SF2' },
  result: { winner: 'home', homeScore: ['6', '6'], awayScore: ['4', '3'] } }
```

Season 4's structure is scaffolded (top 8 seeds, `1v8 … 4v5`); Seasons 1–3 have
empty `finals: []` arrays ready for you to fill. Honours and finals scores marked
`TODO` are the ones I didn't have data for.

---

## Deployment

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. To
enable it once:

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`.

The workflow sets the base path to `/<repo-name>` automatically. **Custom
domain?** Add a `CNAME` and set `SITE_BASE` to `/` (in the workflow env or
`astro.config.mjs`).

---

## Project structure

```
data/alltimestats.csv          source of truth
src/config/                     site + season config, name aliases
src/lib/normalize.ts           the single normalization layer
src/lib/stats.ts               ladder, aggregates, leaderboards, records
src/lib/stats.test.ts          unit tests (name merge, ladder, votes eras, ...)
src/components/  src/pages/     UI
content/                        bios, photos, recaps (you edit these)
public/logo/                    crest + favicon (you drop these in)
scripts/copy-assets.mjs         copies CSV + photos into the build
```
