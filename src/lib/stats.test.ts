import { describe, expect, it } from 'vitest';
import { loadStatRows, normalizeRows, parseScore } from './normalize.ts';
import {
  bestWorstOpponent,
  fillInRecord,
  fillInVotes,
  headToHead,
  ladder,
  ladderWithPairings,
  leaderboard,
  matchSides,
  perSet,
  playerAgg,
  records,
  teamRoster,
  winStreaks,
} from './stats.ts';
import { canonicalName, shortName, stripFillIn } from '../config/aliases.ts';
import { allSeasonConfigs } from '../config/seasons/index.ts';
import type { FinalsSlot } from '../config/seasons/schema.ts';

/** Helper to build a raw CSV record object. */
function raw(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Team: '', Opponent: '', Season: '', Round: '', Score: '', Player: '',
    Aces: '0', 'Unforced Errors': '0', 'Forced Errors': '0',
    '1st Serve In': '', '1st Serve Out': '', 'Double Faults': '0',
    Winners: '0', 'Errors Forced': '', 'win?': 'FALSE',
    'Team Score': '0', 'Opponent Score': '0', votes: '',
    ...o,
  };
}

describe('name merging', () => {
  it('strips (Fill-in) and flags it', () => {
    expect(stripFillIn('Jonathan Kierce (Fill-in)')).toEqual({
      name: 'Jonathan Kierce',
      isFillIn: true,
    });
    expect(stripFillIn('Adam Dickson')).toEqual({
      name: 'Adam Dickson',
      isFillIn: false,
    });
  });

  it('merges known aliases', () => {
    expect(canonicalName('Lachie Jenkin')).toBe('Lachlan Jenkin');
    expect(canonicalName('James Papa')).toBe('Jim Papa');
    expect(canonicalName('Luke Sharrock')).toBe('Luke Sharrock');
  });

  it('normalization merges alias + fill-in onto one canonical player', () => {
    const rows = normalizeRows([
      raw({ Team: 'Red', Season: '3', Round: '1', Player: 'Lachie Jenkin', Winners: '5' }),
      raw({ Team: 'Red', Season: '3', Round: '2', Player: 'Lachlan Jenkin (Fill-in)', Winners: '3' }),
    ]);
    expect(rows.map((r) => r.player)).toEqual(['Lachlan Jenkin', 'Lachlan Jenkin']);
    expect(rows[1].isFillIn).toBe(true);
    const agg = playerAgg('Lachlan Jenkin', rows, { includeFillIns: true });
    expect(agg.winners).toBe(8);
    const noFill = playerAgg('Lachlan Jenkin', rows);
    expect(noFill.winners).toBe(5); // fill-in excluded by default
  });

  it('reports the fill-in record a season panel leaves out', () => {
    const rows = normalizeRows([
      raw({ Team: 'Red', Season: '3', Round: '1', Player: 'Lachlan Jenkin', 'win?': 'TRUE' }),
      raw({ Team: 'Navy', Season: '3', Round: '2', Player: 'Lachlan Jenkin (Fill-in)', 'win?': 'TRUE' }),
      raw({ Team: 'Navy', Season: '3', Round: '3', Player: 'Lachlan Jenkin (Fill-in)', 'win?': 'FALSE' }),
      raw({ Team: 'Navy', Season: '3', Round: 'F', Score: '6-4 6-2', Player: 'Lachlan Jenkin (Fill-in)', 'win?': 'TRUE' }),
      raw({ Team: 'Navy', Season: '4', Round: '1', Player: 'Lachlan Jenkin (Fill-in)', 'win?': 'TRUE' }),
    ]);
    // Split the way the two win-rate tiles are, so each owns up to its own.
    expect(fillInRecord('Lachlan Jenkin', rows, 3, 'regular')).toEqual({ matches: 2, wins: 1, losses: 1 });
    expect(fillInRecord('Lachlan Jenkin', rows, 3, 'finals')).toEqual({ matches: 1, wins: 1, losses: 0 });
    expect(fillInRecord('Lachlan Jenkin', rows, 3)).toEqual({ matches: 3, wins: 2, losses: 1 });
    // No season given: the whole career, which is where fill-ins do count.
    expect(fillInRecord('Lachlan Jenkin', rows)).toEqual({ matches: 4, wins: 3, losses: 1 });
  });

  it('counts the votes won while filling in, so the panel can set them aside', () => {
    const rows = normalizeRows([
      raw({ Team: 'Red', Season: '3', Round: '1', Player: 'Lachlan Jenkin', votes: '4' }),
      raw({ Team: 'Navy', Season: '3', Round: '2', Player: 'Lachlan Jenkin (Fill-in)', votes: '6' }),
      raw({ Team: 'Navy', Season: '3', Round: '3', Player: 'Lachlan Jenkin (Fill-in)', votes: '' }),
      raw({ Team: 'Navy', Season: '3', Round: 'F', Score: '6-4 6-2', Player: 'Lachlan Jenkin (Fill-in)', votes: '3' }),
    ]);
    expect(fillInVotes('Lachlan Jenkin', rows, 3, 'regular')).toBe(6); // blank is not zero
    expect(fillInVotes('Lachlan Jenkin', rows, 3, 'finals')).toBe(3);
    expect(fillInVotes('Lachlan Jenkin', rows)).toBe(9);
    // The tally itself never sees them, in any window.
    expect(playerAgg('Lachlan Jenkin', rows, { scope: 'regular' }).votes).toBe(4);
  });

  it('produces broadcast short names', () => {
    expect(shortName('Angus Hume')).toBe('A. Hume');
    expect(shortName('Luke Sharrock')).toBe('L. Sharrock');
  });
});

