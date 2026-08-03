import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 3 (2024).
 * Champions/runners-up/finals MVP taken from the written bios. Season MVP and
 * finals scores still to fill in (marked TODO).
 */
const season3: SeasonConfig = {
  season: 3,
  year: 2024,

  teams: {
    // Captain-first order. Kierce's pair confirmed; others derive from the CSV
    // until you set them.
    White: { captain: 'Jonathan Kierce', pair: ['Jonathan Kierce', 'Damon Maurice'] },
  },

  honours: [
    { title: 'Champions', team: 'White', detail: 'J. Kierce & D. Maurice' },
    { title: 'Runners-up', team: 'Orange', detail: 'J. Gorton & L. Mossman' },
    { title: 'Season MVP', detail: 'J. Kierce' },
    { title: 'Finals MVP', detail: 'J. Kierce' },
  ],

  // Seeds off the final ladder: 1 White, 2 Orange, 3 Red, 4 Navy, 5 Black,
  // 6 Light Blue, 7 Yellow, 8 Green.
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
          result: { winner: 'home', homeScore: ['6'], awayScore: ['1'] },
        },
        {
          id: 'QF2',
          label: '2 v 7',
          home: { seed: 2 }, // Orange
          away: { seed: 7 }, // Yellow
          result: { winner: 'home', homeScore: ['6'], awayScore: ['4'] },
        },
        {
          id: 'QF3',
          label: '3 v 6',
          home: { seed: 3 }, // Red
          away: { seed: 6 }, // Light Blue
          result: { winner: 'home', homeScore: ['6'], awayScore: ['3'] },
        },
        {
          id: 'QF4',
          label: '4 v 5',
          home: { seed: 4 }, // Navy
          away: { seed: 5 }, // Black
          // Black took the breaker 8-6 to upset the higher seed.
          result: { winner: 'away', homeScore: ['6(6)'], awayScore: ['7'] },
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
          away: { winnerOf: 'QF4' }, // Black
          // Second set went to a tiebreak at 5-5, Black winning it 7-3 —
          // normalised to a 6-5 set so it reads the tennis way.
          result: { winner: 'home', homeScore: ['6', '5(3)', '6'], awayScore: ['0', '6', '4'] },
        },
        {
          id: 'SF2',
          home: { winnerOf: 'QF2' }, // Orange
          away: { winnerOf: 'QF3' }, // Red
          result: { winner: 'home', homeScore: ['6', '1', '6'], awayScore: ['1', '6', '3'] },
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
          away: { winnerOf: 'SF2' }, // Orange
          result: { winner: 'home', homeScore: ['6', '0', '6'], awayScore: ['0', '6', '4'] },
        },
      ],
    },
  ],
};

export default season3;
