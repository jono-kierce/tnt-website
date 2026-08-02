import { describe, expect, it } from 'vitest';
import { normalizeRows } from './normalize.ts';
import { ladder, playerAgg, teamRoster, matchSides } from './stats.ts';
import { canonicalName, shortName, stripFillIn } from '../config/aliases.ts';

/** Helper to build a raw CSV record object. */
function raw(o: Partial<Record<string, string>>): Record<string, string> {
  return {
    Team: '', Opponent: '', Season: '', Round: '', Player: '',
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
    expect(agg.votedGames).toBe(0);
  });

  it('averages votes only over games where votes were recorded', () => {
    const rows = normalizeRows([
      raw({ Team: 'Pink', Season: '2', Round: '1', Player: 'X', votes: '6' }),
      raw({ Team: 'Pink', Season: '2', Round: '2', Player: 'X', votes: '' }), // unrecorded
      raw({ Team: 'Pink', Season: '2', Round: '3', Player: 'X', votes: '2' }),
    ]);
    const agg = playerAgg('X', rows);
    expect(agg.votes).toBe(8);
    expect(agg.votedGames).toBe(2);
    expect(agg.votesPerGame).toBe(4);
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
