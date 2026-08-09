import { describe, expect, it } from 'vitest';
import { loadStatRows, normalizeRows } from './normalize.ts';
import { seasonMatches } from './stats.ts';
import {
  firstMeetingInsight,
  formInsight,
  insightContext,
  insightsFor,
  matchInsights,
  milestoneInsight,
  pairH2HInsight,
  revengeInsight,
  stakesInsight,
  winStreakInsight,
} from './insights.ts';

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

/** One played match, `a` beating `b` unless `aWins` says otherwise. */
function played(
  season: string,
  round: string,
  a: { team: string; players: string[]; stats?: [number, number][] },
  b: { team: string; players: string[] },
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

  it('runs over every real match without throwing, and stays quiet often', () => {
    const rows = loadStatRows();
    const matches = seasonMatches(rows);
    let withInsights = 0;
    for (const m of matches) {
      const found = insightsFor(m, rows);
      expect(Array.isArray(found)).toBe(true);
      if (found.length) withInsights++;
    }
    // An insight is optional, and has to stay that way to mean anything: a
    // label that appears on nearly every match tells a reader nothing. If this
    // starts failing, a detector has got too generous — which is exactly how
    // "revenge match" once ended up on 78% of the fixture list.
    expect(withInsights).toBeGreaterThan(matches.length * 0.4);
    expect(withInsights).toBeLessThan(matches.length * 0.85);
  });
});
