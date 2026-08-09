import { describe, expect, it } from 'vitest';
import { loadStatRows, normalizeRows } from './normalize.ts';
import {
  ELO,
  FACE_VALIDITY_NAMES,
  FACE_VALIDITY_TOP,
  backtest,
  contribution,
  expectedScore,
  passesFaceValidity,
  powerRankings,
  predictPair,
  replay,
  sideWeights,
  tune,
} from './predict.ts';
import { seasonMatches } from './stats.ts';

/** A played row. Blank `win?` would make it a fixture, so it's always set. */
function raw(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Team: '', Opponent: '', Season: '2', Round: '1', Score: '6-4', Player: '',
    Aces: '', 'Unforced Errors': '', 'Forced Errors': '',
    '1st Serve In': '', '1st Serve Out': '', 'Double Faults': '',
    Winners: '', 'Errors Forced': '', 'win?': 'FALSE',
    'Team Score': '6', 'Opponent Score': '4', votes: '',
    ...o,
  };
}

/**
 * One played match. `a` wins unless `draw` is set, in which case neither side
 * is flagged — the shape a genuine draw would take.
 */
function match(
  season: string,
  round: string,
  a: { team: string; players: [string, string]; stats?: [number, number][] },
  b: { team: string; players: [string, string]; stats?: [number, number][] },
  opts: { draw?: boolean } = {}
) {
  const side = (
    s: typeof a,
    other: string,
    win: boolean
  ): Record<string, string>[] =>
    s.players.map((player, i) =>
      raw({
        Team: s.team,
        Opponent: other,
        Season: season,
        Round: round,
        Player: player,
        'win?': win ? 'TRUE' : 'FALSE',
        // [winners, unforced errors] — the two ends of the contribution ledger.
        Winners: s.stats ? String(s.stats[i][0]) : '',
        'Unforced Errors': s.stats ? String(s.stats[i][1]) : '',
      })
    );
  return [
    ...side(a, b.team, !opts.draw),
    ...side(b, a.team, false),
  ];
}

/** Plain doubles Elo — no contribution split, no between-season regression. */
const PLAIN = { k: 32, seasonRegression: 0, contributionWeight: 0 };

describe('expected score', () => {
  it('is a coin flip between equals and follows the 400-point scale', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
    // 400 points clear is the classic 10:1.
    expect(expectedScore(1900, 1500)).toBeCloseTo(10 / 11, 6);
    expect(expectedScore(1500, 1900)).toBeCloseTo(1 / 11, 6);
  });
});

