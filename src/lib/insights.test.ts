import { describe, expect, it } from 'vitest';
import { loadStatRows, normalizeRows } from './normalize.ts';
import { seasonMatches } from './stats.ts';
import {
  basementInsight,
  droughtInsight,
  errorFormInsight,
  errorLeaderInsight,
  firstMeetingInsight,
  formInsight,
  hoodooInsight,
  insightContext,
  insightsFor,
  lossStreakInsight,
  matchInsights,
  milestoneInsight,
  mockMilestoneInsight,
  pairH2HInsight,
  revengeInsight,
  stakesInsight,
  waywardInsight,
  winStreakInsight,
  type InsightKind,
} from './insights.ts';

/** The unflattering kinds — `insights.ts` keeps its own copy private. */
const NEGATIVE = new Set<InsightKind>([
  'cold-streak',
  'drought',
  'basement',
  'hoodoo',
  'errors',
  'mock-milestone',
]);

function raw(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Team: '', Opponent: '', Season: '3', Round: '1', Score: '6-4', Player: '',
    Aces: '', 'Unforced Errors': '', 'Forced Errors': '',
    '1st Serve In': '', '1st Serve Out': '', 'Double Faults': '',
    Winners: '', 'Errors Forced': '', 'win?': 'FALSE',
    'Team Score': '6', 'Opponent Score': '4', votes: '',
    ...o,
  };
}

/**
 * One played match, `a` beating `b` unless `aWins` says otherwise.
 *
 * `stats` is per player: `[winners, unforced errors]`, with double faults as an
 * optional third — the error detectors need a way to say "and served four of
 * them", and everything already written here keeps working with two.
 */
function played(
  season: string,
  round: string,
  a: { team: string; players: string[]; stats?: [number, number, number?][] },
  b: { team: string; players: string[]; stats?: [number, number, number?][] },
  aWins = true
) {
  const side = (s: typeof a, other: string, win: boolean) =>
    s.players.map((player, i) =>
      raw({
        Team: s.team, Opponent: other, Season: season, Round: round, Player: player,
        Score: win ? '6-4' : '4-6',
        'Team Score': win ? '6' : '4', 'Opponent Score': win ? '4' : '6',
        'win?': win ? 'TRUE' : 'FALSE',
        Winners: s.stats?.[i] ? String(s.stats[i][0]) : '',
        'Unforced Errors': s.stats?.[i] ? String(s.stats[i][1]) : '',
        'Double Faults': s.stats?.[i]?.[2] !== undefined ? String(s.stats[i][2]) : '',
      })
    );
  return [...side(a, b.team, aWins), ...side(b, a.team, !aWins)];
}

/** The context for the LAST match in a set of rows. */
function contextForLast(rows: ReturnType<typeof normalizeRows>) {
  const all = seasonMatches(rows);
  return insightContext(all[all.length - 1], rows);
}

describe('the window', () => {
  it('shows a detector only what happened before the match', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }),
      ...played('3', '3', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'White', players: ['G7', 'H 8'] }),
    ]);
    const all = seasonMatches(rows);
    expect(insightContext(all[0], rows).history).toEqual([]);
    expect(insightContext(all[1], rows).history.map((m) => m.round)).toEqual([1]);
    expect(insightContext(all[2], rows).history.map((m) => m.round)).toEqual([1, 2]);
  });
});

describe('win streak', () => {
  it('fires at three straight and names the longest run', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }),
      ...played('3', '3', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'White', players: ['G 7', 'H 8'] }),
      ...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Green', players: ['I 9', 'J 10'] }),
    ]);
    const insight = winStreakInsight(contextForLast(rows))!;
    expect(insight).not.toBe(null);
    expect(insight.detail).toMatch(/3 straight wins/);
    expect(insight.team).toBe('Pink');
  });

  it('says nothing at two, and nothing after a loss', () => {
    const two = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }),
      ...played('3', '3', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'White', players: ['G 7', 'H 8'] }),
    ]);
    expect(winStreakInsight(contextForLast(two))).toBe(null);

    const broken = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }),
      ...played('3', '3', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'White', players: ['G 7', 'H 8'] }),
      ...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Green', players: ['I 9', 'J 10'] }, false),
      ...played('3', '5', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Black', players: ['K 11', 'L 12'] }),
    ]);
    expect(winStreakInsight(contextForLast(broken))).toBe(null);
  });
});

