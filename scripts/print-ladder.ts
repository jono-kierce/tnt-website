/**
 * Dev sanity check: prints the derived ladder + pairings for every season, plus
 * a couple of leaderboards. Run with `npm run ladder`.
 */
import { loadStatRows } from '../src/lib/normalize.ts';
import { allSeasons, ladderWithPairings, leaderboard } from '../src/lib/stats.ts';
import { seasonLabel, isVotesSealed } from '../src/config/site.ts';
import {
  declaredTeams,
  seasonTeamConfigs,
  withdrawnTeams,
} from '../src/config/seasons/node.ts';

const rows = loadStatRows();

for (const season of allSeasons(rows)) {
  // The same composition the site and the ladder graphic use, so this prints
  // what they print — config pairings, the declared field, a withdrawn team
  // off the table and its matches struck from everyone else's.
  const table = ladderWithPairings(
    season,
    rows,
    await seasonTeamConfigs(season),
    await declaredTeams(season),
    await withdrawnTeams(season)
  );
  const gone = await withdrawnTeams(season);

  console.log(`\n${'='.repeat(60)}\n${seasonLabel(season)}${isVotesSealed(season) ? '  [votes sealed]' : ''}\n${'='.repeat(60)}`);
  console.log('Rk  Team          Pairing                        P  W   Ratio');
  for (const row of table) {
    console.log(
      `${String(row.rank).padStart(2)}  ${row.team.padEnd(12)}  ${row.pairingName.padEnd(28)}  ${String(row.matchesPlayed).padStart(1)}  ${String(row.wins).padStart(1)}   ${row.ratio.toFixed(2)}`
    );
  }
  if (gone.length) console.log(`    withdrawn, matches struck: ${gone.join(', ')}`);
}

console.log(`\n${'='.repeat(60)}\nTop winners/set (all-time incl. finals, min games), fill-ins excluded\n${'='.repeat(60)}`);
for (const e of leaderboard('winners', rows, { perSet: true }).slice(0, 8)) {
  // Denominators are the games/sets that actually recorded winners, which is
  // why a finals appearance with no stats yet doesn't move the rate.
  const t = e.agg.tally.winners;
  const gap = t.games < e.games ? ` [${e.games - t.games} games w/o stats]` : '';
  console.log(
    `${e.player.padEnd(20)} ${e.value.toFixed(2)}/set  (${t.games} games, ${t.sets} sets)${gap}`
  );
}