describe('ladder math', () => {
  const rows = normalizeRows([
    // R1: A beats B 6-2
    raw({ Team: 'Pink', Opponent: 'Navy', Season: '1', Round: '1', Player: 'P1', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '2' }),
    raw({ Team: 'Navy', Opponent: 'Pink', Season: '1', Round: '1', Player: 'N1', 'win?': 'FALSE', 'Team Score': '2', 'Opponent Score': '6' }),
    // R2: A beats C 6-4
    raw({ Team: 'Pink', Opponent: 'Red', Season: '1', Round: '2', Player: 'P1', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '4' }),
    raw({ Team: 'Red', Opponent: 'Pink', Season: '1', Round: '2', Player: 'R1', 'win?': 'FALSE', 'Team Score': '4', 'Opponent Score': '6' }),
    // R3: B beats C 6-1
    raw({ Team: 'Navy', Opponent: 'Red', Season: '1', Round: '3', Player: 'N1', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '1' }),
    raw({ Team: 'Red', Opponent: 'Navy', Season: '1', Round: '3', Player: 'R1', 'win?': 'FALSE', 'Team Score': '1', 'Opponent Score': '6' }),
  ]);

  it('collapses player rows to one side per match', () => {
    expect(matchSides(rows, 1)).toHaveLength(6);
  });

  it('ranks by wins then games ratio', () => {
    const t = ladder(1, rows);
    expect(t.map((r) => r.team)).toEqual(['Pink', 'Navy', 'Red']);
    expect(t[0]).toMatchObject({ wins: 2, gamesFor: 12, gamesAgainst: 6 });
    expect(t[0].ratio).toBeCloseTo(2.0);
    // Navy and Red both 1 win; Navy ratio 8/7 > Red ... Red 5/12
    expect(t[1].team).toBe('Navy');
    expect(t[2].team).toBe('Red');
  });

  it('orders equal-win teams by ratio, not alphabetically', () => {
    // Two 1-win teams: Zeta (ratio 2.0) should beat Alpha (ratio 0.5)
    const r2 = normalizeRows([
      raw({ Team: 'Zeta', Opponent: 'Mid', Season: '2', Round: '1', Player: 'z', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '3' }),
      raw({ Team: 'Mid', Opponent: 'Zeta', Season: '2', Round: '1', Player: 'm', 'win?': 'FALSE', 'Team Score': '3', 'Opponent Score': '6' }),
      raw({ Team: 'Alpha', Opponent: 'Mid', Season: '2', Round: '2', Player: 'a', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '5' }),
      raw({ Team: 'Mid', Opponent: 'Alpha', Season: '2', Round: '2', Player: 'm', 'win?': 'FALSE', 'Team Score': '5', 'Opponent Score': '6' }),
      // give Alpha a bad loss to sink ratio below Zeta
      raw({ Team: 'Alpha', Opponent: 'Zeta', Season: '2', Round: '3', Player: 'a', 'win?': 'FALSE', 'Team Score': '1', 'Opponent Score': '6' }),
      raw({ Team: 'Zeta', Opponent: 'Alpha', Season: '2', Round: '3', Player: 'z', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '1' }),
    ]);
    const t = ladder(2, r2);
    expect(t[0].team).toBe('Zeta'); // 2 wins
    expect(t[1].team).toBe('Alpha'); // 1 win
  });

  describe('ladderWithPairings', () => {
    it('labels each row with its pairing and keeps ladder order', () => {
      const t = ladderWithPairings(1, rows);
      expect(t.map((r) => r.team)).toEqual(ladder(1, rows).map((r) => r.team));
      // One player per team here, so the derived label is that player alone —
      // and crucially not the bare team colour that `ladder` falls back to.
      expect(t.map((r) => r.pairingName)).toEqual(['P1', 'N1', 'R1']);
      expect(ladder(1, rows).map((r) => r.pairingName)).toEqual(['Pink', 'Navy', 'Red']);
      expect(t.map((r) => r.rank)).toEqual([1, 2, 3]);
    });

    it('takes the pairing order from the season config, captain first', () => {
      const r = normalizeRows([
        raw({ Team: 'Pink', Opponent: 'Navy', Season: '1', Round: '1', Player: 'Angus Hume', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '2' }),
        raw({ Team: 'Pink', Opponent: 'Navy', Season: '1', Round: '1', Player: 'Luke Sharrock', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '2' }),
        raw({ Team: 'Pink', Opponent: 'Navy', Season: '1', Round: '2', Player: 'Angus Hume', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '2' }),
        raw({ Team: 'Pink', Opponent: 'Navy', Season: '1', Round: '2', Player: 'Luke Sharrock', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '2' }),
        raw({ Team: 'Navy', Opponent: 'Pink', Season: '1', Round: '1', Player: 'N1', 'Team Score': '2', 'Opponent Score': '6' }),
        raw({ Team: 'Navy', Opponent: 'Pink', Season: '1', Round: '2', Player: 'N1', 'Team Score': '2', 'Opponent Score': '6' }),
      ]);
      // Hume has the alphabetical edge and equal games; the config's order wins.
      const withConfig = ladderWithPairings(1, r, (team) =>
        team === 'Pink' ? { pair: ['Luke Sharrock', 'Angus Hume'] } : undefined
      );
      expect(withConfig[0].pairingName).toBe('L. Sharrock & A. Hume');
      expect(ladderWithPairings(1, r)[0].pairingName).toBe('A. Hume & L. Sharrock');
    });

    it('gives the ladder as it stood, when handed a mid-season slice', () => {
      // Rounds 1-2 only. Navy's round-3 win hasn't happened yet, so it can't
      // have lifted them above Red — and on games ratio alone (2/6 v 4/6) the
      // team that beat them in round 3 is the one sitting last.
      const upTo2 = rows.filter((row) => row.round <= 2);
      const t = ladderWithPairings(1, upTo2);
      expect(t.map((r) => [r.team, r.wins, r.matchesPlayed])).toEqual([
        ['Pink', 2, 2],
        ['Red', 0, 1],
        ['Navy', 0, 1],
      ]);
      // ...whereas the full season has Navy second on that round-3 win.
      expect(ladderWithPairings(1, rows).map((r) => r.team)).toEqual([
        'Pink',
        'Navy',
        'Red',
      ]);
    });
  });
});