describe('the replay', () => {
  it('moves both sides by K × (result − expectation), in playing order', () => {
    const rows = normalizeRows([
      ...match('2', '1', { team: 'Pink', players: ['A One', 'B Two'] },
                          { team: 'Navy', players: ['C Three', 'D Four'] }),
      // The rematch, which Navy wins off the back foot.
      ...match('2', '2', { team: 'Navy', players: ['C Three', 'D Four'] },
                          { team: 'Pink', players: ['A One', 'B Two'] }),
    ]);
    const { ratings, matches } = replay(rows, PLAIN);

    // Round 1: everyone level, so a 0.5 expectation and a full half-K swing.
    expect(matches[0].probability).toBe(0.5);
    expect(matches[0].favourite).toBe(null);
    expect(matches[0].correct).toBe(null);

    // Round 2: Pink are 1516 against Navy's 1484 and are duly favoured.
    expect(matches[1].sides.map((s) => s.rating)).toEqual([1484, 1516]);
    const expectedNavy = expectedScore(1484, 1516);
    expect(matches[1].probability).toBeCloseTo(expectedNavy, 10);
    expect(matches[1].favourite).toBe('Pink');
    expect(matches[1].correct).toBe(false); // Navy won it

    const swing = 32 * (1 - expectedNavy);
    expect(ratings.get('C Three')).toBeCloseTo(1484 + swing, 8);
    expect(ratings.get('A One')).toBeCloseTo(1516 - swing, 8);
    // Zero-sum: the four ratings still average exactly where they started.
    const total = [...ratings.values()].reduce((a, b) => a + b, 0);
    expect(total / ratings.size).toBeCloseTo(ELO.start, 8);
  });

  it('is deterministic — same rows, same numbers', () => {
    const rows = loadStatRows();
    const a = replay(rows);
    const b = replay(rows);
    expect([...a.ratings.entries()]).toEqual([...b.ratings.entries()]);
    expect(a.matches.map((m) => m.probability)).toEqual(
      b.matches.map((m) => m.probability)
    );
  });

  it('reads the result from win?, and never from the scoreline', () => {
    // 5-5 with no breaker recorded: the scoreline says nothing, win? says Pink.
    const rows = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '4', Round: '9', Score: '5-5',
            Player: 'A One', 'win?': 'TRUE', 'Team Score': '5', 'Opponent Score': '5' }),
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '4', Round: '9', Score: '5-5',
            Player: 'B Two', 'win?': 'TRUE', 'Team Score': '5', 'Opponent Score': '5' }),
      raw({ Team: 'Navy', Opponent: 'Pink', Season: '4', Round: '9', Score: '5-5',
            Player: 'C Three', 'win?': 'FALSE', 'Team Score': '5', 'Opponent Score': '5' }),
      raw({ Team: 'Navy', Opponent: 'Pink', Season: '4', Round: '9', Score: '5-5',
            Player: 'D Four', 'win?': 'FALSE', 'Team Score': '5', 'Opponent Score': '5' }),
    ]);
    const { ratings } = replay(rows, PLAIN);
    expect(ratings.get('A One')).toBe(1516);
    expect(ratings.get('C Three')).toBe(1484);
  });

  it('splits a match nobody won half a point each way', () => {
    const rows = normalizeRows(
      match('2', '1', { team: 'Pink', players: ['A One', 'B Two'] },
                       { team: 'Navy', players: ['C Three', 'D Four'] },
            { draw: true })
    );
    const { ratings, matches } = replay(rows, PLAIN);
    expect(matches[0].isDraw).toBe(true);
    expect(matches[0].winner).toBe(null);
    expect(matches[0].correct).toBe(null);
    // Level ratings, half a point: nobody moves at all.
    expect(ratings.get('A One')).toBe(1500);
    expect(ratings.get('C Three')).toBe(1500);
  });

  it('rates a fill-in as themselves, and moves their host team-mate too', () => {
    const rows = normalizeRows([
      // A One builds a rating with their own team.
      ...match('2', '1', { team: 'Pink', players: ['A One', 'B Two'] },
                          { team: 'Navy', players: ['C Three', 'D Four'] }),
      // ...then turns out for Green as a fill-in, and loses.
      ...match('2', '2', { team: 'Navy', players: ['C Three', 'D Four'] },
                          { team: 'Green', players: ['A One (Fill-in)', 'E Five'] }),
    ]);
    const { ratings, matches } = replay(rows, PLAIN);

    // The fill-in brought their own 1516 to a partner who had never played.
    expect(matches[1].sides.find((s) => s.team === 'Green')!.rating).toBe(
      (1516 + 1500) / 2
    );
    expect(matches[1].sides.find((s) => s.team === 'Green')!.known).toBe(1);
    // Both of Green's players carry the loss, guest included.
    expect(ratings.get('A One')!).toBeLessThan(1516);
    expect(ratings.get('E Five')!).toBeLessThan(1500);
  });

  it('regresses everyone between seasons, whether they played or not', () => {
    const rows = normalizeRows([
      ...match('2', '1', { team: 'Pink', players: ['A One', 'B Two'] },
                          { team: 'Navy', players: ['C Three', 'D Four'] }),
      // A different four entirely, a season later.
      ...match('3', '1', { team: 'Red', players: ['E Five', 'F Six'] },
                          { team: 'White', players: ['G Seven', 'H Eight'] }),
    ]);
    const { ratings } = replay(rows, { k: 32, seasonRegression: 0.5, contributionWeight: 0 });
    // A One sat out season 3 and still came halfway back to the mean.
    expect(ratings.get('A One')).toBe(1500 + (1516 - 1500) * 0.5);
    expect(ratings.get('C Three')).toBe(1500 + (1484 - 1500) * 0.5);
  });

  it('leaves a SINGLES GAME out of the ratings entirely', () => {
    const rows = normalizeRows([
      raw({ Team: 'Black', Opponent: 'Yellow', Season: '2', Round: '9', Score: '4-6',
            Player: 'SINGLES GAME', 'win?': 'FALSE', 'Team Score': '4', 'Opponent Score': '6' }),
      raw({ Team: 'Yellow', Opponent: 'Black', Season: '2', Round: '9', Score: '6-4',
            Player: 'SINGLES GAME', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '4' }),
    ]);
    const { ratings, matches } = replay(rows, PLAIN);
    expect(ratings.size).toBe(0);
    expect(matches).toEqual([]);
  });
});

