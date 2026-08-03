import { describe, expect, it } from 'vitest';
import { normalizeRows } from './normalize.ts';
import { playerRanks, rankTable } from './ranks.ts';
import { SITE } from '../config/site.ts';

function raw(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Team: 'Pink', Opponent: 'Navy', Season: '4', Round: '', Score: '6-4', Player: '',
    Aces: '0', 'Unforced Errors': '0', 'Forced Errors': '0',
    '1st Serve In': '', '1st Serve Out': '', 'Double Faults': '0',
    Winners: '0', 'Errors Forced': '', 'win?': 'TRUE',
    'Team Score': '6', 'Opponent Score': '4', votes: '',
    ...o,
  };
}

/** One player, one row per round, with a fixed stat line each night. */
const career = (
  player: string,
  matches: number,
  stats: Partial<Record<string, string>> = {},
  from = 1
) =>
  Array.from({ length: matches }, (_, i) =>
    raw({ Player: player, Round: String(from + i), ...stats })
  );

/** Eight regulars, six matches each, winners descending by letter. */
const field = () =>
  normalizeRows(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].flatMap((p, i) =>
      career(`Player ${p}`, 6, { Winners: String(10 - i) })
    )
  );

describe('rank badges', () => {
  it('ranks the field on the home-and-away total', () => {
    const { total } = rankTable(field());
    expect(total.get('Player A')!.winners).toMatchObject({ rank: 1, of: 8 });
    expect(total.get('Player D')!.winners).toMatchObject({ rank: 4, of: 8 });
    expect(total.get('Player H')!.winners).toMatchObject({ rank: 8, of: 8 });
  });

  it('grades the rate boards but never the totals', () => {
    const table = rankTable(field());
    // A total is half a record of how many seasons you've played — ranked, but
    // not graded, and the panel only badges the top five of it.
    expect(table.total.get('Player A')!.winners).toMatchObject({ rank: 1, tier: null });
    expect(table.rate.get('Player A')!.winners!.tier).toBe('elite');
  });

  it('tiers the field best-first, guaranteeing a leader', () => {
    const { rate } = rankTable(field());
    const tier = (p: string) => rate.get(`Player ${p}`)!.winners!.tier;
    // Eight players: 1 elite, 2-3 above, 4-5 average, 6-7 below, 8 shocking.
    expect([tier('A'), tier('B'), tier('D'), tier('F'), tier('H')]).toEqual([
      'elite', 'above', 'average', 'below', 'shocking',
    ]);
  });

  it('flips the tier for errors — leading that board is the bad news', () => {
    const rows = normalizeRows(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].flatMap((p, i) =>
        career(`Player ${p}`, 6, { 'Unforced Errors': String(20 - i) })
      )
    );
    const { rate } = rankTable(rows);
    // Player A sprays the most: still #1 on the board, styled as the worst.
    expect(rate.get('Player A')!.unforcedErrors).toMatchObject({ rank: 1, tier: 'shocking' });
    expect(rate.get('Player H')!.unforcedErrors).toMatchObject({ rank: 8, tier: 'elite' });
  });

  it('switches the board from totals to per-set rates', () => {
    const rows = normalizeRows([
      // Nine nights at 5 winners (45 total, 5.00/set) against five at 8
      // (40 total, 8.00/set): the two boards disagree, as they should.
      ...career('Volume', 9, { Winners: '5' }),
      ...career('Efficient', 5, { Winners: '8' }),
      ...['C', 'D', 'E', 'F'].flatMap((p) => career(`Player ${p}`, 6, { Winners: '1' })),
    ]);
    const table = rankTable(rows);
    expect(table.total.get('Volume')!.winners!.rank).toBe(1);
    expect(table.total.get('Efficient')!.winners!.rank).toBe(2);
    expect(table.rate.get('Efficient')!.winners!.rank).toBe(1);
    expect(table.rate.get('Volume')!.winners!.rank).toBe(2);
  });

  it('leaves a short sample out of the badges and out of everyone else\'s field', () => {
    const rows = normalizeRows([
      ...['A', 'B', 'C', 'D', 'E', 'F'].flatMap((p) => career(`Player ${p}`, 6, { Winners: '5' })),
      // One night only — well under the minimum.
      ...career('Cameo', SITE.rankMinMatches - 1, { Winners: '99' }),
    ]);
    const table = rankTable(rows);
    expect(playerRanks('Cameo', rows)).toEqual({ total: {}, rate: {} });
    // The cameo's 99 winners never enter the field: six ranked, and the
    // regulars still share top spot.
    expect(table.total.get('Player A')!.winners).toMatchObject({ rank: 1, of: 6 });
  });

  it('ties share the better rank', () => {
    const rows = normalizeRows(
      ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((p) => career(`Player ${p}`, 6, { Winners: '5' }))
    );
    const { total } = rankTable(rows);
    for (const p of ['A', 'B', 'F']) {
      expect(total.get(`Player ${p}`)!.winners).toMatchObject({ rank: 1, of: 6 });
    }
  });

  it('ranks a season within that season', () => {
    const rows = normalizeRows([
      // Same six players across two seasons; the order reverses in Season 3.
      ...['A', 'B', 'C', 'D', 'E', 'F'].flatMap((p, i) =>
        career(`Player ${p}`, 6, { Winners: String(10 - i), Season: '2' })
      ),
      ...['A', 'B', 'C', 'D', 'E', 'F'].flatMap((p, i) =>
        career(`Player ${p}`, 6, { Winners: String(5 + i), Season: '3' })
      ),
    ]);
    expect(rankTable(rows, 2).total.get('Player A')!.winners!.rank).toBe(1);
    expect(rankTable(rows, 3).total.get('Player A')!.winners!.rank).toBe(6);
    expect(rankTable(rows, 3).total.get('Player F')!.winners!.rank).toBe(1);
  });
});
