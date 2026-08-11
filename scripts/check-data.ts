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
import { CSV_PATH, loadStatRows, parseStart } from '../src/lib/normalize.ts';
import { readCsvFile } from '../src/lib/csv.ts';
import {
  allPlayers,
  allSeasons,
  seasonMatches,
  seasonRounds,
  COUNTING_STATS,
} from '../src/lib/stats.ts';
import { NAME_ALIASES } from '../src/config/aliases.ts';
import { declaredTeams, getSeasonConfig } from '../src/config/seasons/node.ts';
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

// 2c. Start times. `normalize.ts` degrades anything malformed to null rather
//     than guessing, which is the safe behaviour for a build but means a typo
//     would otherwise vanish silently — a fixture with no time just doesn't
//     print one. This is where it gets caught. Start is optional throughout: no
//     season before S5 has one, and a blank is "not recorded", never an error.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

for (const raw of rawRows) {
  const start = (raw['Start'] ?? '').trim();
  const player = (raw['Player'] ?? '').trim();
  if (!start || !player) continue;
  if (parseStart(start) === null) {
    errors.push(
      `Unreadable Start "${start}" (expected YYYY-MM-DDTHH:MM): ` +
        `${player} S${raw['Season']} R${raw['Round']}`
    );
    continue;
  }
  // A spreadsheet that has decided the cell is a date will happily hand back
  // 2026-13-01. The regex can't see that; Date can.
  const d = new Date(start + ':00Z');
  if (Number.isNaN(d.getTime()) || !start.startsWith(d.toISOString().slice(0, 16))) {
    errors.push(`Start "${start}" is not a real date/time: ${player} S${raw['Season']}`);
  }
}

// The league is called Tuesday Night Tennis. A fixture on another night is
// legal — matches get moved — but it's worth a look.
for (const m of seasonMatches(rows)) {
  if (!m.start) continue;
  const day = new Date(m.start + ':00Z').getUTCDay();
  if (day !== 2) {
    warnings.push(
      `Fixture is not on a Tuesday (${DAYS[day]}): ` +
        `S${m.season} R${m.roundLabel} ${m.sides.map((s) => s.team).join(' v ')} — ${m.start}`
    );
  }
}

// All four rows of a match carry the same Start, the way they carry the same
// Score. Disagreement means half a match got edited.
const startsByMatch = new Map<string, Set<string>>();
for (const r of rows) {
  if (!r.start) continue;
  const k = `S${r.season} R${r.roundLabel} ${[r.team, r.opponent].sort().join(' v ')}`;
  (startsByMatch.get(k) ?? startsByMatch.set(k, new Set()).get(k)!).add(r.start);
}
for (const [k, set] of startsByMatch) {
  if (set.size > 1) {
    errors.push(`Match rows disagree on Start (${[...set].join(' vs ')}): ${k}`);
  }
}

for (const r of rows) {
  // A fixture has no scoreline yet, by definition. The fixture section below
  // is what checks those.
  if (r.scheduled) continue;
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
  if (r.scheduled || r.isFinals || r.isSingles || r.isFillIn) continue;
  const k = `${r.season}|${r.player}`;
  (homeTeams.get(k) ?? homeTeams.set(k, new Set()).get(k)!).add(r.team);
}
for (const r of rows) {
  if (r.scheduled || !r.isFinals || r.isSingles || r.isFillIn) continue;
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
  if (r.scheduled || !r.isFinals || r.isSingles) continue;
  const key = `S${r.season} ${r.roundLabel} ${[r.team, r.opponent].sort().join(' v ')}`;
  (finalsTies.get(key) ?? finalsTies.set(key, new Set()).get(key)!).add(r.team);
}
for (const [tie, teams] of finalsTies) {
  if (teams.size !== 2) warnings.push(`Finals tie has only one side entered: ${tie}`);
}

// 2d. Fixtures — matches that have been drawn but not played.
//
//     A fixture is four rows sharing Team/Opponent/Season/Round with the two
//     players a side and every RESULT column blank; the blank `win?` is what
//     makes it a fixture rather than a result (see StatRow.scheduled). What can
//     go wrong is a half-filled row, a name that isn't on that team, or a team
//     drawn to play twice in one night.
//
//     Round sizes are NOT checked. TNT rounds vary — with an odd number of
//     teams somebody always sits out, and S5 is expected to run five rounds of
//     five matches and four of four. Byes are reported below, not judged.
//
//     `Start` is on this list because it describes the fixture, not the result:
//     knowing when a match will be played is the whole point of drawing one.
//     It's the only column here that's filled in *before* the night and left
//     alone afterwards.
const FIXTURE_COLUMNS = new Set([
  'Team',
  'Opponent',
  'Season',
  'Round',
  'Start',
  'Player',
  '', // the trailing empty column
]);

