import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 2 (2023).
 * Champions/runners-up/finals MVP taken from the written bios. Season MVP and
 * finals scores still to fill in (marked TODO).
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
          home: { seed: 3 },
          away: { seed: 6 },
          result: { winner: 'away', homeScore: ['0'], awayScore: ['6'] },
        },
        {
          id: 'QF4',
          label: '4 v 5',
          home: { seed: 4 }, // Yellow
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
          home: { winnerOf: 'QF1' },
          away: { winnerOf: 'QF4' },
          result: { winner: 'away', homeScore: ['6', '3', '0'], awayScore: ['2', '6', '6'] },
        },
        {
          id: 'SF2',
          home: { winnerOf: 'QF2' }, // Red
          away: { winnerOf: 'QF3' }, // Orange
          result: { winner: 'home', homeScore: ['3', '6', '6'], awayScore: ['6', '4', '4'] },
        },
      ],
    },
    {
      name: 'Final',
      format: 'First to two sets',
      matches: [
        {
          id: 'F',
          home: { winnerOf: 'SF1' }, // LBlue
          away: { winnerOf: 'SF2' }, // White
          result: {
            winner: 'home',
            homeScore: ['6', '6', '3'],
            awayScore: ['2', '6', '6'],
          },
        },
      ],
    },
  ],
};

export default season2;