describe('votes-era handling', () => {
  it('treats blank votes as null (sealed), not zero', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Season: '4', Round: '1', Player: 'X', votes: '' }),
      raw({ Team: 'Pink', Season: '4', Round: '2', Player: 'X', votes: '' }),
    ]);
    const agg = playerAgg('X', rows);
    expect(agg.votes).toBeNull();
    expect(agg.votesPerGame).toBeNull();
    expect(agg.tally.votes.games).toBe(0);
  });

  it('averages votes only over games where votes were recorded', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Season: '2', Round: '1', Player: 'X', votes: '6' }),
      raw({ Team: 'Pink', Season: '2', Round: '2', Player: 'X', votes: '' }), // unrecorded
      raw({ Team: 'Pink', Season: '2', Round: '3', Player: 'X', votes: '2' }),
    ]);
    const agg = playerAgg('X', rows);
    expect(agg.votes).toBe(8);
    expect(agg.tally.votes.games).toBe(2);
    expect(agg.votesPerGame).toBe(4);
  });

  it('era-adjusts S1 votes (2→6, 1→4) in cross-era windows only', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Season: '1', Round: '1', Player: 'X', votes: '2' }),
      raw({ Team: 'Pink', Season: '1', Round: '2', Player: 'X', votes: '1' }),
      raw({ Team: 'Pink', Season: '1', Round: '3', Player: 'X', votes: '0' }),
      raw({ Team: 'Pink', Season: '2', Round: '1', Player: 'X', votes: '6' }),
    ]);
    expect(rows.map((r) => r.adjustedVotes)).toEqual([6, 4, 0, 6]);
    // No season given: the career window, counted on the modern scale.
    const career = playerAgg('X', rows);
    expect(career.votes).toBe(16);
    expect(career.votesPerGame).toBe(4);
    expect(career.votesEraAdjusted).toBe(true);
    // A season window shows the votes as cast.
    const s1 = playerAgg('X', rows, { season: 1 });
    expect(s1.votes).toBe(3);
    expect(s1.votesPerGame).toBe(1);
    expect(s1.votesEraAdjusted).toBe(false);
  });

  it('never rescales finals votes, blanks, or later seasons', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '1', Round: 'F', Score: '6-4', Player: 'X', votes: '2' }),
      raw({ Team: 'Pink', Season: '1', Round: '1', Player: 'X', votes: '' }),
      raw({ Team: 'Pink', Season: '3', Round: '1', Player: 'X', votes: '2' }),
    ]);
    expect(rows.map((r) => r.adjustedVotes)).toEqual([2, null, 2]);
  });

  it('era-adjusts the all-time votes board but not a season board', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Season: '1', Round: '1', Player: 'Old', votes: '2' }),
      raw({ Team: 'Navy', Season: '2', Round: '1', Player: 'New', votes: '5' }),
    ]);
    expect(leaderboard('votes', rows).map((e) => [e.player, e.value])).toEqual([
      ['Old', 6],
      ['New', 5],
    ]);
    expect(leaderboard('votes', rows, { season: 1 })[0].value).toBe(2);
  });

  it('sets aside fill-in votes in the currency of the window', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Season: '1', Round: '1', Player: 'X (Fill-in)', votes: '2' }),
    ]);
    expect(fillInVotes('X', rows)).toBe(6); // career: era-adjusted
    expect(fillInVotes('X', rows, 1)).toBe(2); // season: as cast
  });
});

describe('era-specific stats', () => {
  it('serve stats only exist in Season 1', () => {
    const s1 = normalizeRows([
      raw({ Team: 'Pink', Season: '1', Round: '1', Player: 'X', '1st Serve In': '8', '1st Serve Out': '2' }),
    ]);
    expect(s1[0].firstServeIn).toBe(8);
    expect(playerAgg('X', s1).servePct).toBeCloseTo(0.8);

    // stray serve values in a later season are ignored
    const s3 = normalizeRows([
      raw({ Team: 'Pink', Season: '3', Round: '1', Player: 'X', '1st Serve In': '8', '1st Serve Out': '2' }),
    ]);
    expect(s3[0].firstServeIn).toBeNull();
    expect(playerAgg('X', s3).servePct).toBeNull();
  });

  it('Errors Forced is null in Season 1, counted from Season 2', () => {
    const s1 = normalizeRows([
      raw({ Team: 'Pink', Season: '1', Round: '1', Player: 'X', 'Errors Forced': '5' }),
    ]);
    expect(s1[0].errorsForced).toBeNull();
    expect(playerAgg('X', s1).errorsForced).toBeNull();

    const s2 = normalizeRows([
      raw({ Team: 'Pink', Season: '2', Round: '1', Player: 'X', 'Errors Forced': '5' }),
    ]);
    expect(s2[0].errorsForced).toBe(5);
    expect(playerAgg('X', s2).errorsForced).toBe(5);
  });
});

