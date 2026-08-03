import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 2 (2023).
 *
 * The bracket used to contradict its own honours — following the recorded
 * results made Light Blue champion. Reconciled against the owner's finals
 * sheet: the qualifying round and SF1 were right all along; SF2 had the two
 * teams' scorelines the wrong way round, and the final had the wrong winner
 * and a wrong third set. Orange are champions, as the honours always said.
 */
const season2: SeasonConfig = {
  season: 2,
  year: 2023,

  teams: {
    Pink: { captain: 'Jonathan Kierce', pair: ['Jonathan Kierce', 'Damon Maurice'] },
  },

  honours: [
    { title: 'Champions', team: 'Orange', detail: 'J. Gorton & E. Simpson' },
    { title: 'Runners-up', team: 'Light Blue', detail: 'E. Wise & A. Hume' },
    { title: 'Season MVP', detail: 'L. Sharrock' },
    { title: 'Finals MVP', detail: 'J. Gorton' },
  ],
  finals: [
    {
      name: 'Qualifying Round',
      format: 'One set',
      matches: [
        {
          id: 'QF1',
          label: '1 v 8',
          home: { seed: 1 }, // Yellow
          away: { seed: 8 }, // Black
          result: { winner: 'home', homeScore: ['6'], awayScore: ['2'] },
        },
        {
          id: 'QF2',
          label: '2 v 7',
          home: { seed: 2 }, // Navy
          away: { seed: 7 }, // Pink
          result: { winner: 'away', homeScore: ['2'], awayScore: ['6'] },
        },
        {
          id: 'QF3',
          label: '3 v 6',
          home: { seed: 3 }, // Red
          away: { seed: 6 }, // Orange
          result: { winner: 'away', homeScore: ['0'], awayScore: ['6'] },
        },
        {
          id: 'QF4',
          label: '4 v 5',
          home: { seed: 4 }, // Light Blue
          away: { seed: 5 }, // White
          result: { winner: 'home', homeScore: ['6'], awayScore: ['4'] },
        },
      ],
    },
    {
      name: 'Semi Finals',
      format: 'First to two sets',
      matches: [
        {
          id: 'SF1',
          home: { winnerOf: 'QF1' }, // Yellow
          away: { winnerOf: 'QF4' }, // Light Blue
          result: { winner: 'away', homeScore: ['6', '3', '0'], awayScore: ['2', '6', '6'] },
        },
        {
          id: 'SF2',
          home: { winnerOf: 'QF2' }, // Pink
          away: { winnerOf: 'QF3' }, // Orange
          // Orange came from a set down; the scorelines were previously
          // recorded against the wrong sides, which is what made the bracket
          // disagree with the honours.
          result: { winner: 'away', homeScore: ['6', '4', '4'], awayScore: ['3', '6', '6'] },
        },
      ],
    },
    {
      name: 'Final',
      format: 'First to two sets',
      matches: [
        {
          id: 'F',
          home: { winnerOf: 'SF1' }, // Light Blue
          away: { winnerOf: 'SF2' }, // Orange
          // Recorded level at 6-6 and 3-3: Orange took both on breakers, and
          // the sheet doesn't say by how much. TODO: fill in the two tiebreak
          // scores and the sets will read the tennis way.
          result: {
            winner: 'away',
            homeScore: ['6', '6', '3'],
            awayScore: ['2', '6', '3'],
          },
        },
      ],
    },
  ],
};

export default season2;