describe('revenge and first meetings', () => {
  const twice = normalizeRows([
    ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
    ...played('3', '5', { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Pink', players: ['A One', 'B Two'] }),
  ]);

  it('names the side that lost last time, with the scoreline', () => {
    const insight = revengeInsight(contextForLast(twice))!;
    expect(insight.team).toBe('Navy');
    // The scoreline lives on each side of a match, written from that side's
    // point of view — there is no match-level one to read.
    expect(insight.detail).toBe('Navy lost the last meeting in round 1, 6-4 to Pink.');
  });

  it('does not look back past the redraft', () => {
    // Same two colours, a season apart — and, by then, a different ten players
    // apiece. Wearing the colour of a grudge is not having one.
    const acrossSeasons = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('4', '1', { team: 'Navy', players: ['E Five', 'F Six'] }, { team: 'Pink', players: ['G 7', 'H 8'] }),
    ]);
    expect(revengeInsight(contextForLast(acrossSeasons))).toBe(null);
  });

  it('says nothing when the teams have never met', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }),
    ]);
    expect(revengeInsight(contextForLast(rows))).toBe(null);
  });

  it('calls a first meeting only once the league has some history', () => {
    // Two matches in: everything is a first meeting and none of it is news.
    const early = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }),
    ]);
    expect(firstMeetingInsight(contextForLast(early))).toBe(null);

    // With a real history behind it, a first meeting is worth a line.
    const rows = [];
    for (let r = 1; r <= 11; r++) {
      rows.push(
        ...played('3', String(r), { team: 'Pink', players: ['A One', 'B Two'] },
                                   { team: 'Navy', players: ['C Three', 'D Four'] })
      );
    }
    rows.push(
      ...played('3', '12', { team: 'Red', players: ['E Five', 'F Six'] },
                            { team: 'White', players: ['G 7', 'H 8'] })
    );
    const insight = firstMeetingInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight.detail).toMatch(/have never played each other/);
  });
});

describe('pair head to head', () => {
  it('reports a record only for the exact same two pairings', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '7', { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Pink', players: ['A One', 'B Two'] }),
    ]);
    const insight = pairH2HInsight(contextForLast(rows))!;
    expect(insight.detail).toMatch(/lead this exact pairing 2–0 from 2 meetings/);
    expect(insight.team).toBe('Pink');
  });

  it('ignores a meeting where one of the pair was different', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'Z Sub'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
    ]);
    expect(pairH2HInsight(contextForLast(rows))).toBe(null);
  });
});

describe('milestones', () => {
  it('fires on the match that lands the round number, not after it', () => {
    const rows = [];
    for (let r = 1; r <= 25; r++) {
      rows.push(
        ...played('3', String(r), { team: 'Pink', players: ['A One', 'B Two'] },
                                   { team: 'Navy', players: ['C Three', 'D Four'] })
      );
    }
    // The last of these is the 25th: 24 behind it in the window.
    const insight = milestoneInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight.detail).toMatch(/25th TNT match/);

    // And the one after is just a match again.
    rows.push(
      ...played('3', '26', { team: 'Pink', players: ['A One', 'B Two'] },
                            { team: 'Navy', players: ['C Three', 'D Four'] })
    );
    expect(milestoneInsight(contextForLast(normalizeRows(rows)))).toBe(null);
  });
});

describe('form', () => {
  it('picks up a player well above their own career average', () => {
    const rows = [];
    // Ten quiet matches, then four big ones.
    for (let r = 1; r <= 10; r++) {
      rows.push(
        ...played('3', String(r),
          { team: 'Pink', players: ['A One', 'B Two'], stats: [[2, 4], [3, 3]] },
          { team: 'Navy', players: ['C Three', 'D Four'] })
      );
    }
    for (let r = 11; r <= 15; r++) {
      rows.push(
        ...played('3', String(r),
          { team: 'Pink', players: ['A One', 'B Two'], stats: [[12, 1], [3, 3]] },
          { team: 'Navy', players: ['C Three', 'D Four'] })
      );
    }
    const insight = formInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight).not.toBe(null);
    expect(insight.detail).toMatch(/^A One has been well above/);
    expect(insight.team).toBe('Pink');
  });

  it('says nothing about a player who has always been that good', () => {
    const rows = [];
    for (let r = 1; r <= 15; r++) {
      rows.push(
        ...played('3', String(r),
          { team: 'Pink', players: ['A One', 'B Two'], stats: [[12, 1], [3, 3]] },
          { team: 'Navy', players: ['C Three', 'D Four'] })
      );
    }
    expect(formInsight(contextForLast(normalizeRows(rows)))).toBe(null);
  });

  it('says nothing off a short career', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'], stats: [[2, 4], [3, 3]] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Pink', players: ['A One', 'B Two'], stats: [[20, 0], [3, 3]] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
    ]);
    expect(formInsight(contextForLast(rows))).toBe(null);
  });
});