describe('SINGLES GAME handling', () => {
  it('excludes SINGLES GAME from player stats but keeps the match', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Opponent: 'Navy', Season: '2', Round: '1', Player: 'SINGLES GAME', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '3' }),
    ]);
    expect(rows[0].isSingles).toBe(true);
    expect(matchSides(rows, 2)).toHaveLength(1); // counts for ladder
    const t = ladder(2, rows);
    expect(t[0]).toMatchObject({ team: 'Pink', wins: 1, gamesFor: 6 });
  });
});

describe('roster derivation', () => {
  it('picks the regular pair over one-off subs the CSV did not flag', () => {
    // Two mains play every round; three subs play one round each (unflagged).
    const rows = normalizeRows([
      ...Array.from({ length: 6 }, (_, i) =>
        raw({ Team: 'Navy', Season: '4', Round: String(i + 1), Player: 'Jackson Virgona' })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        raw({ Team: 'Navy', Season: '4', Round: String(i + 1), Player: 'Lachlan Jenkin' })
      ),
      raw({ Team: 'Navy', Season: '4', Round: '1', Player: 'Jimmy Gorton' }),
      raw({ Team: 'Navy', Season: '4', Round: '2', Player: 'Ed Simpson' }),
      raw({ Team: 'Navy', Season: '4', Round: '3', Player: 'Emerson Wise' }),
    ]);
    const r = teamRoster('Navy', 4, rows);
    expect(r.core.map((c) => c.player)).toEqual(['Jackson Virgona', 'Lachlan Jenkin']);
    expect(r.pairingName).toBe('J. Virgona & L. Jenkin');
  });

  it('honours a config pairing override', () => {
    const rows = normalizeRows([
      raw({ Team: 'Navy', Season: '4', Round: '1', Player: 'Jackson Virgona' }),
    ]);
    const r = teamRoster('Navy', 4, rows, {
      pair: ['Lachlan Jenkin', 'Jackson Virgona'],
      captain: 'Lachlan Jenkin',
    });
    expect(r.pairingName).toBe('L. Jenkin & J. Virgona');
    expect(r.captain).toBe('Lachlan Jenkin');
  });
});

describe('BOG derivation (from votes)', () => {
  // One fixture = both sides of a (season, round, {team, opponent}) pairing.
  const fixture = (rows: { player: string; team: string; opp: string; votes: string; fill?: boolean }[]) =>
    normalizeRows(
      rows.map((r) =>
        raw({
          Team: r.team, Opponent: r.opp, Season: '4', Round: '1',
          Player: r.fill ? `${r.player} (Fill-in)` : r.player, votes: r.votes,
        })
      )
    );

  it('flags the top vote-getter across BOTH sides of the match', () => {
    const rows = fixture([
      { player: 'Winner Guy', team: 'Pink', opp: 'Navy', votes: '6' },
      { player: 'Mid Pink', team: 'Pink', opp: 'Navy', votes: '2' },
      { player: 'Mid Navy', team: 'Navy', opp: 'Pink', votes: '4' },
      { player: 'Low Navy', team: 'Navy', opp: 'Pink', votes: '0' },
    ]);
    expect(rows.filter((r) => r.bog).map((r) => r.player)).toEqual(['Winner Guy']);
  });

  it('shares BOG on a tie', () => {
    const rows = fixture([
      { player: 'A', team: 'Pink', opp: 'Navy', votes: '5' },
      { player: 'B', team: 'Navy', opp: 'Pink', votes: '5' },
      { player: 'C', team: 'Navy', opp: 'Pink', votes: '1' },
    ]);
    expect(rows.filter((r) => r.bog).map((r) => r.player).sort()).toEqual(['A', 'B']);
  });

  it('no BOG when votes are unrecorded or all zero', () => {
    const blank = fixture([
      { player: 'A', team: 'Pink', opp: 'Navy', votes: '' },
      { player: 'B', team: 'Navy', opp: 'Pink', votes: '' },
    ]);
    expect(blank.some((r) => r.bog)).toBe(false);
    const zeros = fixture([
      { player: 'A', team: 'Pink', opp: 'Navy', votes: '0' },
      { player: 'B', team: 'Navy', opp: 'Pink', votes: '0' },
    ]);
    expect(zeros.some((r) => r.bog)).toBe(false);
  });

  it('a fill-in can win BOG', () => {
    const rows = fixture([
      { player: 'Sub', team: 'Pink', opp: 'Navy', votes: '6', fill: true },
      { player: 'Reg', team: 'Navy', opp: 'Pink', votes: '3' },
    ]);
    expect(rows.filter((r) => r.bog).map((r) => r.player)).toEqual(['Sub']);
  });
});

