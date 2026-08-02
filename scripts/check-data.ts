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
import { loadStatRows } from '../src/lib/normalize.ts';
import { allPlayers, allSeasons } from '../src/lib/stats.ts';
import { NAME_ALIASES } from '../src/config/aliases.ts';
import { SITE, isVotesSealed } from '../src/config/site.ts';

const rows = loadStatRows();
const errors: string[] = [];
const warnings: string[] = [];

// 1. Votes within the legal per-match maximum for the S2+ era (two voters × 3-2-1).
for (const r of rows) {
  if (r.votes === null) continue;
  if (r.votes < 0) errors.push(`Negative votes: ${r.player} S${r.season} R${r.round} = ${r.votes}`);
  if (r.season >= SITE.errorsForcedFromSeason && r.votes > 6) {
    errors.push(`Votes > 6 (S2+ max): ${r.player} S${r.season} R${r.round} = ${r.votes}`);
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