describe('the contribution ledger', () => {
  it('counts what you made happen, less what you gave away', () => {
    const [r] = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '3', Round: '1', Player: 'A One',
            Winners: '10', Aces: '2', 'Errors Forced': '3',
            'Unforced Errors': '4', 'Double Faults': '1', 'Forced Errors': '7' }),
    ]);
    // (10 + 2 + 3) − (4 + 1) = 10. The seven forced errors are the opponent's
    // to claim, not this player's to answer for, so they don't appear.
    expect(contribution(r)).toBe(10);
  });

  it('is null for an unstatted match — a blank sheet is not a zero one', () => {
    const [r] = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '3', Round: 'F', Score: '6-4 6-2',
            Player: 'A One', 'win?': 'TRUE', 'Team Score': '12', 'Opponent Score': '6' }),
    ]);
    expect(contribution(r)).toBe(null);
  });
});

describe('the contribution split', () => {
  // A One did everything (net +10), B Two gave it all back (net −10).
  const lopsided = (win: boolean) =>
    normalizeRows(
      match('2', '1',
        win
          ? { team: 'Pink', players: ['A One', 'B Two'], stats: [[10, 0], [0, 10]] }
          : { team: 'Navy', players: ['C Three', 'D Four'], stats: [[0, 0], [0, 0]] },
        win
          ? { team: 'Navy', players: ['C Three', 'D Four'], stats: [[0, 0], [0, 0]] }
          : { team: 'Pink', players: ['A One', 'B Two'], stats: [[10, 0], [0, 10]] }
      )
    );

  const SPLIT = { k: 32, seasonRegression: 0, contributionWeight: 0.6, contributionScale: 9 };
  // tanh(10/9) — A One is that far clear of their side's average of zero.
  const tilt = 0.6 * Math.tanh(10 / 9);

  it('gives the bigger contributor more of a win', () => {
    const { ratings } = replay(lopsided(true), SPLIT);
    expect(ratings.get('A One')).toBeCloseTo(1500 + 16 * (1 + tilt), 8);
    expect(ratings.get('B Two')).toBeCloseTo(1500 + 16 * (1 - tilt), 8);
    expect(ratings.get('A One')!).toBeGreaterThan(ratings.get('B Two')!);
  });

  it('gives the bigger contributor LESS of a loss', () => {
    const { ratings } = replay(lopsided(false), SPLIT);
    // Pink lost. A One still played well, so drops by the smaller amount.
    expect(ratings.get('A One')).toBeCloseTo(1500 - 16 * (1 - tilt), 8);
    expect(ratings.get('B Two')).toBeCloseTo(1500 - 16 * (1 + tilt), 8);
    expect(ratings.get('A One')!).toBeGreaterThan(ratings.get('B Two')!);
  });

  it('never changes the pair total, so a match stays zero-sum', () => {
    for (const win of [true, false]) {
      const rows = lopsided(win);
      const split = replay(rows, SPLIT).ratings;
      const even = replay(rows, { ...SPLIT, contributionWeight: 0 }).ratings;
      const pair = (r: Map<string, number>) => r.get('A One')! + r.get('B Two')!;
      expect(pair(split)).toBeCloseTo(pair(even), 8);
      // Which is the same as saying the pair's mean — what a prediction is
      // made from — is untouched by who gets the credit.
      const all = (r: Map<string, number>) =>
        [...r.values()].reduce((a, b) => a + b, 0);
      expect(all(split)).toBeCloseTo(all(even), 8);
    }
  });

  it('splits evenly when the match was never statted', () => {
    // Same shape, no Winners or Unforced Errors anywhere.
    const rows = normalizeRows(
      match('2', '1', { team: 'Pink', players: ['A One', 'B Two'] },
                       { team: 'Navy', players: ['C Three', 'D Four'] })
    );
    const { ratings } = replay(rows, SPLIT);
    expect(ratings.get('A One')).toBe(ratings.get('B Two'));
    expect(ratings.get('A One')).toBe(1516);
  });

  it('splits evenly when only one of the two has a stat line', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'A One',
            Winners: '10', 'Unforced Errors': '0', 'win?': 'TRUE' }),
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'B Two',
            'win?': 'TRUE' }),
      raw({ Team: 'Navy', Opponent: 'Pink', Season: '2', Round: '1', Player: 'C Three',
            'win?': 'FALSE' }),
      raw({ Team: 'Navy', Opponent: 'Pink', Season: '2', Round: '1', Player: 'D Four',
            'win?': 'FALSE' }),
    ]);
    const { ratings } = replay(rows, SPLIT);
    // Half a ledger can't be compared with a blank one.
    expect(ratings.get('A One')).toBe(ratings.get('B Two'));
  });

  it('keeps the weights averaging one on a side of three', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '8', Player: 'A One',
            Winners: '12', 'Unforced Errors': '0', 'win?': 'TRUE' }),
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '8', Player: 'B Two',
            Winners: '1', 'Unforced Errors': '9', 'win?': 'TRUE' }),
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '8', Player: 'E Five',
            Winners: '4', 'Unforced Errors': '4', 'win?': 'TRUE' }),
    ]);
    const side = rows.filter((r) => r.team === 'Pink');
    const weights = sideWeights(side, true);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 10);
    expect(weights[0]).toBeGreaterThan(weights[2]);
    expect(weights[2]).toBeGreaterThan(weights[1]);
  });
});

