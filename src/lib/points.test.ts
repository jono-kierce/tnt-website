import { describe, expect, it } from 'vitest';
import { loadStatRows, normalizeRows } from './normalize.ts';
import { seasonMatches } from './stats.ts';
import {
  allMatchPoints,
  longestMatches,
  matchPoints,
  pairSplit,
  playerPoints,
  playerPointsAgg,
  teamPoints,
} from './points.ts';

/** A raw CSV record; stats default to blank so each test says what it records. */
function raw(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Team: '', Opponent: '', Season: '5', Round: '1', Start: '', Score: '', Player: '',
    Aces: '', 'Unforced Errors': '', 'Forced Errors': '', '1st Serve In': '',
    '1st Serve Out': '', 'Double Faults': '', Winners: '', 'Errors Forced': '',
    'win?': '', 'Team Score': '', 'Opponent Score': '', votes: '',
    ...o,
  };
}

/** One player's line: [winners, aces, UE, DF, errorsForced, forcedErrors]; '' for blank. */
type Line = [string, string, string, string, string, string];
function match(a: [Line, Line], b: [Line, Line], opts: { season?: string } = {}) {
  const row = (team: string, opp: string, win: boolean, i: number, l: Line) =>
    raw({
      Team: team, Opponent: opp, Season: opts.season ?? '5', Player: `${team} ${i}`,
      Score: win ? '6-4' : '4-6', 'win?': win ? 'TRUE' : 'FALSE',
      'Team Score': win ? '6' : '4', 'Opponent Score': win ? '4' : '6',
      Winners: l[0], Aces: l[1], 'Unforced Errors': l[2], 'Double Faults': l[3],
      'Errors Forced': l[4], 'Forced Errors': l[5],
    });
  const rows = normalizeRows([
    row('Amber', 'Blue', true, 1, a[0]), row('Amber', 'Blue', true, 2, a[1]),
    row('Blue', 'Amber', false, 1, b[0]), row('Blue', 'Amber', false, 2, b[1]),
  ]);
  return seasonMatches(rows)[0];
}

describe('matchPoints', () => {
  it('counts a real match by hand (S5 R6, White 6-2 Pink)', () => {
    const m = seasonMatches(loadStatRows(), 5).find(
      (x) => x.round === 6 && x.sides.some((s) => s.team === 'White')
    )!;
    const mp = matchPoints(m)!;
    const [pink, white] = mp.sides;
    // White: 7 winners + 0 aces + Pink's 22 UEs + 0 DFs + 3 forced.
    expect(white).toMatchObject({ team: 'White', won: 32, forced: 3 });
    // Pink: 7 winners + 1 ace + White's 8 UEs + 4 DFs + 1 forced.
    expect(pink).toMatchObject({ team: 'Pink', won: 21, forced: 1 });
    expect(mp.total).toBe(53);
    expect(mp.games).toBe(8);
    expect(mp.winnerShare).toBeCloseTo(32 / 53);

    const kierce = playerPoints(mp).find((p) => p.player === 'Jonathan Kierce')!;
    expect(kierce).toMatchObject({ won: 8, lost: 4, involvement: 12 });
    expect(kierce.pairShare).toBeCloseTo(12 / 23);
  });

  it('counts a forced error once, taking the larger ledger when they disagree', () => {
    // Amber forced 5 (its own sheet) but Blue only owned up to 3: count 5.
    // Blue forced 2 by Amber's sheet and 1 by its own: count 2.
    const mp = matchPoints(
      match(
        [['1', '0', '0', '0', '3', '1'], ['0', '0', '0', '0', '2', '1']],
        [['0', '0', '0', '0', '1', '2'], ['0', '0', '0', '0', '0', '1']]
      )
    )!;
    const [amber, blue] = mp.sides;
    expect(amber.ledger).toEqual({ errorsForced: 5, forcedErrors: 3 });
    expect(amber).toMatchObject({ forced: 5, won: 6 });
    expect(blue.ledger).toEqual({ errorsForced: 1, forcedErrors: 2 });
    expect(blue).toMatchObject({ forced: 2, won: 2 });
    expect(mp.total).toBe(8);
  });

  it('falls back to forced errors alone in Season 1, which never kept errors forced', () => {
    const mp = matchPoints(
      match(
        [['2', '1', '3', '1', '', '2'], ['1', '0', '2', '0', '', '1']],
        [['1', '0', '4', '0', '', '3'], ['0', '0', '1', '1', '', '0']],
        { season: '1' }
      )
    )!;
    // Amber forced Blue's 3; Blue forced Amber's 3.
    expect(mp.sides.map((s) => s.forced)).toEqual([3, 3]);
    // Amber: 3 winners + 1 ace + 5 UE + 1 DF + 3 = 13. Blue: 1 + 0 + 5 + 1 + 3 = 10.
    expect(mp.sides.map((s) => s.won)).toEqual([13, 10]);
  });

  it('refuses a match it would undercount, rather than calling it short', () => {
    const full: Line = ['1', '0', '1', '0', '1', '1'];
    // A double fault column left blank for one player (S2 has four such matches).
    expect(matchPoints(match([full, ['1', '0', '1', '', '1', '1']], [full, full]))).toBeNull();
    // Errors forced kept for one partner and not the other.
    expect(matchPoints(match([full, ['1', '0', '1', '0', '', '1']], [full, full]))).toBeNull();
    // A finals scoreline with no stats at all.
    const blank: Line = ['', '', '', '', '', ''];
    expect(matchPoints(match([blank, blank], [blank, blank]))).toBeNull();
  });

  it('refuses fixtures', () => {
    const fixture = seasonMatches(loadStatRows()).find((m) => m.scheduled);
    if (fixture) expect(matchPoints(fixture)).toBeNull();
  });
});

