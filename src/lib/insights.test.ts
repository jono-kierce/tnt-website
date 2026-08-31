import { describe, expect, it } from 'vitest';
import { loadStatRows, normalizeRows } from './normalize.ts';
import { seasonMatches, type MatchRecord } from './stats.ts';
import type { StatRow } from './types.ts';
import {
  basementInsight,
  dominanceInsight,
  droughtInsight,
  errorFormInsight,
  errorLeaderInsight,
  formInsight,
  hoodooInsight,
  insightContext,
  insightsFor,
  lastMeetingInsight,
  lossStreakInsight,
  matchInsights,
  milestoneInsight,
  mockMilestoneInsight,
  pairH2HInsight,
  partnershipInsight,
  stakesInsight,
  waywardInsight,
  winStreakInsight,
  type InsightContext,
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

describe('last meeting', () => {
  /** A home-and-away meeting, then the same two teams in the final. */
  const thenAFinal = normalizeRows([
    ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
    ...played('3', 'F', { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Pink', players: ['A One', 'B Two'] }),
  ]);

  it('names the side that lost last time, with the scoreline', () => {
    const insight = lastMeetingInsight(contextForLast(thenAFinal))!;
    expect(insight.kind).toBe('h2h');
    expect(insight.label).toBe('Last meeting');
    expect(insight.team).toBe('Navy');
    // The scoreline lives on each side of a match, written from that side's
    // point of view — there is no match-level one to read.
    expect(insight.detail).toBe('Navy lost the last meeting in round 1, 6-4 to Pink.');
  });

  it('says nothing outside the finals', () => {
    // Every season on record is a single round-robin, so before the bracket
    // two teams have met exactly once — never twice. This used to be
    // "Revenge match" and fired on 0 of 179 home-and-away matches while
    // reading a healthy 13% against the whole fixture list.
    const homeAndAway = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', '5', { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Pink', players: ['A One', 'B Two'] }),
    ]);
    expect(lastMeetingInsight(contextForLast(homeAndAway))).toBe(null);
  });

  it('does not look back past the redraft', () => {
    // Same two colours, a season apart — and, by then, a different ten players
    // apiece. Wearing the colour of a grudge is not having one.
    const acrossSeasons = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('4', 'F', { team: 'Navy', players: ['E Five', 'F Six'] }, { team: 'Pink', players: ['G 7', 'H 8'] }),
    ]);
    expect(lastMeetingInsight(contextForLast(acrossSeasons))).toBe(null);
  });

  it('says nothing when the teams have never met', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
      ...played('3', 'F', { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }),
    ]);
    expect(lastMeetingInsight(contextForLast(rows))).toBe(null);
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
  /** Three rounds where Pink and Navy each beat a different team. */
  const threeRoundsClear = () => {
    const rows = [];
    for (let r = 1; r <= 3; r++) {
      rows.push(...played('3', String(r), { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }));
      rows.push(...played('3', String(r), { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'White', players: ['G 7', 'H 8'] }));
    }
    return rows;
  };

  it('leads with two unbeaten sides', () => {
    const rows = threeRoundsClear();
    rows.push(...played('3', '4', { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Pink', players: ['A One', 'B Two'] }));
    const insight = stakesInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight.label).toBe('Unbeaten clash');
    expect(insight.detail).toMatch(/both arrive with a perfect record/);
    // Above the winner-goes-top line it replaces: it is the same match with
    // more at stake, and reading rank alone can't see it.
    expect(insight.weight).toBeGreaterThan(75);
  });

  it('spots a winner-goes-top match when one side has dropped one', () => {
    const rows = threeRoundsClear();
    // Navy lose their fourth; the two meet in round five, Pink 3–0, Navy 3–1.
    rows.push(...played('3', '4', { team: 'White', players: ['G 7', 'H 8'] }, { team: 'Navy', players: ['C Three', 'D Four'] }));
    rows.push(...played('3', '5', { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Pink', players: ['A One', 'B Two'] }));
    const insight = stakesInsight(contextForLast(normalizeRows(rows)))!;
    expect(insight.label).toBe('Top spot');
    expect(insight.detail).toMatch(/go top of the ladder with a win/);
  });

  it('stays quiet in the opening rounds, when a ladder means nothing', () => {
    const rows = normalizeRows([
      ...played('3', '1', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Red', players: ['E Five', 'F Six'] }),
      ...played('3', '2', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }),
    ]);
    expect(stakesInsight(contextForLast(rows))).toBe(null);
  });

  it('only claims a finals cutoff when the season declares a bracket', () => {
    // Six teams over four rounds, arranged to finish Pink 4–0, Navy 3–1,
    // Red 2–2, White 2–2, Black 1–3, Green 0–4 — so 4th plays 6th in round
    // five, either side of a top-four bracket.
    const field = ['Pink', 'Navy', 'Red', 'White', 'Green', 'Black'];
    const P = { team: 'Pink', players: ['A One', 'B Two'] };
    const N = { team: 'Navy', players: ['C Three', 'D Four'] };
    const R = { team: 'Red', players: ['E Five', 'F Six'] };
    const W = { team: 'White', players: ['G 7', 'H 8'] };
    const G = { team: 'Green', players: ['I 9', 'J 10'] };
    const B = { team: 'Black', players: ['K 11', 'L 12'] };
    const rows = [
      ...played('3', '1', P, B), ...played('3', '1', N, G), ...played('3', '1', R, W),
      ...played('3', '2', P, G), ...played('3', '2', N, B), ...played('3', '2', W, R),
      ...played('3', '3', P, W), ...played('3', '3', R, G), ...played('3', '3', N, B),
      ...played('3', '4', P, R), ...played('3', '4', W, G), ...played('3', '4', B, N),
      ...played('3', '5', W, G),
    ];
    const norm = normalizeRows(rows);
    const last = seasonMatches(norm).at(-1)!;

    const withBracket = stakesInsight(
      insightContext(last, norm, { declaredTeams: field, finalsCutoff: 4 })
    )!;
    expect(withBracket.label).toBe('Finals race');
    // The number comes from the bracket, and so does the word in the sentence.
    expect(withBracket.detail).toBe(
      'Green (6th) are chasing White (4th) for a place in the top 4.'
    );

    // No bracket declared, no claim made — the old code assumed 8, which was
    // right every season so far by luck rather than by wiring.
    expect(stakesInsight(insightContext(last, norm, { declaredTeams: field }))).toBe(null);
  });
});

describe('the next-round gate', () => {
  /**
   * Every unplayed fixture in a drawn season shares one window, because
   * nothing between them has been played. Left ungated, a round 10 page in
   * August reported a round 2 ladder.
   */
  const drawnSeason = () => {
    const rows = [];
    // Rounds 1 and 2 played: Pink win both, Navy lose both.
    for (let r = 1; r <= 2; r++) {
      rows.push(...played('5', String(r), { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }));
      rows.push(...played('5', String(r), { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }));
    }
    // Rounds 3 and 9 drawn but unplayed — every RESULT column blank.
    for (const r of ['3', '9']) {
      for (const [team, opp, players] of [
        ['Navy', 'Red', ['C Three', 'D Four']],
        ['Red', 'Navy', ['E Five', 'F Six']],
      ] as const) {
        for (const player of players) {
          rows.push(raw({
            Team: team, Opponent: opp, Season: '5', Round: r, Player: player,
            Score: '', 'Team Score': '', 'Opponent Score': '', 'win?': '',
          }));
        }
      }
    }
    return normalizeRows(rows);
  };

  it('speaks about the season for the next round up, and not beyond it', () => {
    const rows = drawnSeason();
    const fixtures = seasonMatches(rows).filter((m) => m.scheduled);
    const next = fixtures.find((m) => m.round === 3)!;
    const distant = fixtures.find((m) => m.round === 9)!;

    const nextUp = droughtInsight(insightContext(next, rows));
    expect(nextUp?.detail).toBe('Navy are 0–2 for the season and still chasing a first win.');

    // Same window, seven rounds later. "0–2 for the season" is not a thing to
    // print on a fixture in October.
    expect(droughtInsight(insightContext(distant, rows))).toBe(null);
  });

  it('leaves career-window lines alone at any distance', () => {
    // A win streak is as true in October as it is next Tuesday, so the gate
    // deliberately doesn't touch it.
    const rows = drawnSeason();
    const distant = seasonMatches(rows).find((m) => m.scheduled && m.round === 9)!;
    const ctx = insightContext(distant, rows);
    expect(ctx.history.length).toBeGreaterThan(0);
    expect(() => winStreakInsight(ctx)).not.toThrow();
  });

  it('never gags a played match', () => {
    // A played match's own round is always the latest in its own window, so
    // no historical page changes.
    const rows = loadStatRows();
    for (const m of seasonMatches(rows).filter((x) => !x.scheduled)) {
      const ctx = insightContext(m, rows);
      expect(() => droughtInsight(ctx)).not.toThrow();
    }
    // Concretely: the drought lines that exist on played matches still exist.
    const played = seasonMatches(rows).filter((m) => !m.scheduled);
    const droughts = played.filter((m) => droughtInsight(insightContext(m, rows)));
    expect(droughts.length).toBeGreaterThan(0);
  });
});

describe('partnership', () => {
  it('reports a pair with a real record together', () => {
    const rows = normalizeRows(run('3', 1, 6, { pinkWins: true }));
    const insight = partnershipInsight(contextForLast(rows))!;
    expect(insight.label).toBe('Proven pair');
    expect(insight.detail).toBe('A. One & B. Two have won 5 of their 5 matches together.');
    expect(insight.team).toBe('Pink');
  });

  it('says nothing about a brand-new pairing', () => {
    // The trap that killed `firstMeetingInsight`: the draft remakes ten
    // pairings at a stroke, so "first time together" is true of nearly
    // everyone in round one and says nothing.
    const rows = normalizeRows([
      ...run('3', 1, 5, { pinkWins: true }),
      // Both pairs remade — nobody in this match has a history with the man
      // beside him, which is what round one of every season looks like.
      ...played('4', '1', { team: 'Pink', players: ['A One', 'C Three'] },
                            { team: 'Navy', players: ['B Two', 'D Four'] }),
    ]);
    expect(partnershipInsight(contextForLast(rows))).toBe(null);
  });

  it('says nothing about a pair with a coin-flip record', () => {
    const rows = normalizeRows([
      ...run('3', 1, 3, { pinkWins: true }),
      ...run('3', 4, 6, { pinkWins: false }),
      ...run('3', 7, 7, { pinkWins: true }),
    ]);
    expect(partnershipInsight(contextForLast(rows))).toBe(null);
  });
});

describe('dominance', () => {
  const field = ['Pink', 'Navy', 'Red', 'White', 'Green', 'Black'];

  it('names a team miles clear on games', () => {
    const rows = [];
    // Pink win 6-0 every week; everybody else trades 6-4.
    for (let r = 1; r <= 3; r++) {
      rows.push(...played('3', String(r), { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Green', players: ['I 9', 'J 10'] })
        .map((row) => ({ ...row, Score: row.Team === 'Pink' ? '6-0' : '0-6',
                         'Team Score': row.Team === 'Pink' ? '6' : '0',
                         'Opponent Score': row.Team === 'Pink' ? '0' : '6' })));
      rows.push(...played('3', String(r), { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Black', players: ['K 11', 'L 12'] }));
      rows.push(...played('3', String(r), { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }));
    }
    rows.push(...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }));
    const norm = normalizeRows(rows);
    const ctx = insightContext(seasonMatches(norm).at(-1)!, norm, { declaredTeams: field });
    const insight = dominanceInsight(ctx)!;
    expect(insight.label).toBe('Steamrolling');
    expect(insight.detail).toBe('Pink have won 18 games to 0 this season — comfortably the best return in the league.');
    expect(insight.team).toBe('Pink');
  });

  it('says nothing when the league is close', () => {
    const rows = [];
    for (let r = 1; r <= 3; r++) {
      rows.push(...played('3', String(r), { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Green', players: ['I 9', 'J 10'] }));
      rows.push(...played('3', String(r), { team: 'Navy', players: ['C Three', 'D Four'] }, { team: 'Black', players: ['K 11', 'L 12'] }));
      rows.push(...played('3', String(r), { team: 'Red', players: ['E Five', 'F Six'] }, { team: 'White', players: ['G 7', 'H 8'] }));
    }
    rows.push(...played('3', '4', { team: 'Pink', players: ['A One', 'B Two'] }, { team: 'Navy', players: ['C Three', 'D Four'] }));
    const norm = normalizeRows(rows);
    const ctx = insightContext(seasonMatches(norm).at(-1)!, norm, { declaredTeams: field });
    expect(dominanceInsight(ctx)).toBe(null);
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
    // Four losses to end one season, then a new one. The season bound is
    // tuning, not principle — see the note on `lossStreakInsight` — but it is
    // the behaviour, so it is tested.
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
    const ctx = insightContext(seasonMatches(normalizeRows(rows)).at(-1)!, normalizeRows(rows), {
      declaredTeams: field,
    });
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
    const ctx = insightContext(seasonMatches(norm).at(-1)!, norm, { declaredTeams: field });
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

  it('keeps every detector under a third of the matches it can reach', () => {
    // The rule that actually matters, and the one "revenge match" broke twice.
    //
    // First it fired on 78% of the fixture list by looking back across
    // seasons, which is what a label that is nearly always true looks like.
    // Then the fix — a season-scoped window — made it fire on 28 of 28 finals
    // and 0 of 179 home-and-away matches, and THIS TEST DID NOT NOTICE,
    // because dividing 28 by all 215 matches reads a comfortable 13%.
    //
    // So a detector is measured against the matches it can actually reach.
    // A finals-only detector is judged on finals; one that needs four rounds
    // of ladder is judged on the matches that have them. Thresholds get set
    // against these numbers, not by eye.
    const rows = loadStatRows();
    const matches = seasonMatches(rows);
    const CAP = 0.3;

    const anyMatch = () => true;
    const homeAndAway = (m: MatchRecord) => !m.isFinals;
    const finals = (m: MatchRecord) => m.isFinals;
    /** Home-and-away matches late enough to have a ladder worth reading. */
    const withLadder = (m: MatchRecord) => !m.isFinals && m.round >= 4;

    const detectors: [string, (ctx: InsightContext) => unknown, (m: MatchRecord) => boolean][] = [
      ['stakes', stakesInsight, withLadder],
      ['milestone', milestoneInsight, anyMatch],
      ['form', formInsight, anyMatch],
      ['partnership', partnershipInsight, anyMatch],
      ['pairH2H', pairH2HInsight, anyMatch],
      ['dominance', dominanceInsight, withLadder],
      ['basement', basementInsight, withLadder],
      ['drought', droughtInsight, homeAndAway],
      ['lossStreak', lossStreakInsight, homeAndAway],
      ['hoodoo', hoodooInsight, anyMatch],
      ['errorLeader', errorLeaderInsight, withLadder],
      ['errorForm', errorFormInsight, anyMatch],
      ['wayward', waywardInsight, anyMatch],
      ['mockMilestone', mockMilestoneInsight, anyMatch],
    ];

    for (const [name, detect, reachable] of detectors) {
      const pool = matches.filter(reachable);
      const fired = pool.filter((m) => detect(insightContext(m, rows))).length;
      expect(fired / pool.length, `${name} fires too often`).toBeLessThanOrEqual(CAP);
    }

    // `winStreakInsight` (34%) is the last detector predating the cap and is
    // left over it deliberately. `formInsight` used to be the other, at 40%,
    // and was retuned rather than kept: it had drifted to two thirds of S5's
    // played matches and was the only line on half the fixture list, which
    // makes a detector the noise floor rather than an exception. This one has
    // not drifted, and "on a run" is the positive counterpart to `lossStreak`,
    // so it keeps its exemption — and a ceiling of its own, so it can't move.
    const streakRate =
      matches.filter((m) => winStreakInsight(insightContext(m, rows))).length / matches.length;
    expect(streakRate).toBeGreaterThan(CAP);
    expect(streakRate).toBeLessThan(0.4);
  });

  it('lets the one fact-shaped line fire as often as the fact is true', () => {
    // `lastMeetingInsight` fires on every final, and that is the point: two
    // teams always meet before the bracket in a single round-robin, and how
    // that meeting went is the thing everyone wants to know before a final.
    // It is exempt from the cap above because it claims a fact rather than a
    // story — the same way a scoreline does — and its weight (50) keeps it out
    // of the lead. The exemption is written down here rather than assumed.
    const rows = loadStatRows();
    const finals = seasonMatches(rows).filter((m) => m.isFinals);
    const fired = finals.filter((m) => lastMeetingInsight(insightContext(m, rows)));
    expect(fired.length).toBe(finals.length);

    // And it stays out of the home-and-away, where it would be a grudge story
    // about two sets of players who have never met.
    const homeAndAway = seasonMatches(rows).filter((m) => !m.isFinals);
    expect(homeAndAway.filter((m) => lastMeetingInsight(insightContext(m, rows)))).toEqual([]);
  });

  it('never names the same player twice in one panel', () => {
    // 26% of multi-line panels used to. One of them had a man arriving on
    // nine straight wins and spraying errors in the same breath.
    const rows = loadStatRows();
    const everyone = new Set(rows.map((r) => r.player));
    for (const m of seasonMatches(rows)) {
      const found = insightsFor(m, rows);
      const subjects = found.map((i) => i.subject).filter((p): p is string => !!p);
      expect(new Set(subjects).size, `${m.season} ${m.roundLabel} ${m.key}`).toBe(subjects.length);

      // `subject` has to be the name the sentence actually uses, or the cap is
      // policing the wrong thing.
      for (const i of found) {
        if (i.subject) {
          expect(everyone.has(i.subject)).toBe(true);
          expect(i.detail).toContain(i.subject);
        }
      }
    }
  });

  it('says nothing about the season on a fixture that is rounds away', () => {
    // The whole unplayed draw shares one window, so without `isNextUp` a
    // round 10 page reports the round 2 ladder.
    const rows = loadStatRows();
    const fixtures = seasonMatches(rows).filter((m) => m.scheduled);
    if (!fixtures.length) return;

    const seasons = new Set(fixtures.map((m) => m.season));
    for (const season of seasons) {
      const played = seasonMatches(rows).filter((m) => m.season === season && !m.scheduled && !m.isFinals);
      const latest = played.reduce((n, m) => Math.max(n, m.round), 0);
      const distant = fixtures.filter((m) => m.season === season && m.round > latest + 1);
      for (const m of distant) {
        const ctx = insightContext(m, rows, { declaredTeams: declaredTeamsOf(rows, season) });
        for (const detect of [stakesInsight, droughtInsight, basementInsight, dominanceInsight, errorLeaderInsight]) {
          expect(detect(ctx), `${season} R${m.roundLabel} ${m.key}`).toBe(null);
        }
      }
    }
  });
});

/** The teams a season's rows know about — the test's stand-in for the config. */
function declaredTeamsOf(rows: StatRow[], season: number): string[] {
  return [...new Set(rows.filter((r) => r.season === season).map((r) => r.team))];
}