describe('predicting an unplayed match', () => {
  it('rates a pair at the mean of its players', () => {
    const ratings = new Map([
      ['A One', 1700],
      ['B Two', 1500],
      ['C Three', 1600],
      ['D Four', 1600],
    ]);
    // 1600 against 1600 — the pairs are level however the talent is spread.
    expect(predictPair(['A One', 'B Two'], ['C Three', 'D Four'], ratings)).toBe(0.5);
  });

  it('treats an unknown player as the starting rating', () => {
    const ratings = new Map([['A One', 1700]]);
    expect(predictPair(['A One'], ['Nobody At All'], ratings)).toBeCloseTo(
      expectedScore(1700, ELO.start),
      10
    );
  });
});

describe('the model against the real CSV', () => {
  const rows = loadStatRows();
  const b = backtest(rows);

  it('calls appreciably more than half of them right', () => {
    expect(b.called).toBeGreaterThan(150);
    expect(b.accuracy).toBeGreaterThan(0.6);
    // A coin gets 0.25; anything at or above that is not worth publishing.
    expect(b.brier).toBeLessThan(0.24);
  });

  it('declines to call the handful where both sides rated level', () => {
    // Season 1 Round 1: eight players who had never been rated. The model had
    // no opinion, and those matches stay out of the denominator.
    expect(b.levelled).toBeGreaterThan(0);
    expect(b.called + b.levelled).toBe(b.matches.filter((m) => !m.isDraw).length);
  });

  it('is honest that it cannot call an opening round', () => {
    const early = b.matches.filter(
      (m) => !m.isFinals && m.round <= 2 && m.correct !== null
    );
    const hit = early.filter((m) => m.correct).length / early.length;
    // Not an assertion that it's bad — an assertion that we know it is, so the
    // UI keeps saying so. After a redraft, prior form predicts nothing.
    expect(hit).toBeLessThan(0.6);
  });

  it('does much better once a season has some form in it', () => {
    const late = b.matches.filter(
      (m) => (m.isFinals || m.round > 2) && m.correct !== null
    );
    const hit = late.filter((m) => m.correct).length / late.length;
    expect(hit).toBeGreaterThan(0.65);
  });

  it('never touches the votes column', async () => {
    // The guarantee that makes the model safe to run against a sealed season.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./predict.ts', import.meta.url), 'utf8')
    );
    const code = src
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bvotes\b/);
    expect(code).not.toMatch(/\bbog\b/i);
  });
});

