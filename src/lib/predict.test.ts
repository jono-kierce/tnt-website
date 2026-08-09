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
  personalScores,
  powerRankings,
  predictPair,
  replay,
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

/** Plain doubles Elo — the result is the whole score, no between-season regression. */
const PLAIN = { k: 32, seasonRegression: 0, outcomeWeight: 1 };

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
    // Each side's two players have always shared an identical history here, so
    // they share an identical rating, and the individual-vs-opponent-pair maths
    // collapses to plain pair-vs-pair Elo — the four ratings still average
    // exactly where they started. That's a property of this symmetric fixture,
    // not a general guarantee: with a stat split or an uneven pairing, a
    // match's four deltas no longer have to net to zero (see `personalScores`).
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
    const { ratings } = replay(rows, { k: 32, seasonRegression: 0.5, outcomeWeight: 1 });
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

describe('personal performance', () => {
  const OPTS = { outcomeWeight: 0.3, performanceScale: 9 };

  it('blends the result with the stat gap against the opposing pair', () => {
    const rows = normalizeRows(
      match('2', '1',
        { team: 'Pink', players: ['A One', 'B Two'], stats: [[10, 0], [10, 0]] },
        { team: 'Navy', players: ['C Three', 'D Four'], stats: [[0, 0], [0, 0]] })
    );
    const pink = rows.filter((r) => r.team === 'Pink');
    const navy = rows.filter((r) => r.team === 'Navy');
    // Both Pink players are +10 against an opponent pair averaging 0.
    const performance = 0.5 + 0.5 * Math.tanh(10 / 9);
    const expected = 0.3 * 1 + 0.7 * performance;
    expect(personalScores(pink, navy, 1, OPTS)).toEqual([expected, expected]);
  });

  it("does not depend on how the team-mate played — only on your own ledger against the opponents", () => {
    const opponents = normalizeRows([
      raw({ Team: 'Navy', Opponent: 'Pink', Season: '2', Round: '1', Player: 'C Three',
            Winners: '0', 'Unforced Errors': '0' }),
      raw({ Team: 'Navy', Opponent: 'Pink', Season: '2', Round: '1', Player: 'D Four',
            Winners: '0', 'Unforced Errors': '0' }),
    ]);
    const withGreatPartner = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'A One',
            Winners: '8', 'Unforced Errors': '0' }),
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'B Two',
            Winners: '8', 'Unforced Errors': '0' }),
    ]);
    const withTerriblePartner = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'A One',
            Winners: '8', 'Unforced Errors': '0' }),
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'B Two',
            Winners: '0', 'Unforced Errors': '20' }),
    ]);
    // A One's own line is identical in both; B Two's collapses in the second.
    // The old team-delta split couldn't isolate that — this can.
    const withGreat = personalScores(withGreatPartner, opponents, 0, OPTS)[0];
    const withTerrible = personalScores(withTerriblePartner, opponents, 0, OPTS)[0];
    expect(withGreat).toBeCloseTo(withTerrible, 10);
  });

  it('falls back to the result alone when either side has no stat line', () => {
    const statted = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'A One',
            Winners: '10', 'Unforced Errors': '0' }),
    ]);
    const blank = normalizeRows([
      raw({ Team: 'Navy', Opponent: 'Pink', Season: '2', Round: '1', Player: 'C Three' }),
    ]);
    // A blank opponent ledger is as unusable as a blank own one — the
    // comparison this needs has two sides.
    expect(personalScores(statted, blank, 1, OPTS)).toEqual([1]);
    expect(personalScores(blank, statted, 0, OPTS)).toEqual([0]);
  });

  it('lets a standout performance in a losing match be a net rating gain', () => {
    // Pink loses, but A One and B Two are both +10 against a Navy pair
    // averaging −10 — the kind of night the old split could only ever soften
    // a loss for, never turn around.
    const rows = normalizeRows(
      match('2', '1',
        { team: 'Navy', players: ['C Three', 'D Four'], stats: [[0, 10], [0, 10]] },
        { team: 'Pink', players: ['A One', 'B Two'], stats: [[10, 0], [10, 0]] })
    );
    const { ratings } = replay(rows, { k: 32, seasonRegression: 0, ...OPTS });
    expect(ratings.get('A One')!).toBeGreaterThan(ELO.start);
    expect(ratings.get('B Two')!).toBeGreaterThan(ELO.start);
    // Navy won it, but played the worse match by the ledger, and drop.
    expect(ratings.get('C Three')!).toBeLessThan(ELO.start);
    expect(ratings.get('D Four')!).toBeLessThan(ELO.start);
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
    expect(hit).toBeGreaterThan(0.64);
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
    // Concretely: the top five by rating and the top five by matches played
    // are different lists — the busiest player can also be the best-rated one
    // (form and volume aren't opposites), but rating and volume diverge fast
    // below that, and someone with a fraction of the matches can still
    // outrank a high-volume player.
    const top5ByRating = [...byRating.slice(0, 5)].sort();
    const top5ByMatches = [...byMatches.slice(0, 5)].sort();
    expect(top5ByRating).not.toEqual(top5ByMatches);
    expect(table.slice(0, 5).some((p) => p.matches < 28)).toBe(true);
  });

  it('leaves out anyone short of the minimum', () => {
    expect(table.every((p) => p.matches >= 5)).toBe(true);
  });
});

describe('the committed constants', () => {
  it('are the best setting the search found that clears the face-validity gate', () => {
    const results = tune();
    expect(results[0].opts).toEqual({
      k: ELO.k,
      seasonRegression: ELO.seasonRegression,
      outcomeWeight: ELO.outcomeWeight,
      performanceScale: ELO.performanceScale,
    });
    expect(results[0].facesValid).toBe(true);
  });

  it('give up at most a single call to the face-validity gate', () => {
    const results = tune();
    const bestOverall = Math.max(...results.map((t) => t.result.accuracy));
    const bestPassing = Math.max(
      ...results.filter((t) => t.facesValid).map((t) => t.result.accuracy)
    );
    // Unlike the old team-split model, this gate isn't free — the single
    // best-fitting setting seats Charlie Simpson 9th. But the cost is one
    // call out of 166 (see `FACE_VALIDITY_TOP`), so it's still a sanity check
    // on the tuning, not a thumb on the scale. If this ever grows, the gate
    // has started costing real accuracy and wants a look.
    expect(bestOverall - bestPassing).toBeLessThanOrEqual(1 / 166 + 1e-9);
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