describe('head to head', () => {
  /** One round: Hero (Pink) vs `opp` (Navy), scored from Hero's side. */
  const meeting = (
    round: number,
    opp: string,
    heroScore: number,
    oppScore: number,
    fill: { hero?: boolean; opp?: boolean } = {}
  ) => [
    raw({
      Team: 'Pink', Opponent: 'Navy', Season: '4', Round: String(round),
      Player: fill.hero ? 'Hero (Fill-in)' : 'Hero',
      'win?': heroScore > oppScore ? 'TRUE' : 'FALSE',
      'Team Score': String(heroScore), 'Opponent Score': String(oppScore),
    }),
    raw({
      Team: 'Navy', Opponent: 'Pink', Season: '4', Round: String(round),
      Player: fill.opp ? `${opp} (Fill-in)` : opp,
      'win?': oppScore > heroScore ? 'TRUE' : 'FALSE',
      'Team Score': String(oppScore), 'Opponent Score': String(heroScore),
    }),
  ];

  const season = (...rounds: Record<string, string>[][]) =>
    normalizeRows(rounds.flat());

  it('records every meeting, counting fill-ins on both sides', () => {
    const rows = season(
      meeting(1, 'Bunny', 6, 2),
      meeting(2, 'Bunny', 6, 3, { opp: true }),
      meeting(3, 'Bunny', 6, 4, { hero: true }),
      meeting(4, 'Bogey', 2, 6)
    );
    const h2h = headToHead('Hero', rows);
    const bunny = h2h.find((h) => h.opponent === 'Bunny')!;
    expect(bunny.meetings).toBe(3);
    expect([bunny.wins, bunny.losses]).toEqual([3, 0]);
    expect([bunny.gamesFor, bunny.gamesAgainst]).toEqual([18, 9]);
    expect(bunny.games.map((g) => g.round)).toEqual([1, 2, 3]);
    expect(bunny.games[1].opponentFillIn).toBe(true);
    expect(bunny.games[2].fillIn).toBe(true);
    expect(bunny.games[0].team).toBe('Pink');
    expect(bunny.games[0].opponentTeam).toBe('Navy');
    expect(h2h.find((h) => h.opponent === 'Bogey')!.meetings).toBe(1);
  });

  it('picks best and worst on win rate, ignoring thin samples', () => {
    const rows = season(
      meeting(1, 'Bunny', 6, 2),
      meeting(2, 'Bunny', 6, 3),
      meeting(3, 'Bunny', 6, 4),
      meeting(4, 'Bogey', 2, 6),
      meeting(5, 'Bogey', 3, 6),
      meeting(6, 'Bogey', 4, 6),
      meeting(7, 'Stranger', 6, 0) // one meeting — not enough to qualify
    );
    const split = bestWorstOpponent('Hero', rows)!;
    expect(split.minMeetings).toBe(3);
    expect(split.best.opponent).toBe('Bunny');
    expect(split.worst.opponent).toBe('Bogey');
  });

  it('breaks a win-rate tie on meetings before games', () => {
    const rows = season(
      // 3–0, but scrappier scorelines than the 2–0 below.
      meeting(1, 'Sweep', 6, 4),
      meeting(2, 'Sweep', 6, 4),
      meeting(3, 'Sweep', 6, 4),
      meeting(4, 'Neat', 6, 0),
      meeting(5, 'Neat', 6, 0),
      meeting(6, 'Bogey', 2, 6),
      meeting(7, 'Bogey', 3, 6)
    );
    const split = bestWorstOpponent('Hero', rows)!;
    expect(split.minMeetings).toBe(2);
    expect(split.best.opponent).toBe('Sweep');
    expect(split.worst.opponent).toBe('Bogey');
  });

  it('makes the longer losing run the worse hoodoo', () => {
    const rows = season(
      meeting(1, 'Bogey', 4, 6),
      meeting(2, 'Bogey', 4, 6),
      meeting(3, 'Bogey', 4, 6),
      // 0–2, and thrashed both times — still not as bad as 0–3.
      meeting(4, 'Thrash', 0, 6),
      meeting(5, 'Thrash', 0, 6),
      meeting(6, 'Bunny', 6, 2),
      meeting(7, 'Bunny', 6, 3)
    );
    const split = bestWorstOpponent('Hero', rows)!;
    expect(split.minMeetings).toBe(2);
    expect(split.worst.opponent).toBe('Bogey');
    expect(split.best.opponent).toBe('Bunny');
  });

  it('breaks a win-rate and meetings tie on games for vs against', () => {
    const rows = season(
      meeting(1, 'Tidy', 6, 0),
      meeting(2, 'Tidy', 6, 1),
      meeting(3, 'Tidy', 0, 6),
      meeting(4, 'Scrappy', 6, 5),
      meeting(5, 'Scrappy', 6, 5),
      meeting(6, 'Scrappy', 0, 6)
    );
    const split = bestWorstOpponent('Hero', rows)!;
    expect(split.best.winPct).toBeCloseTo(split.worst.winPct);
    expect(split.best.opponent).toBe('Tidy');
    expect(split.worst.opponent).toBe('Scrappy');
  });

  it('drops the bar to the floor when nobody has been met often enough', () => {
    const rows = season(
      meeting(1, 'Bunny', 6, 2),
      meeting(2, 'Bunny', 6, 3),
      meeting(3, 'Bogey', 2, 6),
      meeting(4, 'Bogey', 3, 6),
      meeting(5, 'Stranger', 6, 0)
    );
    const split = bestWorstOpponent('Hero', rows)!;
    expect(split.minMeetings).toBe(2);
    expect(split.best.opponent).toBe('Bunny');
    expect(split.worst.opponent).toBe('Bogey');
  });

  it('returns null without two qualifying opponents', () => {
    const rows = season(
      meeting(1, 'Bunny', 6, 2),
      meeting(2, 'Bunny', 6, 3),
      meeting(3, 'Bunny', 6, 4),
      meeting(4, 'Stranger', 2, 6)
    );
    expect(bestWorstOpponent('Hero', rows)).toBeNull();
  });

  it('never counts SINGLES GAME as an opponent', () => {
    const rows = normalizeRows([
      ...meeting(1, 'Bunny', 6, 2),
      raw({
        Team: 'Navy', Opponent: 'Pink', Season: '4', Round: '1',
        Player: 'SINGLES GAME', 'Team Score': '2', 'Opponent Score': '6',
      }),
    ]);
    expect(headToHead('Hero', rows).map((h) => h.opponent)).toEqual(['Bunny']);
  });
});

