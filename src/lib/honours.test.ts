import { describe, expect, it } from 'vitest';
import { loadStatRows } from './normalize.ts';
import { allPlayers, mvpTally, playedRows, strikeWithdrawnVotes } from './stats.ts';
import { homeAndAwayComplete, playerHonours, seasonHonours, type Honour } from './honours.ts';
import { allSeasonConfigs, getSeasonConfig } from '../config/seasons/index.ts';
import { withdrawnTeams } from '../config/seasons/schema.ts';
import { isVotesSealed } from '../config/site.ts';
import type { StatRow } from './types.ts';

const rows = strikeWithdrawnVotes(loadStatRows(), (s) => withdrawnTeams(getSeasonConfig(s)));

function honoursOf(season: number, over: { sealed?: boolean; rows?: StatRow[] } = {}): Honour[] {
  const config = getSeasonConfig(season);
  return seasonHonours(season, {
    rows: over.rows ?? rows,
    config,
    declaredTeams: Object.keys(config?.teams ?? {}),
    withdrawnTeams: withdrawnTeams(config),
    sealed: over.sealed ?? isVotesSealed(season),
  });
}

const who = (hs: Honour[], kind: Honour['kind']) =>
  hs.filter((h) => h.kind === kind).map((h) => h.player).sort();
const teamOf = (hs: Honour[], kind: Honour['kind']) =>
  [...new Set(hs.filter((h) => h.kind === kind).map((h) => h.team))];

const everything = [1, 2, 3, 4, 5].flatMap((s) => honoursOf(s));

describe('trophy cabinet honours', () => {
  it('derives the same champions and runners-up the season configs record', () => {
    for (const cfg of allSeasonConfigs()) {
      const champ = cfg.honours.find((h) => /champion/i.test(h.title));
      const ru = cfg.honours.find((h) => /runners-up/i.test(h.title));
      if (!champ || !ru) continue;
      const hs = honoursOf(cfg.season);
      expect(teamOf(hs, 'premiers'), `S${cfg.season} premiers`).toEqual([champ.team]);
      expect(teamOf(hs, 'runnersUp'), `S${cfg.season} runners-up`).toEqual([ru.team]);
    }
  });

  it('names only real players in a config honour', () => {
    const players = new Set(allPlayers(playedRows(rows)));
    for (const cfg of allSeasonConfigs()) {
      for (const name of cfg.honours.flatMap((h) => h.players ?? [])) {
        expect(players.has(name), `S${cfg.season}: ${name}`).toBe(true);
      }
    }
  });

  it('holds the configured Season MVP to the tally, except S1', () => {
    for (const season of [2, 3, 4]) {
      const tally = mvpTally(season, rows);
      const leaders = tally.filter((t) => t.votes === tally[0].votes).map((t) => t.player).sort();
      expect(who(honoursOf(season), 'seasonMvp'), `S${season}`).toEqual(leaders);
    }
    // S1's award counted Player-of-the-Round; the tally alone reads Kierce
    // 11, Littlejohn 10, Sharrock 9. The award stands, and no podium is built
    // under a winner the tally didn't pick.
    const s1 = honoursOf(1);
    expect(who(s1, 'seasonMvp')).toEqual(['Archie Littlejohn', 'Jonathan Kierce', 'Luke Sharrock']);
    expect(who(s1, 'mvpPodium')).toEqual([]);
  });

  it('holds the S3 Finals MVP to the 4-3-2-1 finals tally', () => {
    const tally = new Map<string, number>();
    for (const r of playedRows(rows)) {
      if (r.season === 3 && r.isFinals && r.votes !== null) {
        tally.set(r.player, (tally.get(r.player) ?? 0) + r.votes);
      }
    }
    const [leader] = [...tally].sort((a, b) => b[1] - a[1]);
    expect(who(honoursOf(3), 'finalsMvp')).toEqual([leader[0]]);
  });

  it('ranks the podium competition-style: S4 has two seconds and no third', () => {
    const podium = honoursOf(4).filter((h) => h.kind === 'mvpPodium');
    expect(podium.map((h) => [h.player, h.place]).sort()).toEqual([
      ['Jimmy Gorton', 2],
      ['Luke Sharrock', 2],
    ]);
  });

  it('awards nothing vote-derived for a sealed season', () => {
    for (const season of [4, 5]) {
      const hs = honoursOf(season, { sealed: true });
      expect(hs.filter((h) => ['seasonMvp', 'mvpPodium', 'finalsMvp'].includes(h.kind))).toEqual([]);
    }
  });

  it('awards no ladder honour or stat title until the home-and-away is over', () => {
    // S5 is live — rounds still drawn, not played.
    expect(homeAndAwayComplete(5, rows)).toBe(false);
    const hs = honoursOf(5, { sealed: false });
    expect(hs.filter((h) => ['minorPremiers', 'woodenSpoon', 'statTitle'].includes(h.kind))).toEqual([]);
    for (const season of [1, 2, 3, 4]) expect(homeAndAwayComplete(season, rows)).toBe(true);
  });

  it('never gives a withdrawn team the minor premiership or the spoon', () => {
    // Pretend S5's draw is all played so the ladder honours are awarded.
    const finished = rows.map((r) => (r.season === 5 && r.scheduled ? { ...r, scheduled: false } : r));
    const hs = honoursOf(5, { rows: finished, sealed: false });
    expect(teamOf(hs, 'minorPremiers')).not.toContain('Black');
    expect(teamOf(hs, 'woodenSpoon')).not.toContain('Black');
  });

  it('gives a minor premiership to the pairing, not a one-night sub', () => {
    // Littlejohn played one S3 night for White without a fill-in flag.
    expect(who(honoursOf(3), 'minorPremiers')).toEqual(['Damon Maurice', 'Jonathan Kierce']);
  });

  it("builds Kierce's cabinet in prestige order", () => {
    const cab = playerHonours('Jonathan Kierce', everything).map((h) => `${h.kind} S${h.season}`);
    expect(cab).toEqual([
      'premiers S1', 'premiers S3',
      'minorPremiers S1', 'minorPremiers S3',
      'runnersUp S4',
      'seasonMvp S1', 'seasonMvp S3',
      'finalsMvp S3', 'finalsMvp S4',
      'statTitle S1', 'statTitle S2', 'statTitle S3', 'statTitle S3', 'statTitle S4',
    ]);
  });

  it('awards stat leaders on home-and-away season totals, own team only', () => {
    const winners = (season: number) =>
      honoursOf(season).filter((h) => h.kind === 'statTitle' && h.stat === 'winners');
    // Kierce 43, 48, 45 across S2–S4 — full attendance wins a season award,
    // where a per-set rate would hand it to whoever missed a night or two.
    for (const season of [2, 3, 4]) {
      expect(winners(season).map((h) => h.player), `S${season}`).toEqual(['Jonathan Kierce']);
    }
    // No finals and no fill-ins in the count: the winning total is exactly the
    // sum of his own home-and-away rows.
    const own = playedRows(rows)
      .filter((r) => r.season === 3 && r.player === 'Jonathan Kierce' && !r.isFinals && !r.isFillIn)
      .reduce((n, r) => n + (r.winners ?? 0), 0);
    expect(winners(3)[0].value).toBe(own);
    // S1 counted errors forced only in its finals, so it has no EF leader.
    expect(honoursOf(1).filter((h) => h.stat === 'errorsForced')).toEqual([]);
  });
});