describe('points across the CSV', () => {
  const all = allMatchPoints(loadStatRows());

  it('counts every S5 match and most of the rest', () => {
    expect(all.filter((mp) => mp.match.season === 5).length).toBe(
      seasonMatches(loadStatRows(), 5).filter((m) => !m.scheduled).length
    );
    expect(all.length).toBeGreaterThan(150);
  });

  it('balances: both sides’ points sum to the total, and nobody wins more than all of them', () => {
    for (const mp of all) {
      expect(mp.sides[0].won + mp.sides[1].won).toBe(mp.total);
      expect(mp.total).toBeGreaterThan(0);
      if (mp.winnerShare !== null) expect(mp.winnerShare).toBeLessThanOrEqual(1);
    }
  });

  it('splits each pair’s involvement into shares that sum to one', () => {
    for (const mp of all) {
      const lines = playerPoints(mp);
      for (const team of mp.sides.map((s) => s.team)) {
        const pair = lines.filter((p) => p.team === team);
        expect(pair.reduce((t, p) => t + p.pairShare, 0)).toBeCloseTo(1);
      }
    }
  });

  it('totals each team’s points from the same matches, both ways round', () => {
    const table = teamPoints(loadStatRows(), 5);
    // Every point one team won, another team lost.
    const won = table.reduce((t, r) => t + r.won, 0);
    expect(table.reduce((t, r) => t + r.lost, 0)).toBe(won);
    expect(won).toBe(
      all.filter((mp) => mp.match.season === 5).reduce((t, mp) => t + mp.total, 0)
    );
    expect(table.map((r) => r.share)).toEqual([...table.map((r) => r.share)].sort((a, b) => b - a));
    // White 6-2 Pink in R6 is in there: 32 won, 21 lost.
    expect(table.find((r) => r.team === 'White')!.won).toBeGreaterThanOrEqual(32);
  });

  it('splits a pair over only the matches they played together', () => {
    const rows = loadStatRows();
    const split = pairSplit(rows, 'Charlie Simpson', 'Damon Maurice', { season: 5 })!;
    // Eight Pink matches (two in R7), but Ted Angel filled in for Maurice in R6.
    expect(split.matches).toBe(7);
    expect(split.shares[0] + split.shares[1]).toBeCloseTo(1);
    expect(split.shares[0]).toBeGreaterThan(split.shares[1]);
    // Opposite sides of the net, never partners.
    expect(pairSplit(rows, 'Luke Sharrock', 'Jonathan Kierce', { season: 5 })).toBeNull();
  });

  it('credits a player with every point their side won while they were on court', () => {
    const rows = loadStatRows();
    const s5 = allMatchPoints(rows, { season: 5 });
    const kierce = playerPointsAgg(rows, { season: 5 }).find((p) => p.player === 'Jonathan Kierce')!;
    // His side's points in every countable S5 match he played for White.
    let won = 0;
    let lost = 0;
    for (const mp of s5) {
      const i = mp.sides.findIndex((s) => s.team === 'White');
      if (i < 0 || !mp.match.sides[i].players.some((p) => p.player === 'Jonathan Kierce')) continue;
      won += mp.sides[i].won;
      lost += mp.sides[1 - i].won;
    }
    expect(kierce).toMatchObject({ pointsWon: won, pointsLost: lost, wins: 3 });
    expect(kierce.onCourtShare).toBeCloseTo(won / (won + lost));
    // Partners who never missed a night together share the same number.
    const [a, b] = ['Luke Sharrock', 'Jack Raines'].map(
      (n) => playerPointsAgg(rows, { season: 5 }).find((p) => p.player === n)!
    );
    expect(a.onCourtShare).toBe(b.onCourtShare);
  });

  it('leaves fill-in matches out of a profile unless asked', () => {
    const rows = loadStatRows();
    const without = playerPointsAgg(rows, { season: 5 }).find((p) => p.player === 'Ted Angel')!;
    const withFi = playerPointsAgg(rows, { season: 5, includeFillIns: true }).find(
      (p) => p.player === 'Ted Angel'
    )!;
    expect(withFi.matches).toBe(without.matches + 1);
  });
});

describe('longestMatches', () => {
  const ranked = longestMatches(loadStatRows());

  it('ranks home-and-away matches by points played, ties sharing a rank', () => {
    expect(ranked.every((mp) => !mp.match.isFinals)).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].total).toBeLessThanOrEqual(ranked[i - 1].total);
      expect(ranked[i].rank).toBe(
        ranked[i].total === ranked[i - 1].total ? ranked[i - 1].rank : i + 1
      );
    }
  });

  it('puts the 10-8 breaker third all-time (S5 R6, Light Blue 6-5 Green)', () => {
    // Two 98-point nights share first; this one is next.
    expect(ranked.slice(0, 2).map((mp) => [mp.rank, mp.total])).toEqual([[1, 98], [1, 98]]);
    const lb = ranked.find(
      (mp) => mp.match.season === 5 && mp.match.round === 6 && mp.match.winner === 'Light Blue'
    )!;
    expect(lb).toMatchObject({ rank: 3, total: 93 });
    expect(lb.sides.map((s) => [s.team, s.won])).toEqual([['Green', 44], ['Light Blue', 49]]);
  });

  it('ranks finals only when asked', () => {
    const all = longestMatches(loadStatRows(), { scope: 'all' });
    expect(all.length).toBeGreaterThan(ranked.length);
    expect(all[0].match.isFinals).toBe(true);
  });
});