describe('ladder stakes', () => {
  it('spots a winner-goes-top match', () => {
    const rows = [];
    // Pink win three; Navy win three against other teams. Round 4 they meet.
    for (let r = 1; r <= 3; r++) {
      rows.push(...played('3', String(r), { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }));
      rows.push(...played('3', String(r), { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'White', players: ['G 7', 'H 8'] }));
    }
    rows.push(...played('3', '4', { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Pink', players: ['A One', 'B Two'] }));
    const insight = stakesInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight).not.toBe(null);
    expect(insight.detail).toMatch(/go top of the ladder with a win/);
  });

  it('stays quiet in the opening rounds, when a ladder means nothing', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }),
      ...played('3', '2', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
    ]);
    expect(stakesInsight(contextForLast(rows))).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// The other side of the ledger
// ---------------------------------------------------------------------------

/** `n` matches where Pink beat Navy, or lost to them. */
function run(
  season: string,
  from: number,
  to: number,
  opts: { pinkWins: boolean; pinkStats?: [number, number, number?][] } = { pinkWins: true }
) {
  const rows = [];
  for (let r = from; r <= to; r++) {
    rows.push(
      ...played(season, String(r),
        { team: 'Pink', players: ['A One', 'B Two'], stats: opts.pinkStats },
        { team: 'Navy', players: ['C Three', 'D Four'] },
        opts.pinkWins)
    );
  }
  return rows;
}

describe('loss streak', () => {
  it('fires at four straight losses, not three', () => {
    const three = normalizeRows(run('3', 1, 4, { pinkWins: false }));
    expect(lossStreakInsight(contextForLast(three))).toBe(null);

    const four = normalizeRows(run('3', 1, 5, { pinkWins: false }));
    const insight = lossStreakInsight(contextForLast(four))!;
    expect(insight.detail).toMatch(/arrives on 4 straight losses/);
    expect(insight.team).toBe('Pink');
  });

  it('does not carry a losing run across the redraft', () => {
    // Four losses to end one season, then a new one. Those four were with ten
    // different team-mates; hanging them on a player in January is the same
    // mistake "revenge match" made across seasons.
    const rows = normalizeRows([
      ...run('3', 1, 4, { pinkWins: false }),
      ...played('4', '1', { team: 'Pink', players: ['A One', 'B Two'] },
                            { team: 'Navy', players: ['C Three', 'D Four'] }),
    ]);
    expect(lossStreakInsight(contextForLast(rows))).toBe(null);
  });
});

describe('team drought', () => {
  it('calls a winless season with the record', () => {
    const rows = normalizeRows(run('3', 1, 4, { pinkWins: false }));
    const insight = droughtInsight(contextForLast(rows))!;
    expect(insight.label).toBe('Still hunting');
    expect(insight.detail).toBe('Pink are 0–3 for the season and still chasing a first win.');
    expect(insight.team).toBe('Pink');
  });

  it('calls a run of losses for a team that has won something, and counts the whole run', () => {
    const rows = normalizeRows([
      ...run('3', 1, 1, { pinkWins: true }),
      ...run('3', 2, 5, { pinkWins: false }),
    ]);
    const insight = droughtInsight(contextForLast(rows))!;
    expect(insight.label).toBe('Slide');
    expect(insight.detail).toBe('Pink have lost 3 in a row.');

    // Two more losses and it says four, not three again.
    const longer = normalizeRows([
      ...run('3', 1, 1, { pinkWins: true }),
      ...run('3', 2, 6, { pinkWins: false }),
    ]);
    expect(droughtInsight(contextForLast(longer))!.detail).toBe('Pink have lost 4 in a row.');
  });

  it('says nothing at two losses', () => {
    const rows = normalizeRows([
      ...run('3', 1, 1, { pinkWins: true }),
      ...run('3', 2, 4, { pinkWins: false }),
    ]);
    expect(droughtInsight(contextForLast(rows))).toBe(null);
  });
});

describe('basement battle', () => {
  const field = ['Pink', 'Navy', 'Red', 'White', 'Green', 'Black'];

  it('fires when both sides sit in the bottom three', () => {
    const rows = [];
    // Red and White win everything; Pink and Navy lose everything.
    for (let r = 1; r <= 3; r++) {
      rows.push(...played('3', String(r), { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'Pink', players: ['A One', 'B Two'] }));
      rows.push(...played('3', String(r), { team: 'White', players: ['G 7', 'H 8'] }, { team: 'Navy', players: ['C Three', 'D Four'] }));
      rows.push(...played('3', String(r), { team: 'Green', players: ['I 9', 'J 10'] }, { team: 'Black', players: ['K 11', 'L 12'] }));
    }
    rows.push(...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }));
    const ctx = insightContext(seasonMatches(normalizeRows(rows)).at(-1)!, normalizeRows(rows), field);
    const insight = basementInsight(ctx)!;
    expect(insight.detail).toMatch(/meet at the bottom of the ladder/);
  });

  it('says nothing about a team that has simply not played yet', () => {
    // Two rounds of byes is not a cellar. A declared team enters the ladder at
    // 0/0/0, which looks identical to losing every week if you only read rank.
    const rows = [];
    for (let r = 1; r <= 3; r++) {
      rows.push(...played('3', String(r), { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }));
      rows.push(...played('3', String(r), { team: 'Green', players: ['I 9', 'J 10'] }, { team: 'Black', players: ['K 11', 'L 12'] }));
    }
    rows.push(...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }));
    const norm = normalizeRows(rows);
    const ctx = insightContext(seasonMatches(norm).at(-1)!, norm, field);
    expect(basementInsight(ctx)).toBe(null);
  });
});

