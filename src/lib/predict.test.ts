import { describe, expect, it } from 'vitest';
import { loadStatRows, normalizeRows } from './normalize.ts';
import {
  FACE_VALIDITY_NAMES,
  FACE_VALIDITY_TOP,
  MODEL,
  type Model,
  accuracyHeadline,
  backtest,
  contribution,
  expectedScore,
  fitModel,
  passesFaceValidity,
  powerRankings,
  predictPair,
  predictionFor,
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
  return [...side(a, b.team, !opts.draw), ...side(b, a.team, false)];
}

describe('expected score', () => {
  it('is a coin flip between equal skills and rises with the gap', () => {
    expect(expectedScore(0, 0)).toBe(0.5);
    expect(expectedScore(1, 0)).toBeGreaterThan(0.5);
    expect(expectedScore(0, 1)).toBeLessThan(0.5);
    // Symmetric: P(a beats b) + P(b beats a) = 1.
    expect(expectedScore(0.7, -0.3) + expectedScore(-0.3, 0.7)).toBeCloseTo(1, 12);
    // On the model's own scale, a gap of one unit is σ(probScale).
    expect(expectedScore(1, 0)).toBeCloseTo(1 / (1 + Math.exp(-MODEL.probScale)), 12);
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

describe('the fit', () => {
  it('is order-invariant — a convex optimum, not a replay', () => {
    // The single defining property that Elo did not have: because the objective
    // is convex, the same rows in any order give the same ratings. Shuffle the
    // whole CSV and the fit lands in exactly the same place.
    const rows = loadStatRows();
    const shuffled = [...rows];
    // A fixed, arbitrary permutation — deterministic so the test is stable.
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 2654435761) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const a = fitModel(rows);
    const b = fitModel(shuffled);
    for (const [player, skill] of a.skills) {
      expect(b.skills.get(player)).toBeCloseTo(skill, 9);
    }
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
    const { skills } = fitModel(rows);
    expect(skills.get('A One')!).toBeGreaterThan(skills.get('C Three')!);
  });

  it('leaves a match nobody won symmetric — half a point each way', () => {
    const rows = normalizeRows(
      match('2', '1', { team: 'Pink', players: ['A One', 'B Two'] },
                       { team: 'Navy', players: ['C Three', 'D Four'] },
            { draw: true })
    );
    const { skills } = fitModel(rows);
    // A perfectly symmetric draw: nobody separates from anybody.
    expect(skills.get('A One')!).toBeCloseTo(skills.get('C Three')!, 9);
  });

  it('leaves a SINGLES GAME out of the fit entirely', () => {
    const rows = normalizeRows([
      raw({ Team: 'Black', Opponent: 'Yellow', Season: '2', Round: '9', Score: '4-6',
            Player: 'SINGLES GAME', 'win?': 'FALSE', 'Team Score': '4', 'Opponent Score': '6' }),
      raw({ Team: 'Yellow', Opponent: 'Black', Season: '2', Round: '9', Score: '6-4',
            Player: 'SINGLES GAME', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '4' }),
    ]);
    const model = fitModel(rows);
    expect(model.skills.size).toBe(0);
    expect(model.matches).toEqual([]);
  });
});

describe('sample-size resistance', () => {
  it('trusts a thin record less than a thick one', () => {
    // Two would-be stars, each unbeaten against weak pairs, but one has played
    // four times as often. The ridge penalty keeps the two-match player closer
    // to the middle: the data hasn't earned the same claim yet.
    const rounds: Record<string, string>[] = [];
    for (let r = 1; r <= 8; r++) {
      rounds.push(...match('2', String(r),
        { team: 'Heavy', players: ['Heavy Star', 'Heavy Mate'] },
        { team: `Weak${r}`, players: [`W${r} One`, `W${r} Two`] }));
    }
    for (let r = 1; r <= 2; r++) {
      rounds.push(...match('2', String(r),
        { team: 'Light', players: ['Light Star', 'Light Mate'] },
        { team: `Foil${r}`, players: [`F${r} One`, `F${r} Two`] }));
    }
    const { skills } = fitModel(normalizeRows(rounds));
    expect(skills.get('Heavy Star')!).toBeGreaterThan(0);
    expect(skills.get('Light Star')!).toBeGreaterThan(0);
    // Same unbeaten story, but four times the evidence sits further out.
    expect(skills.get('Heavy Star')!).toBeGreaterThan(skills.get('Light Star')!);
  });
});

describe('separating a player from their team-mate', () => {
  it('rewards the standout in a loss and drops the passenger who was carried', () => {
    // Pink lose, but A One was +10 on the ledger against a Navy pair averaging 0
    // while B Two was −20. The stat channel rates them apart despite one shared
    // result — the "good player, bad team-mates" fix.
    const rows = normalizeRows(
      match('2', '1',
        { team: 'Navy', players: ['C Three', 'D Four'], stats: [[5, 5], [5, 5]] },
        { team: 'Pink', players: ['A One', 'B Two'], stats: [[10, 0], [0, 20]] })
    );
    const { skills } = fitModel(rows);
    // A One out-performed everyone on court and lost — still ends up ahead of
    // their own team-mate, who gave the night away.
    expect(skills.get('A One')!).toBeGreaterThan(skills.get('B Two')!);
    // And ahead of the opponents they out-played, result notwithstanding.
    expect(skills.get('A One')!).toBeGreaterThan(skills.get('C Three')!);
  });
});

describe('predicting from a set of ratings', () => {
  const model = {
    skills: new Map([
      ['A One', 2],
      ['B Two', -2],
      ['C Three', 1],
      ['D Four', -1],
    ]),
    display: { mean: 0, sd: 1 },
  } as unknown as Model;

  it('rates a pair at the mean of its players', () => {
    // 0 against 0 — the pairs are level however the talent is spread.
    expect(predictPair(['A One', 'B Two'], ['C Three', 'D Four'], model)).toBe(0.5);
  });

  it('treats an unknown player as league-average skill', () => {
    const one = { skills: new Map([['A One', 1.3]]), display: { mean: 0, sd: 1 } } as unknown as Model;
    expect(predictPair(['A One'], ['Nobody At All'], one)).toBeCloseTo(
      expectedScore(1.3, 0),
      12
    );
  });
});

describe('the model against the real CSV', () => {
  const rows = loadStatRows();
  const b = backtest(rows);

  it('calls appreciably more than half of them right, and is well calibrated', () => {
    expect(b.called).toBeGreaterThan(150);
    expect(b.accuracy).toBeGreaterThan(0.6);
    // A coin gets 0.25; the model comes in clearly under it.
    expect(b.brier).toBeLessThan(0.24);
  });

  it('declines to call the handful where both sides rated level', () => {
    // Season 1 Round 1: players the fit had never seen, so both pairs sit at
    // the mean. Those matches stay out of the accuracy denominator.
    expect(b.levelled).toBeGreaterThan(0);
    expect(b.called + b.levelled).toBe(b.matches.filter((m) => !m.isDraw).length);
  });

  it('reads a settled round better than an opening one', () => {
    // After a redraft, an opener has little form behind it, so the model does
    // worse there than once a season has some results in it. Not a claim it's
    // bad at openers — a check that the gap is the right way round, so the UI's
    // "line-ball" hedging stays honest.
    const early = b.matches.filter((m) => !m.isFinals && m.round <= 2 && m.correct !== null);
    const late = b.matches.filter((m) => (m.isFinals || m.round > 2) && m.correct !== null);
    const hit = (ms: typeof early) => ms.filter((m) => m.correct).length / ms.length;
    expect(hit(late)).toBeGreaterThan(hit(early));
    expect(hit(late)).toBeGreaterThan(0.6);
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

  it('has an honest headline', () => {
    expect(accuracyHeadline(b)).toMatch(/^\d+ of \d+ matches \(\d+\.\d%\)$/);
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
    const byMatches = [...table].sort((a, b) => b.matches - a.matches).map((p) => p.player);
    expect(byRating).not.toEqual(byMatches);
    const top5ByRating = [...byRating.slice(0, 5)].sort();
    const top5ByMatches = [...byMatches.slice(0, 5)].sort();
    expect(top5ByRating).not.toEqual(top5ByMatches);
    // Someone with well short of a full career can still sit in the top five.
    expect(table.slice(0, 5).some((p) => p.matches < 28)).toBe(true);
  });

  it('leaves out anyone short of the minimum', () => {
    expect(table.every((p) => p.matches >= 5)).toBe(true);
  });
});

describe('the committed constants', () => {
  it('still seat all four face-validity names inside the top 8', () => {
    const table = powerRankings(
      fitModel(undefined, {
        winWeight: MODEL.winWeight,
        statWeight: MODEL.statWeight,
        ridge: MODEL.ridge,
        halfLife: MODEL.halfLife,
      })
    );
    expect(passesFaceValidity(table)).toBe(true);
  });

  it("are close to tune()'s own accuracy-best, and the gate costs nothing", () => {
    const results = tune();
    const bestOverall = Math.max(...results.map((t) => t.result.accuracy));
    const bestPassing = Math.max(
      ...results.filter((t) => t.facesValid).map((t) => t.result.accuracy)
    );
    const called = results[0].result.called;
    // The face-validity gate sorts nothing good out of reach: the best setting
    // that passes it is within a call or two of the best setting overall.
    expect(bestOverall - bestPassing).toBeLessThanOrEqual(2 / called + 1e-9);
    // The committed constants are among the strongest face-valid settings.
    const committed = backtest().accuracy;
    expect(bestPassing - committed).toBeLessThanOrEqual(2 / called + 1e-9);
  });
});

describe('a season the fit has not reached', () => {
  it('predicts a redrafted opener as a soft call, never a lock', () => {
    const fixtures = seasonMatches(loadStatRows(), 5).filter((m) => m.scheduled);
    expect(fixtures.length).toBeGreaterThan(0);
    for (const m of fixtures) {
      const p = predictionFor(m);
      expect(p.scheduled).toBe(true);
      // A redrafted pairing has no season-specific form yet: carried skills,
      // ridge and recency decay together keep every opener short of a lock. The
      // ceiling is looser than it was because `probScale` was pushed bolder
      // (2.8) for a more confident read — the openers move with it, so this
      // guards that they stay hedged rather than pinning any specific number.
      expect(Math.abs(p.probability - 0.5)).toBeLessThan(0.35);
    }
  });
});