// ---------------------------------------------------------------------------
// Finals
// ---------------------------------------------------------------------------

describe('scoreline parsing', () => {
  it('reads a single set', () => {
    expect(parseScore('6-4')).toEqual([
      { for: 6, against: 4, tiebreakFor: null, tiebreakAgainst: null, won: true },
    ]);
  });

  it('reads a three-setter with a tiebreak on the losing side', () => {
    const sets = parseScore('4-6 7-6(4) 6-1');
    expect(sets.map((s) => [s.for, s.against])).toEqual([[4, 6], [7, 6], [6, 1]]);
    expect(sets[1].tiebreakAgainst).toBe(4);
    expect(sets.filter((s) => s.won)).toHaveLength(2);
  });

  it('reads the same match mirrored, from the other side', () => {
    const sets = parseScore('6-4 6(4)-7 1-6');
    expect(sets[1].tiebreakFor).toBe(4);
    expect(sets.filter((s) => s.won)).toHaveLength(1);
  });

  it('gives up on a blank or malformed scoreline rather than guessing', () => {
    expect(parseScore('')).toEqual([]);
    expect(parseScore('6–4')).toEqual([]); // en dash, not a hyphen
    expect(parseScore('best of three')).toEqual([]);
  });
});

describe('finals rows', () => {
  const finalRow = (o: Partial<Record<string, string>> = {}) =>
    raw({
      Team: 'White', Opponent: 'Red', Season: '1', Round: 'F',
      Score: '4-6 7-6(4) 6-1', Player: 'Hero', 'win?': 'TRUE',
      'Team Score': '17', 'Opponent Score': '13', ...o,
    });

  it('parses the stage out of the Round column and sorts it after the season', () => {
    const rows = normalizeRows([
      finalRow({ Round: '9', Score: '6-4', 'Team Score': '6', 'Opponent Score': '4' }),
      finalRow({ Round: 'QF', Score: '6-2', 'Team Score': '6', 'Opponent Score': '2' }),
      finalRow({ Round: 'SF', Score: '6-2 6-3', 'Team Score': '12', 'Opponent Score': '5' }),
      finalRow(),
    ]);
    expect(rows.map((r) => r.roundLabel)).toEqual(['9', 'QF', 'SF', 'Final']);
    expect(rows.map((r) => r.isFinals)).toEqual([false, true, true, true]);
    expect(rows.map((r) => r.sets)).toEqual([1, 1, 2, 3]);
    // Sorting by round puts the finals last, in order.
    const sorted = [...rows].sort((a, b) => a.round - b.round);
    expect(sorted.map((r) => r.roundLabel)).toEqual(['9', 'QF', 'SF', 'Final']);
  });

  it('counts sets won and lost from the scoreline', () => {
    const [r] = normalizeRows([finalRow()]);
    expect([r.setsWon, r.setsLost]).toEqual([2, 1]);
  });

  it('keeps finals off the ladder that seeded them', () => {
    const rows = normalizeRows([
      raw({ Team: 'White', Opponent: 'Red', Season: '1', Round: '1', Player: 'a', 'win?': 'TRUE', 'Team Score': '6', 'Opponent Score': '4' }),
      raw({ Team: 'Red', Opponent: 'White', Season: '1', Round: '1', Player: 'b', 'win?': 'FALSE', 'Team Score': '4', 'Opponent Score': '6' }),
      finalRow({ Player: 'a' }),
      finalRow({ Team: 'Red', Opponent: 'White', Player: 'b', Score: '6-4 6(4)-7 1-6', 'win?': 'FALSE', 'Team Score': '13', 'Opponent Score': '17' }),
    ]);
    const t = ladder(1, rows);
    expect(t.find((r) => r.team === 'White')).toMatchObject({
      matchesPlayed: 1, wins: 1, gamesFor: 6, gamesAgainst: 4,
    });
    expect(matchSides(rows, 1, 'all')).toHaveLength(4);
  });

  it('counts finals for win-loss and head to head', () => {
    const rows = normalizeRows([
      finalRow({ Player: 'Hero' }),
      finalRow({ Team: 'Red', Opponent: 'White', Player: 'Villain', Score: '6-4 6(4)-7 1-6', 'win?': 'FALSE', 'Team Score': '13', 'Opponent Score': '17' }),
    ]);
    const agg = playerAgg('Hero', rows);
    expect([agg.games, agg.wins, agg.finalsGames, agg.sets]).toEqual([1, 1, 1, 3]);
    expect(playerAgg('Hero', rows, { scope: 'regular' }).games).toBe(0);

    const [h2h] = headToHead('Hero', rows);
    expect(h2h.opponent).toBe('Villain');
    expect([h2h.meetings, h2h.wins]).toEqual([1, 1]);
    expect(h2h.games[0]).toMatchObject({ roundLabel: 'Final', isFinals: true, score: '4-6 7-6(4) 6-1' });
  });

  it('splits the record into a home-and-away and a finals half', () => {
    const rows = normalizeRows([
      raw({ Team: 'White', Opponent: 'Red', Season: '1', Round: '1', Player: 'Hero', 'win?': 'TRUE' }),
      raw({ Team: 'White', Opponent: 'Red', Season: '1', Round: '2', Player: 'Hero', 'win?': 'FALSE' }),
      finalRow({ Round: 'SF', Player: 'Hero', Score: '6-2 6-3', 'win?': 'TRUE' }),
      finalRow({ Player: 'Hero', 'win?': 'FALSE' }),
    ]);
    const reg = playerAgg('Hero', rows, { scope: 'regular' });
    const fin = playerAgg('Hero', rows, { scope: 'finals' });
    expect([reg.games, reg.wins, reg.losses]).toEqual([2, 1, 1]);
    expect([fin.games, fin.wins, fin.losses]).toEqual([2, 1, 1]);
    // The two halves add back up to the all-in record.
    const all = playerAgg('Hero', rows);
    expect([all.games, all.wins]).toEqual([reg.games + fin.games, reg.wins + fin.wins]);
  });

  it('keeps the 4-3-2-1 Finals MVP vote out of the season MVP tally', () => {
    const rows = normalizeRows([
      raw({ Team: 'White', Opponent: 'Red', Season: '1', Round: '1', Player: 'Hero', votes: '2' }),
      raw({ Team: 'White', Opponent: 'Red', Season: '1', Round: '2', Player: 'Hero', votes: '1' }),
      finalRow({ Player: 'Hero', votes: '4' }),
    ]);
    // Finals votes are skipped whatever the scope, unless the scope is finals.
    // These are career windows, so the S1 votes count era-adjusted: 6 + 4.
    for (const scope of ['all', 'regular'] as const) {
      const agg = playerAgg('Hero', rows, { scope });
      expect(agg.votes).toBe(10);
      expect(agg.votesPerGame).toBe(5); // over the two nights that were voted
    }
    expect(playerAgg('Hero', rows, { scope: 'finals' }).votes).toBe(4);
    expect(leaderboard('votes', rows)[0].value).toBe(10);
    expect(leaderboard('finalsVotes', rows)[0].value).toBe(4);
  });

  it('derives Best on Ground in a final from the finals votes', () => {
    const rows = normalizeRows([
      finalRow({ Player: 'Hero', votes: '4' }),
      finalRow({ Team: 'Red', Opponent: 'White', Player: 'Villain', votes: '3', 'win?': 'FALSE' }),
    ]);
    expect(rows.filter((r) => r.bog).map((r) => r.player)).toEqual(['Hero']);
    expect(playerAgg('Hero', rows, { scope: 'finals' }).bog).toBe(1);
    expect(playerAgg('Hero', rows, { scope: 'regular' }).bog).toBe(0);
  });

  it('keeps finals out of the single-match record books', () => {
    const rows = normalizeRows([
      raw({ Team: 'White', Opponent: 'Red', Season: '1', Round: '1', Player: 'Steady', Winners: '9' }),
      finalRow({ Player: 'Marathon', Winners: '30' }),
    ]);
    expect(records(rows).mostWinnersGame.map((r) => r.player)).toEqual(['Steady']);
  });

  it('lets a win streak run through the finals', () => {
    const rows = normalizeRows([
      raw({ Team: 'White', Opponent: 'Red', Season: '1', Round: '9', Player: 'Hero', 'win?': 'TRUE' }),
      finalRow({ Round: 'QF', Player: 'Hero', Score: '6-2' }),
      finalRow({ Round: 'SF', Player: 'Hero', Score: '6-2 6-3' }),
      finalRow({ Player: 'Hero' }),
    ]);
    expect(winStreaks(rows)[0]).toMatchObject({ player: 'Hero', streak: 4 });
  });
});