describe('hoodoo', () => {
  it('needs a clean sweep of at least three meetings', () => {
    const twice = normalizeRows(run('3', 1, 3, { pinkWins: false }));
    expect(hoodooInsight(contextForLast(twice))).toBe(null);

    const rows = normalizeRows(run('3', 1, 4, { pinkWins: false }));
    const insight = hoodooInsight(contextForLast(rows))!;
    expect(insight.detail).toMatch(/A One has never beaten C Three — 0–3/);
    expect(insight.team).toBe('Pink');
  });

  it('says nothing once the record is broken', () => {
    const rows = normalizeRows([
      ...run('3', 1, 3, { pinkWins: false }),
      ...run('3', 4, 4, { pinkWins: true }),
      ...run('3', 5, 5, { pinkWins: false }),
    ]);
    expect(hoodooInsight(contextForLast(rows))).toBe(null);
  });
});

describe('errors', () => {
  it('spots a player making far more unforced errors than usual', () => {
    const rows = [
      ...run('3', 1, 10, { pinkWins: true, pinkStats: [[3, 3], [3, 3]] }),
      ...run('3', 11, 15, { pinkWins: true, pinkStats: [[3, 9], [3, 3]] }),
    ];
    const insight = errorFormInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight.label).toBe('Off the boil');
    expect(insight.detail).toMatch(/^A One has made 4\.\d more unforced errors a set/);
    expect(insight.team).toBe('Pink');
  });

  it('says nothing about a player who has always sprayed them', () => {
    const rows = run('3', 1, 15, { pinkWins: true, pinkStats: [[3, 9], [3, 3]] });
    expect(errorFormInsight(contextForLast(normalizeRows(rows)))).toBe(null);
  });

  it('names the season leader for unforced errors per set', () => {
    const rows = run('3', 1, 5, { pinkWins: true, pinkStats: [[3, 8], [3, 2]] });
    const insight = errorLeaderInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight.label).toBe('Generous');
    expect(insight.detail).toBe('A One leads the season for unforced errors — 8.0 a set.');
  });

  it('reads out a wayward recent run, errors before double faults', () => {
    const ue = normalizeRows(run('3', 1, 5, { pinkWins: true, pinkStats: [[3, 14, 4], [3, 2]] }));
    const insight = waywardInsight(contextForLast(ue))!;
    expect(insight.detail).toBe('A One has made 14.0 unforced errors a set across the last 4 matches.');

    // Errors under the bar, double faults over it: the serve gets the line.
    const df = normalizeRows(run('3', 1, 5, { pinkWins: true, pinkStats: [[3, 2, 4], [3, 2]] }));
    const fault = waywardInsight(contextForLast(df))!;
    expect(fault.detail).toBe('A One has served 16 double faults in the last 4 matches.');
  });
});

