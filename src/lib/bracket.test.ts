import { describe, expect, it } from 'vitest';
import { bracketLayout, type BracketLayout } from './bracket.ts';
import { allSeasonConfigs, getSeasonConfig } from '../config/seasons/index.ts';

const order = (l: BracketLayout, col: number) => l.columns[col].ties.map((t) => t.match.id);
const posOf = (l: BracketLayout, id: string) =>
  l.columns.flatMap((c) => c.ties).find((t) => t.match.id === id)!.pos;

describe('bracketLayout — a straight knockout (S4)', () => {
  const l = bracketLayout(getSeasonConfig(4)!.finals!);

  it('draws each semi between the two quarters that feed it', () => {
    expect(order(l, 0)).toEqual(['QF1', 'QF4', 'QF2', 'QF3']);
    expect(posOf(l, 'SF1')).toBeCloseTo((posOf(l, 'QF1') + posOf(l, 'QF4')) / 2);
    expect(posOf(l, 'SF2')).toBeCloseTo((posOf(l, 'QF2') + posOf(l, 'QF3')) / 2);
    expect(posOf(l, 'F')).toBeCloseTo((posOf(l, 'SF1') + posOf(l, 'SF2')) / 2);
  });

  it('has no double chance and needs one lane a gap', () => {
    expect(l.doubleChance).toBe(false);
    expect(l.edges.every((e) => e.kind === 'winner' && e.lanes === 1)).toBe(true);
  });
});

describe('bracketLayout — a knockout with a wildcard (S5)', () => {
  const finals = getSeasonConfig(5)!.finals!;
  const l = bracketLayout(finals);

  it('keeps the wildcard in the quarter-final round, stacked under QF1', () => {
    // 8 v 9 is played on quarter-final night and its winner meets 1st, so it
    // hangs directly under QF1 — not beside QF4, which shares QF1's semi.
    expect(order(l, 0)).toEqual(['QF1', 'WC', 'QF4', 'QF2', 'QF3']);
    const e = l.edges.find((x) => x.from === 'WC')!;
    expect(e).toMatchObject({ to: 'QF1', slot: 'away', stacked: true });
    expect(posOf(l, 'WC') - posOf(l, 'QF1')).toBeCloseTo(1);
  });

  it('is otherwise the usual 1v8 / 4v5 and 2v7 / 3v6 knockout', () => {
    expect(order(l, 1)).toEqual(['SF1', 'SF2']);
    expect(posOf(l, 'SF1')).toBeCloseTo((posOf(l, 'QF1') + posOf(l, 'QF4')) / 2);
    expect(posOf(l, 'SF2')).toBeCloseTo((posOf(l, 'QF2') + posOf(l, 'QF3')) / 2);
    expect(l.doubleChance).toBe(false);
    expect(l.edges.every((e) => e.kind === 'winner')).toBe(true);
  });
});

describe('bracketLayout — a stacked tie', () => {
  it('sits beside the tie it feeds even when another tie shares that one\'s key', () => {
    const l = bracketLayout([
      {
        name: 'R1',
        matches: [
          { id: 'A', home: { seed: 1 }, away: { winnerOf: 'X' } },
          { id: 'X', home: { seed: 8 }, away: { seed: 9 } },
          { id: 'B', home: { seed: 4 }, away: { seed: 5 } },
          { id: 'Y', home: { seed: 6 }, away: { seed: 7 } },
          { id: 'C', home: { winnerOf: 'Y' }, away: { seed: 2 } },
        ],
      },
      { name: 'R2', matches: [{ id: 'S', home: { winnerOf: 'A' }, away: { winnerOf: 'B' } }, { id: 'T', home: { winnerOf: 'C' }, away: { seed: 3 } }] },
    ]);
    // X fills A's bottom row, so it goes under A; Y fills C's top row, so over C.
    expect(order(l, 0)).toEqual(['A', 'X', 'B', 'Y', 'C']);
  });
});

describe('bracketLayout — every season', () => {
  for (const cfg of allSeasonConfigs()) {
    if (!cfg.finals?.length) continue;
    const l = bracketLayout(cfg.finals);

    it(`S${cfg.season}: ties in a round never overlap`, () => {
      for (const col of l.columns) {
        for (let i = 1; i < col.ties.length; i++) {
          expect(col.ties[i].pos - col.ties[i - 1].pos).toBeGreaterThanOrEqual(1 - 1e-9);
        }
      }
      const all = l.columns.flatMap((c) => c.ties.map((t) => t.pos));
      expect(Math.min(...all)).toBeCloseTo(0.5);
      expect(Math.max(...all)).toBeCloseTo(l.span - 0.5);
    });

    it(`S${cfg.season}: two runs turning in one gap never share a lane where they overlap`, () => {
      const turning = l.edges.filter((e) => !e.stacked && Math.abs(e.y2 - e.y1) > 1e-9);
      for (const a of turning) {
        for (const b of turning) {
          if (a === b || a.toCol !== b.toCol || a.lane !== b.lane) continue;
          const [a0, a1] = [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)];
          const [b0, b1] = [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)];
          expect(a1 < b0 || b1 < a0, `${a.from}->${a.to} v ${b.from}->${b.to}`).toBe(true);
        }
      }
    });
  }
});
