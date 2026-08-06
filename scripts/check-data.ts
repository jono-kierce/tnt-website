/**
 * Data sanity checker for data/alltimestats.csv. Run before committing new rows:
 *   npm run check-data
 *
 * Reports coverage and flags likely mistakes (out-of-range votes, duplicate
 * player-rounds, missing bios). Exits non-zero on hard errors so it can gate CI
 * if you ever want it to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CSV_PATH, loadStatRows } from '../src/lib/normalize.ts';
import { readCsvFile } from '../src/lib/csv.ts';
import { allPlayers, allSeasons, COUNTING_STATS } from '../src/lib/stats.ts';
import { NAME_ALIASES } from '../src/config/aliases.ts';
import { SITE, isVotesSealed } from '../src/config/site.ts';
import { allPhotos, missingPhotoFiles, unlistedPhotos, photoFilesOnDisk } from '../src/lib/photos.ts';

const rows = loadStatRows();
const errors: string[] = [];
const warnings: string[] = [];

const where = (r: { player: string; season: number; roundLabel: string }) =>
  `${r.player} S${r.season} ${r.roundLabel}`;

// 1. Votes within the legal per-match maximum for the S2+ era (two voters × 3-2-1).
for (const r of rows) {
  if (r.votes === null) continue;
  if (r.votes < 0) errors.push(`Negative votes: ${where(r)} = ${r.votes}`);
  if (r.season >= SITE.errorsForcedFromSeason && r.votes > 6) {
    errors.push(`Votes > 6 (S2+ max): ${where(r)} = ${r.votes}`);
  }
}

// 2. A player with TWO+ non-fill-in rows in one round is ambiguous (a real game
//    plus a fill-in is normal in TNT and not flagged).
const byPR = new Map<string, { total: number; nonFill: number }>();
for (const r of rows) {
  if (r.isSingles) continue;
  const k = `${r.season}|${r.round}|${r.player}`;
  const e = byPR.get(k) ?? { total: 0, nonFill: 0 };
  e.total += 1;
  if (!r.isFillIn) e.nonFill += 1;
  byPR.set(k, e);
}
for (const [k, e] of byPR) {
  if (e.nonFill > 1) warnings.push(`Player has ${e.nonFill} non-fill-in rows in one round (ambiguous): ${k}`);
}

// 2b. Finals rows. The scoreline is the source of truth for how many sets were
//     played, so an unreadable one silently becomes a one-set match — which
//     would quietly inflate that player's per-set rates. Catch it here.
const STAGES = new Set(['QF', 'SF', 'F']);
const rawRows = readCsvFile(CSV_PATH);

for (const raw of rawRows) {
  const round = (raw['Round'] ?? '').trim();
  const player = (raw['Player'] ?? '').trim();
  // Rows with no player are templates awaiting data — counted, not checked.
  if (!player || !round) continue;
  if (!/^\d+$/.test(round) && !STAGES.has(round.toUpperCase())) {
    errors.push(
      `Unknown Round "${round}" (expected a number or ${[...STAGES].join('/')}): ` +
        `${player} S${raw['Season']}`
    );
  }
}

for (const r of rows) {
  if (!r.score) {
    if (r.isFinals) errors.push(`Finals row has no Score: ${where(r)}`);
    continue;
  }
  if (!r.setScores.length) {
    errors.push(`Unreadable Score "${r.score}": ${where(r)}`);
    continue;
  }
  const games = r.setScores.reduce(
    (acc, s) => ({ f: acc.f + s.for, a: acc.a + s.against }),
    { f: 0, a: 0 }
  );
  if (games.f !== r.teamScore || games.a !== r.opponentScore) {
    errors.push(
      `Score "${r.score}" sums to ${games.f}-${games.a} but the game columns ` +
        `say ${r.teamScore}-${r.opponentScore}: ${where(r)}`
    );
  }
  // A set recorded level (6-6, 5-5) was decided on a breaker the sheet didn't
  // record. That's incomplete, not wrong: `win?` still settles the match, and
  // the set still counts toward per-set rates. Warn so it can be finished
  // later, and only call the win flag an error when the sets actually
  // contradict it.
  const undecided = r.setScores.filter((s) => s.for === s.against).length;
  if (r.isFinals && undecided) {
    warnings.push(
      `${undecided} set${undecided > 1 ? 's' : ''} recorded level in "${r.score}" ` +
        `— tiebreak result not captured: ${where(r)}`
    );
  }
  if (r.isFinals && !undecided && r.win !== r.setsWon > r.setsLost) {
    errors.push(
      `win? says ${r.win} but the scoreline "${r.score}" says otherwise: ${where(r)}`
    );
  }
}

// 2b(ii). A finals row for someone who never played a home-and-away game for
//    that team is a fill-in — easy to miss, because a finals sheet usually just
//    lists who turned up. Unflagged, the cameo counts toward their leaderboard
//    rates and win streaks as if it were their own team.
const homeTeams = new Map<string, Set<string>>();
for (const r of rows) {
  if (r.isFinals || r.isSingles || r.isFillIn) continue;
  const k = `${r.season}|${r.player}`;
  (homeTeams.get(k) ?? homeTeams.set(k, new Set()).get(k)!).add(r.team);
}
for (const r of rows) {
  if (!r.isFinals || r.isSingles || r.isFillIn) continue;
  const own = homeTeams.get(`${r.season}|${r.player}`);
  if (!own) {
    warnings.push(
      `Finals row not marked (Fill-in) and ${r.player} played no S${r.season} ` +
        `home-and-away games at all: ${where(r)}`
    );
  } else if (!own.has(r.team)) {
    warnings.push(
      `Finals row not marked (Fill-in) but ${r.player} played the S${r.season} ` +
        `season for ${[...own].join('/')}, not ${r.team}: ${where(r)}`
    );
  }
}

// 2c. Each finals tie needs both sides present, or the head-to-head is one-eyed.
const finalsTies = new Map<string, Set<string>>();
for (const r of rows) {
  if (!r.isFinals || r.isSingles) continue;
  const key = `S${r.season} ${r.roundLabel} ${[r.team, r.opponent].sort().join(' v ')}`;
  (finalsTies.get(key) ?? finalsTies.set(key, new Set()).get(key)!).add(r.team);
}
for (const [tie, teams] of finalsTies) {
  if (teams.size !== 2) warnings.push(`Finals tie has only one side entered: ${tie}`);
}

// 3. Bios present?
const bioDir = path.join(process.cwd(), 'content/bios');
const players = allPlayers(rows);
const missingBios = players.filter((p) => {
  const slug = rows.find((r) => r.player === p)!.slug;
  const file = path.join(bioDir, `${slug}.md`);
  if (!fs.existsSync(file)) return true;
  const txt = fs.readFileSync(file, 'utf8').trim();
  return !txt || /^no bio written yet/i.test(txt);
});

// 4. Coverage summary.
console.log('TNT data check\n' + '='.repeat(40));
console.log(`rows: ${rows.length}  players: ${players.length}  seasons: ${allSeasons(rows).join(', ')}`);
console.log(`aliases: ${Object.keys(NAME_ALIASES).length} (${Object.entries(NAME_ALIASES).map(([a, b]) => `${a}→${b}`).join(', ')})`);
console.log(`sealed vote seasons: ${SITE.sealedVoteSeasons.length ? SITE.sealedVoteSeasons.join(', ') : 'none'}`);
for (const s of allSeasons(rows)) {
  const sr = rows.filter((r) => r.season === s && !r.isSingles);
  const votes = sr.filter((r) => r.votes !== null).length;
  const bog = sr.filter((r) => r.bog).length;
  console.log(`  S${s}: ${sr.length} player-rows, ${votes} with votes${isVotesSealed(s) ? ' (SEALED)' : ''}, ${bog} BOG (derived)`);
}
console.log(`bios: ${players.length - missingBios.length}/${players.length} written` + (missingBios.length ? ` — missing: ${missingBios.join(', ')}` : ''));

// 5. Finals coverage. Scorelines make a finals count for win-loss and
//    head-to-head on their own; the stats can arrive later, one post at a time.
console.log('\nFinals\n' + '-'.repeat(40));
const templates = rawRows.filter(
  (r) => !(r['Player'] ?? '').trim() && (r['Round'] ?? '').trim()
);
for (const s of allSeasons(rows)) {
  const fr = rows.filter((r) => r.season === s && r.isFinals && !r.isSingles);
  const waiting = templates.filter((r) => Number(r['Season']) === s).length;
  if (!fr.length) {
    console.log(`  S${s}: no finals rows${waiting ? ` (${waiting} blank template rows waiting)` : ''}`);
    continue;
  }
  const ties = new Map<string, number>();
  for (const r of fr) {
    ties.set(`${r.roundLabel}|${[r.team, r.opponent].sort().join()}`, r.sets);
  }
  const sets = [...ties.values()].reduce((n, v) => n + v, 0);
  const covered = COUNTING_STATS.map((stat) => {
    const n = fr.filter((r) => r[stat] !== null).length;
    return n ? `${stat} ${n}/${fr.length}` : null;
  }).filter(Boolean);
  console.log(
    `  S${s}: ${ties.size} ties, ${fr.length} player-rows, ${sets} sets` +
      `\n       stats: ${covered.length ? covered.join(', ') : 'none recorded yet (scorelines only)'}` +
      (waiting ? `\n       ${waiting} blank template rows waiting` : '')
  );
}

// 6. Photos. The manifest (content/photos/photos.yaml) is the source of truth:
//    a photo on disk that isn't listed is invisible on the site, and a typo'd
//    slug or filename silently drops the photo from every gallery.
const photos = allPhotos();
const validSlugs = new Set(rows.map((r) => r.slug));
const knownSeasons = new Set([...allSeasons(rows), SITE.currentSeason]);
const seenFiles = new Set<string>();

for (const p of photos) {
  const wherePhoto = `photos.yaml → ${p.file}`;
  if (seenFiles.has(p.file)) warnings.push(`Photo listed twice: ${wherePhoto}`);
  seenFiles.add(p.file);
  if (!p.players.length) warnings.push(`Photo has no players tagged: ${wherePhoto}`);
  for (const slug of p.players) {
    if (!validSlugs.has(slug)) {
      errors.push(`Unknown player slug "${slug}" (typo?): ${wherePhoto}`);
    }
  }
  if (p.season !== null && !knownSeasons.has(p.season)) {
    warnings.push(`Photo season ${p.season} has no CSV rows: ${wherePhoto}`);
  }
}
for (const f of missingPhotoFiles()) {
  errors.push(`photos.yaml lists a file that doesn't exist: content/photos/${f}`);
}
for (const f of unlistedPhotos()) {
  warnings.push(`Photo on disk but NOT in photos.yaml (won't show on the site): content/photos/${f}`);
}
// A camera original is ~2-10 MB and gets displayed in a 200px tile. They're
// served unprocessed out of public/, so nothing downsizes them on the way to
// the visitor — `npm run optimize-photos` is what keeps this honest.
const PHOTO_MAX_KB = 1024;
let oversized = 0;
for (const f of photoFilesOnDisk()) {
  const kb = fs.statSync(path.join('content/photos', f)).size / 1024;
  if (kb > PHOTO_MAX_KB) {
    warnings.push(
      `Photo is ${Math.round(kb)}KB (over ${PHOTO_MAX_KB}KB) — run \`npm run optimize-photos\`: content/photos/${f}`
    );
    oversized++;
  }
}
console.log(
  `\nphotos: ${photos.length} in photos.yaml, ${photoFilesOnDisk().length} on disk` +
    (oversized ? `, ${oversized} oversized` : '')
);

if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log('  ⚠ ' + w);
}
if (errors.length) {
  console.log('\nErrors:');
  for (const e of errors) console.log('  ✗ ' + e);
  process.exit(1);
}
console.log('\n✓ no hard errors');