describe('unwanted milestones', () => {
  it('counts down to a round number of unforced errors', () => {
    // 14 matches at 7 apiece is 98 — two short of a hundred.
    const rows = normalizeRows(run('3', 1, 15, { pinkWins: true, pinkStats: [[3, 7], [3, 1]] }));
    const insight = mockMilestoneInsight(contextForLast(rows))!;
    expect(insight.detail).toBe('A One is 2 unforced errors away from 100 for a TNT career.');
  });

  it('falls back to double faults, singular when it is one', () => {
    // Errors nowhere near a mark; double faults on 24.
    const rows = normalizeRows(run('3', 1, 13, { pinkWins: true, pinkStats: [[3, 1, 2], [3, 1]] }));
    const insight = mockMilestoneInsight(contextForLast(rows))!;
    expect(insight.detail).toBe('A One is 1 double fault away from 25 for a TNT career.');
  });
});

describe('the engine', () => {
  it('returns nothing at all for an unremarkable match', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '2', { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }),
    ]);
    expect(matchInsights(contextForLast(rows))).toEqual([]);
  });

  it('caps how many reach a page, best first', () => {
    const rows = [];
    for (let r = 1; r <= 24; r++) {
      rows.push(
        ...played('3', String(r), { team: 'Pink', players: ['A One', 'B Two'], stats: [[8, 1], [3, 3]] },
                                   { team: 'Navy', players: ['C Three', 'D Four'] })
      );
    }
    const found = matchInsights(contextForLast(normalizeRows(rows)));
    expect(found.length).toBeGreaterThan(1);
    expect(found.length).toBeLessThanOrEqual(3);
    expect(found[0].weight).toBeGreaterThanOrEqual(found[found.length - 1].weight);
  });

  it('prints at most one unflattering line per match', () => {
    // A team losing every week trips several of them at once, and three of the
    // error detectors can name the same player on the same night. One is
    // banter; the whole set is a pile-on.
    const rows = loadStatRows();
    for (const m of seasonMatches(rows)) {
      const negatives = insightsFor(m, rows).filter((i) => NEGATIVE.has(i.kind));
      expect(negatives.length).toBeLessThanOrEqual(1);
    }
  });

  it('runs over every real match without throwing, and stays quiet sometimes', () => {
    const rows = loadStatRows();
    const matches = seasonMatches(rows);
    let withInsights = 0;
    for (const m of matches) {
      const found = insightsFor(m, rows);
      expect(Array.isArray(found)).toBe(true);
      if (found.length) withInsights++;
    }
    // Silence still has to be possible. The ceiling is loose because the real
    // guard is the per-detector cap below — this one only catches a detector
    // that has become so generous it swallows the whole fixture list.
    expect(withInsights).toBeGreaterThan(matches.length * 0.4);
    expect(withInsights).toBeLessThan(matches.length * 0.95);
  });

  it('keeps every detector under a third of all matches', () => {
    // The rule that actually matters, and the one "revenge match" broke when
    // it fired on 78% of the list: a label that is nearly always true says
    // nothing. Thresholds get set against this number, not by eye.
    const rows = loadStatRows();
    const matches = seasonMatches(rows);
    const CAP = 0.3;
    const detectors: [string, (ctx: ReturnType<typeof insightContext>) => unknown][] = [
      ['stakes', stakesInsight],
      ['milestone', milestoneInsight],
      ['revenge', revengeInsight],
      ['pairH2H', pairH2HInsight],
      ['firstMeeting', firstMeetingInsight],
      ['basement', basementInsight],
      ['drought', droughtInsight],
      ['lossStreak', lossStreakInsight],
      ['hoodoo', hoodooInsight],
      ['errorLeader', errorLeaderInsight],
      ['errorForm', errorFormInsight],
      ['wayward', waywardInsight],
      ['mockMilestone', mockMilestoneInsight],
    ];
    const rate = (detect: (ctx: ReturnType<typeof insightContext>) => unknown) =>
      matches.filter((m) => detect(insightContext(m, rows))).length / matches.length;

    for (const [name, detect] of detectors) {
      expect(rate(detect), `${name} fires too often`).toBeLessThanOrEqual(CAP);
    }

    // `formInsight` (45%) and `winStreakInsight` (40%) predate the cap and sit
    // above it. They are left alone rather than quietly retuned as part of a
    // change about banter — but they get a ceiling of their own so they can't
    // drift further.
    expect(rate(formInsight)).toBeLessThan(0.5);
    expect(rate(winStreakInsight)).toBeLessThan(0.5);
  });
});