describe('partial stats', () => {
  it('treats a blank stat as unrecorded, not zero', () => {
    const rows = normalizeRows([
      raw({ Team: 'White', Season: '4', Round: '1', Player: 'X', Winners: '8', Aces: '2' }),
      raw({ Team: 'White', Season: '4', Round: 'QF', Score: '6-4', Player: 'X', Winners: '6', Aces: '' }),
    ]);
    const agg = playerAgg('X', rows);
    expect(agg.winners).toBe(14);
    expect(agg.aces).toBe(2);
    // The ace rate is over the one game that recorded aces, not both.
    expect(agg.tally.aces.games).toBe(1);
    expect(perSet(agg, 'aces')).toBe(2);
    expect(perSet(agg, 'winners')).toBe(7);
  });

  it('reports null, not zero, for a stat never recorded', () => {
    const rows = normalizeRows([
      raw({ Team: 'White', Season: '4', Round: 'F', Score: '6-4 6-3', Player: 'X', Winners: '', Aces: '', 'Unforced Errors': '', 'Double Faults': '', 'Forced Errors': '' }),
    ]);
    const agg = playerAgg('X', rows);
    expect(agg.winners).toBeNull();
    expect(agg.winnerToUe).toBeNull();
    expect(perSet(agg, 'winners')).toBeNull();
    expect(agg.games).toBe(1); // the match still happened
  });

  it('normalises a multi-set match by sets, not by matches', () => {
    // 12 winners over three sets is the same rate as 4 over one.
    const rows = normalizeRows([
      raw({ Team: 'White', Season: '4', Round: '1', Player: 'Steady', Winners: '4' }),
      raw({ Team: 'Red', Season: '4', Round: 'F', Score: '6-4 4-6 6-3', Player: 'Marathon', Winners: '12' }),
    ]);
    expect(perSet(playerAgg('Steady', rows), 'winners')).toBe(4);
    expect(perSet(playerAgg('Marathon', rows), 'winners')).toBe(4);
  });
});

