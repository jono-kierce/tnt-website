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

describe('bracketLayout — AFL-style (S5)', () => {
  const finals = getSeasonConfig(5)!.finals!;
  const l = bracketLayout(finals);

  it('puts the qualifying finals in the middle, the eliminations outside them', () => {
    // The wildcard is week one too, played first: it stacks under EF2, the tie
    // its winner joins.
    expect(order(l, 0)).toEqual(['EF1', 'QF1', 'QF2', 'EF2', 'WC']);
    expect(order(l, 1)).toEqual(['SF1', 'SF2']);
    expect(order(l, 2)).toEqual(['PF1', 'PF2']);
  });

  it('drops each qualifying loser a single row into its semi', () => {
    for (const [qf, sf] of [['QF1', 'SF1'], ['QF2', 'SF2']]) {
      const e = l.edges.find((x) => x.from === qf && x.kind === 'loser')!;
      expect(e.to).toBe(sf);
      expect(Math.abs(posOf(l, sf) - posOf(l, qf))).toBeLessThanOrEqual(0.5);
    }
  });

  it('marks only the qualifying finals as a double chance', () => {
    const dc = l.columns.flatMap((c) => c.ties).filter((t) => t.doubleChance);
    expect(dc.map((t) => t.match.id).sort()).toEqual(['QF1', 'QF2']);
  });

  it('stacks the wildcard directly under the tie it feeds', () => {
    const e = l.edges.find((x) => x.from === 'WC')!;
    expect(e.stacked).toBe(true);
    expect(e.slot).toBe('away');
    expect(posOf(l, 'WC') - posOf(l, 'EF2')).toBeCloseTo(1);
  });

  it('never lets one tie fill both sides of the next round', () => {
    // The preliminary-final crossover: a QF winner meets the semi winner from
    // the other side, so the QF isn't replayed a fortnight later.
    for (const m of finals.flatMap((r) => r.matches)) {
      const refs = [m.home, m.away].map((s) =>
        'winnerOf' in s ? s.winnerOf : 'loserOf' in s ? s.loserOf : null
      );
      if (refs[0] && refs[1]) expect(refs[0]).not.toBe(refs[1]);
    }
    expect(l.edges.find((e) => e.from === 'QF1' && e.kind === 'winner')!.to).toBe('PF2');
    expect(l.edges.find((e) => e.from === 'QF2' && e.kind === 'winner')!.to).toBe('PF1');
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