describe('the power ratings', () => {
  const table = powerRankings();

  it('ranks the players the league would expect at the top', () => {
    expect(passesFaceValidity(table)).toBe(true);
    for (const name of FACE_VALIDITY_NAMES) {
      const at = table.findIndex((p) => p.player === name) + 1;
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThanOrEqual(FACE_VALIDITY_TOP);
    }
  });

  it('is not just a count of matches played', () => {
    const byRating = table.map((p) => p.player);
    const byMatches = [...table]
      .sort((a, b) => b.matches - a.matches)
      .map((p) => p.player);
    expect(byRating).not.toEqual(byMatches);
    // Concretely: the most-played player is not the top-rated one, and someone
    // with a dozen matches outranks players with three times as many.
    const top = table[0];
    const busiest = byMatches[0];
    expect(top.player).not.toBe(busiest);
    expect(table.slice(0, 5).some((p) => p.matches < 20)).toBe(true);
  });

  it('leaves out anyone short of the minimum', () => {
    expect(table.every((p) => p.matches >= 5)).toBe(true);
  });
});

describe('the committed constants', () => {
  it('are still the best the tuner can find', () => {
    const results = tune();
    const best = results[0];
    const committed = results.find(
      (t) =>
        t.opts.k === ELO.k &&
        t.opts.seasonRegression === ELO.seasonRegression &&
        t.opts.contributionWeight === ELO.contributionWeight &&
        t.opts.contributionScale === ELO.contributionScale
    );
    expect(committed).toBeDefined();
    expect(committed!.facesValid).toBe(true);
    // Ties are common — accuracy over 165 matches is a step function — so the
    // bar is that nothing beats them, not that they sort first.
    expect(committed!.result.accuracy).toBe(best.result.accuracy);
    expect(best.facesValid).toBe(true);
  });

  it('give up nothing to the face-validity gate', () => {
    const results = tune();
    const bestOverall = Math.max(...results.map((t) => t.result.accuracy));
    const bestPassing = Math.max(
      ...results.filter((t) => t.facesValid).map((t) => t.result.accuracy)
    );
    // The gate is a sanity check on the tuning, not a thumb on the scale. If
    // this ever fails, the gate has started costing accuracy and wants a look.
    expect(bestPassing).toBe(bestOverall);
  });
});

describe('a season the replay has not reached', () => {
  it('regresses before predicting it, so an opener is not overconfident', async () => {
    const { predictionFor } = await import('./predict.ts');
    const fixtures = seasonMatches(loadStatRows(), 5).filter((m) => m.scheduled);
    expect(fixtures.length).toBeGreaterThan(0);
    for (const m of fixtures) {
      const p = predictionFor(m);
      expect(p.scheduled).toBe(true);
      // Everyone is 90% of the way back to 1500, so nothing should read as a
      // strong call. If this starts failing, the regression stopped being
      // applied to a future season.
      expect(Math.abs(p.probability - 0.5)).toBeLessThan(0.15);
    }
  });
});
