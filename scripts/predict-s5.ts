import { loadStatRows } from '../src/lib/normalize.ts';
import { seasonRounds, playerAgg } from '../src/lib/stats.ts';
import { fitModel, predictPair } from '../src/lib/predict.ts';

const rows = loadStatRows();
const model = fitModel(rows);

// S5 pairings, captain-first (from season-5.ts)
const teams: Record<string, string[]> = {
  Navy: ['Will Mumme', 'Ed Simpson'],
  Black: ['Archie Littlejohn', 'Angus Hume'],
  'Light Blue': ['Shayl Inlander', 'Ethan Seamer'],
  Green: ['Quinn Feikema', 'Lewis Mossman'],
  Orange: ['Jimmy Gorton', 'Lachy Godden'],
  Pink: ['Charlie Simpson', 'Damon Maurice'],
  Red: ['Lachlan Jenkin', 'Jamie Harris'],
  Brown: ['Adam Dickson', 'Ted Angel'],
  White: ['Jonathan Kierce', 'Jackson Virgona'],
  Yellow: ['Luke Sharrock', 'Jack Raines'],
};

// Team skill = mean of pair skills
const skill = (n: string) => model.skills.get(n) ?? 0;
const teamSkill: Record<string, number> = {};
for (const [t, pr] of Object.entries(teams)) {
  teamSkill[t] = (skill(pr[0]) + skill(pr[1])) / 2;
}

// Expected wins across the S5 draw
const rounds = seasonRounds(rows, 5, Object.keys(teams));
const expWins: Record<string, number> = {};
const played: Record<string, number> = {};
for (const t of Object.keys(teams)) { expWins[t] = 0; played[t] = 0; }
for (const r of rounds) {
  if (r.stage) continue; // regular only
  for (const m of r.matches) {
    const [a, b] = m.sides.map((s) => s.team);
    const p = predictPair(teams[a], teams[b], model); // prob a beats b
    expWins[a] += p; expWins[b] += 1 - p;
    played[a]++; played[b]++;
  }
}

console.log('\n=== S5 projected ladder (expected wins over the draw) ===');
const ladder = Object.keys(teams).sort((x, y) => expWins[y] - expWins[x]);
ladder.forEach((t, i) => {
  console.log(
    `${String(i + 1).padStart(2)}  ${t.padEnd(11)} pair=${teams[t].join(' & ').padEnd(34)} ` +
    `xWins=${expWins[t].toFixed(2)}/${played[t]}  teamSkill=${teamSkill[t].toFixed(3)}`
  );
});

console.log('\n=== Player skills (S5 participants) ===');
const players = [...new Set(Object.values(teams).flat())];
players
  .map((p) => ({ p, s: skill(p), n: model.appearances.get(p) ?? 0 }))
  .sort((a, b) => b.s - a.s)
  .forEach((x, i) =>
    console.log(`${String(i + 1).padStart(2)}  ${x.p.padEnd(20)} skill=${x.s.toFixed(3)}  (${x.n} matches)`)
  );

// Career net-contribution per set (proxy for MVP form) — all-time incl finals
console.log('\n=== Career winners+aces+EF-UE-DF per set (MVP proxy) ===');
players
  .map((p) => {
    const agg = playerAgg(p, rows, { scope: 'all', perSet: true, includeFillIns: true });
    // net per-set from tallies
    const perSet = (stat: string) => {
      const t: any = (agg.tally as any)[stat];
      return t && t.sets ? t.total / t.sets : 0;
    };
    const net = perSet('winners') + perSet('aces') + perSet('errorsForced') - perSet('unforcedErrors') - perSet('doubleFaults');
    return { p, net, g: agg.games };
  })
  .sort((a, b) => b.net - a.net)
  .slice(0, 12)
  .forEach((x, i) => console.log(`${String(i + 1).padStart(2)}  ${x.p.padEnd(20)} net/set=${x.net.toFixed(2)}  (${x.g} matches)`));
