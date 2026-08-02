/**
 * Dev sanity check: prints the derived ladder + pairings for every season, plus
 * a couple of leaderboards. Run with `npm run ladder`.
 */
import { loadStatRows } from '../src/lib/normalize.ts';
import { allSeasons, ladder, teamRoster, leaderboard } from '../src/lib/stats.ts';
import { seasonLabel, isVotesSealed } from '../src/config/site.ts';

const rows = loadStatRows();

for (const season of allSeasons(rows)) {
  const teams = [...new Set(rows.filter((r) => r.season === season).map((r) => r.team))];
  const pairings: Record<string, string> = {};
  for (const t of teams) pairings[t] = teamRoster(t, season, rows).pairingName;

  console.log(`\n${'='.repeat(60)}\n${seasonLabel(season)}${isVotesSealed(season) ? '  [votes sealed]' : ''}\n${'='.repeat(60)}`);
  console.log('Rk  Team          Pairing                        P  W   Ratio');
  for (const row of ladder(season, rows, pairings)) {
    console.log(
      `${String(row.rank).padStart(2)}  ${row.team.padEnd(12)}  ${row.pairingName.padEnd(28)}  ${String(row.matchesPlayed).padStart(1)}  ${String(row.wins).padStart(1)}   ${row.ratio.toFixed(2)}`
    );
  }
}

console.log(`\n${'='.repeat(60)}\nTop winners/game (all-time, min games), fill-ins excluded\n${'='.repeat(60)}`);
for (const e of leaderboard('winners', rows, { perGame: true }).slice(0, 8)) {
  console.log(`${e.player.padEnd(20)} ${e.value.toFixed(2)}/g  (${e.games} games)`);
}