describe('leaderboard scoping', () => {
  const rows = normalizeRows([
    raw({ Team: 'White', Season: '4', Round: '1', Player: 'Grinder', Winners: '5', 'win?': 'TRUE' }),
    raw({ Team: 'White', Season: '4', Round: '2', Player: 'Grinder', Winners: '5', 'win?': 'TRUE' }),
    raw({ Team: 'Red', Season: '4', Round: '1', Player: 'Finalist', Winners: '4', 'win?': 'FALSE' }),
    raw({ Team: 'Red', Season: '4', Round: '2', Player: 'Finalist', Winners: '4', 'win?': 'FALSE' }),
    raw({ Team: 'Red', Season: '4', Round: 'F', Score: '6-4 6-3', Player: 'Finalist', Winners: '10', 'win?': 'TRUE' }),
  ]);

  it('ranks totals on the home-and-away season alone', () => {
    const board = leaderboard('winners', rows);
    expect(board.map((e) => [e.player, e.value])).toEqual([
      ['Grinder', 10],
      ['Finalist', 8],
    ]);
  });

  it('ranks per-set rates across everything, finals included', () => {
    const board = leaderboard('winners', rows, { perSet: true, minGames: 1 });
    // Finalist: 18 winners over 4 sets = 4.5; Grinder: 10 over 2 = 5.0
    expect(board.map((e) => e.player)).toEqual(['Grinder', 'Finalist']);
    expect(board[1].value).toBe(4.5);
  });

  it('counts the finals win in win rate', () => {
    const board = leaderboard('winPct', rows, { minGames: 1 });
    expect(board.find((e) => e.player === 'Finalist')!.value).toBeCloseTo(1 / 3);
  });
});

// ---------------------------------------------------------------------------
// The CSV's finals rows vs the bracket in the season config
//
// The bracket owns the structure (who played whom) and the CSV owns the player
// rows; both carry the scoreline. This is the check that they never drift.
// It runs here rather than in `check-data` because season configs are loaded
// with import.meta.glob and only resolve under Vite, which vitest gives us.
// ---------------------------------------------------------------------------

describe('finals data matches the brackets', () => {
  const rows = loadStatRows();

  for (const cfg of allSeasonConfigs()) {
    const season = cfg.season;
    const seeds = ladder(season, rows).map((r) => r.team);
    const csvRows = rows.filter((r) => r.season === season && r.isFinals);

    const winners = new Map<string, string>();
    const resolve = (slot: FinalsSlot): string | null => {
      if ('seed' in slot) return seeds[slot.seed - 1] ?? null;
      if ('winnerOf' in slot) return winners.get(slot.winnerOf) ?? null;
      return null; // loserOf — unused so far
    };

    for (const round of cfg.finals ?? []) {
      for (const m of round.matches) {
        const home = resolve(m.home);
        const away = resolve(m.away);
        const res = m.result;
        if (home && away && res) {
          winners.set(m.id, res.winner === 'home' ? home : away);
        }

        const stage = m.id.replace(/\d+$/, '');
        const sides = csvRows.filter(
          (r) => r.stage === stage && (r.team === home || r.team === away)
        );
        if (!sides.length) continue; // no stats entered for this tie yet

        it(`S${season} ${m.id}: ${home} v ${away}`, () => {
          expect(res, 'bracket has no result but the CSV has rows').toBeTruthy();
          const scores = {
            [home!]: res!.homeScore ?? [],
            [away!]: res!.awayScore ?? [],
          };

          for (const team of [home!, away!]) {
            const teamRows = sides.filter((r) => r.team === team);
            expect(teamRows.length, `${team} has no rows`).toBeGreaterThan(0);

            const mine = scores[team];
            const theirs = scores[team === home ? away! : home!];
            const games = (s: string[]) =>
              s.reduce((n, x) => n + Number(/^\d+/.exec(x)![0]), 0);

            for (const r of teamRows) {
              expect(r.opponent).toBe(team === home ? away : home);
              expect(r.sets).toBe(mine.length);
              expect(r.teamScore).toBe(games(mine));
              expect(r.opponentScore).toBe(games(theirs));
              expect(r.win).toBe(
                team === (res!.winner === 'home' ? home : away)
              );
              // The CSV scoreline is the bracket's, from this team's side.
              expect(r.score.split(' ')).toEqual(
                mine.map((s, i) => `${s}-${theirs[i]}`)
              );
            }
          }
        });
      }
    }

    it(`S${season}: every finals row belongs to a bracket tie`, () => {
      const stages = new Set(
        (cfg.finals ?? []).flatMap((r) => r.matches.map((m) => m.id.replace(/\d+$/, '')))
      );
      for (const r of csvRows) expect(stages).toContain(r.stage);
    });
  }
});