const scheduled = rows.filter((r) => r.scheduled);

for (const raw of rawRows) {
  if ((raw['win?'] ?? '').trim() !== '') continue;
  const player = (raw['Player'] ?? '').trim();
  if (!player || !(raw['Season'] ?? '').trim()) continue;
  const dirty = Object.entries(raw)
    .filter(([k, v]) => !FIXTURE_COLUMNS.has(k) && (v ?? '').trim() !== '')
    .map(([k]) => k);
  if (dirty.length) {
    warnings.push(
      `Fixture row (blank win?) also has ${dirty.join(', ')} filled in — ` +
        `it will read as unplayed until win? is set: ${player} S${raw['Season']} R${raw['Round']}`
    );
  }
}

for (const season of allSeasons(rows)) {
  const field = await declaredTeams(season);
  const cfg = await getSeasonConfig(season);
  const rounds = seasonRounds(rows, season, field);

  for (const round of rounds) {
    const drawn = round.matches.filter((m) => m.scheduled);
    if (!drawn.length) continue;

    if (round.played) {
      warnings.push(
        `S${season} ${round.roundLabel} is half entered — ` +
          `${round.matches.length - drawn.length} played, ${drawn.length} still fixtures`
      );
    }

    // A round is one night. Two dates in it is usually a typo, occasionally a
    // washed-out match moved to another week — so a warning, not an error.
    const nights = [...new Set(round.matches.map((m) => m.start?.slice(0, 10)).filter((d) => d))];
    if (nights.length > 1) {
      warnings.push(
        `S${season} ${round.roundLabel} spans ${nights.length} dates ` +
          `(${nights.sort().join(', ')}) — rescheduled, or a typo?`
      );
    }

    const seen = new Map<string, number>();
    for (const m of drawn) {
      for (const side of m.sides) {
        seen.set(side.team, (seen.get(side.team) ?? 0) + 1);
        if (side.players.length !== 2) {
          warnings.push(
            `Fixture side has ${side.players.length} players (expected 2): ` +
              `S${season} ${round.roundLabel} ${side.team} v ${
                m.sides.find((s) => s !== side)!.team
              }`
          );
        }
        // The line-up should be the team's own players. A guest is fine, but
        // it has to say so — an unflagged one silently counts as a regular.
        const pair = cfg?.teams?.[side.team]?.pair;
        if (!pair) continue;
        for (const p of side.players) {
          if (!p.isFillIn && !pair.includes(p.player)) {
            warnings.push(
              `Fixture names ${p.player} for ${side.team}, who isn't in that ` +
                `team's S${season} pairing (${pair.join(' & ')}) and isn't ` +
                `marked (Fill-in): S${season} ${round.roundLabel}`
            );
          }
        }
      }
    }
    for (const [team, n] of seen) {
      if (n > 1) {
        errors.push(
          `${team} is drawn to play ${n} matches in S${season} ${round.roundLabel}`
        );
      }
    }
  }
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

// 4b. Fixtures. Round sizes are meant to vary — this is a report, not a test.
if (scheduled.length) {
  console.log('\nFixtures\n' + '-'.repeat(40));
  const seasonsWithFixtures = [...new Set(scheduled.map((r) => r.season))].sort();
  for (const season of seasonsWithFixtures) {
    const field = await declaredTeams(season);
    const rounds = seasonRounds(rows, season, field).filter((r) =>
      r.matches.some((m) => m.scheduled)
    );
    console.log(`  S${season}: field of ${field.length || '?'} teams`);
    for (const r of rounds) {
      const drawn = r.matches.filter((m) => m.scheduled).length;
      console.log(
        `    R${r.roundLabel}: ${drawn} match${drawn === 1 ? '' : 'es'}` +
          (r.byes.length ? `, bye: ${r.byes.join(', ')}` : '')
      );
    }
    // Turnout across the season so far, so an accidentally lopsided draw is
    // visible without being called an error — an uneven one is on purpose.
    const tally = new Map<string, { drawn: number; played: number }>();
    for (const team of field) tally.set(team, { drawn: 0, played: 0 });
    for (const m of seasonRounds(rows, season, field).flatMap((r) => r.matches)) {
      for (const side of m.sides) {
        const e = tally.get(side.team) ?? { drawn: 0, played: 0 };
        if (m.scheduled) e.drawn += 1;
        else e.played += 1;
        tally.set(side.team, e);
      }
    }
    const line = [...tally.entries()]
      .map(([team, e]) => `${team} ${e.played}+${e.drawn}`)
      .join(' · ');
    console.log(`    matches played+drawn: ${line}`);
  }
}

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
