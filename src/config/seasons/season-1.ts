import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 1 (2022) — the original. Serve stats were tracked this season only;
 * votes used the old 2/1 + Player-of-the-Round system.
 */
const season1: SeasonConfig = {
  season: 1,
  year: 2022,

  teams: {
    White: { captain: 'Jonathan Kierce', pair: ['Jonathan Kierce', 'Ethan Seamer'] },
  },

  honours: [
    { title: 'Champions', team: 'White', detail: 'J. Kierce & E. Seamer' },
    { title: 'Runners-up', team: 'Red', detail: 'C. Simpson & A. Hume' },
    { title: 'Season MVP', detail: 'A. Littlejohn, J. Kierce & L. Sharrock' },
    { title: 'Finals MVP', detail: 'C. Simpson' },
  ],

  // Top 8 seeds off the final ladder (1 White, 2 Red, 3 Orange, 4 Navy,
  // 5 Black, 6 Pink, 7 Yellow, 8 Green); 9th misses out. Qualifying round is a
  // single set, semis and final are first to two.
  finals: [
    {
      name: 'Qualifying Round',
      format: 'One set',
      matches: [
        {
          id: 'QF1',
          label: '1 v 8',
          home: { seed: 1 }, // White
          away: { seed: 8 }, // Green
          result: { winner: 'home', homeScore: ['6'], awayScore: ['0'] },
        },
        {
          id: 'QF2',
          label: '2 v 7',
          home: { seed: 2 }, // Red
          away: { seed: 7 }, // Yellow
          result: { winner: 'home', homeScore: ['6'], awayScore: ['4'] },
        },
        {
          id: 'QF3',
          label: '3 v 6',
          home: { seed: 3 }, // Orange
          away: { seed: 6 }, // Pink
          result: { winner: 'home', homeScore: ['7'], awayScore: ['5'] },
        },
        {
          id: 'QF4',
          label: '4 v 5',
          home: { seed: 4 }, // Navy
          away: { seed: 5 }, // Black
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
          home: { winnerOf: 'QF1' }, // White
          away: { winnerOf: 'QF4' }, // Navy
          result: { winner: 'home', homeScore: ['6', '6'], awayScore: ['2', '4'] },
        },
        {
          id: 'SF2',
          home: { winnerOf: 'QF2' }, // Red
          away: { winnerOf: 'QF3' }, // Orange
          result: { winner: 'home', homeScore: ['6', '6'], awayScore: ['2', '2'] },
        },
      ],
    },
    {
      name: 'Final',
      format: 'First to two sets',
      matches: [
        {
          id: 'F',
          home: { winnerOf: 'SF1' }, // White
          away: { winnerOf: 'SF2' }, // Red
          // White dropped the first set, took the second in a tiebreak 7-4.
          result: {
            winner: 'home',
            homeScore: ['4', '7', '6'],
            awayScore: ['6', '6(4)', '1'],
          },
        },
      ],
    },
  ],
};

export default season1;
