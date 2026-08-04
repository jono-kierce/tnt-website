import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 4 (2025) — complete. Votes are loaded and unsealed; honours filled.
 *
 * Team pair order is captain-first, draftee-second (read from the Instagram
 * standings graphic). Finals line-ups and scores verified against the owner's
 * sheet.
 */
const season4: SeasonConfig = {
  season: 4,
  year: 2025,

  teams: {
    Pink: { captain: 'Luke Sharrock', pair: ['Luke Sharrock', 'Angus Hume'] },
    Orange: { captain: 'Jimmy Gorton', pair: ['Jimmy Gorton', 'Ed Simpson'] },
    Green: { captain: 'Adam Dickson', pair: ['Adam Dickson', 'Declan Croucher'] },
    Red: { captain: 'Quinn Feikema', pair: ['Quinn Feikema', 'Will Burgess'] },
    Navy: { captain: 'Lachlan Jenkin', pair: ['Lachlan Jenkin', 'Jackson Virgona'] },
    'Light Blue': { captain: 'Shayl Inlander', pair: ['Shayl Inlander', 'Ethan Seamer'] },
    White: { captain: 'Jonathan Kierce', pair: ['Jonathan Kierce', 'Lachy Godden'] },
    Black: { captain: 'Emerson Wise', pair: ['Emerson Wise', 'Lewis Mossman'] },
    Yellow: { captain: 'Archie Littlejohn', pair: ['Archie Littlejohn', 'Will Mumme'] },
  },

  honours: [
    { title: 'Champions', team: 'Pink', detail: 'L. Sharrock & A. Hume' },
    { title: 'Runners-up', team: 'White', detail: 'J. Kierce & L. Godden' },
    { title: 'Season MVP', detail: 'A. Dickson — 41 votes (from J. Gorton 40 & L. Sharrock 40)' },
    { title: 'Finals MVP', detail: 'J. Kierce' },
  ],

  // Top 8 seeds off the final ladder (1 Pink, 2 Green, 3 Orange, 4 Red,
  // 5 Navy, 6 Light Blue, 7 White, 8 Black); 9th misses out.
  finals: [
    {
      name: 'Qualifying Round',
      format: 'One set',
      matches: [
        {
          id: 'QF1',
          label: '1 v 8',
          home: { seed: 1 }, // Pink
          away: { seed: 8 }, // Black
          result: { winner: 'home', homeScore: ['6'], awayScore: ['2'] },
        },
        {
          id: 'QF2',
          label: '2 v 7',
          home: { seed: 2 }, // Green
          away: { seed: 7 }, // White
          // White came through a breaker, 7-3.
          result: { winner: 'away', homeScore: ['6(3)'], awayScore: ['7'] },
        },
        {
          id: 'QF3',
          label: '3 v 6',
          home: { seed: 3 }, // Orange
          away: { seed: 6 }, // Light Blue
          result: { winner: 'home', homeScore: ['6'], awayScore: ['4'] },
        },
        {
          id: 'QF4',
          label: '4 v 5',
          home: { seed: 4 }, // Red
          away: { seed: 5 }, // Navy
          result: { winner: 'away', homeScore: ['4'], awayScore: ['6'] },
        },
      ],
    },
    {
      name: 'Semi Finals',
      format: 'First to two sets',
      matches: [
        {
          id: 'SF1',
          home: { winnerOf: 'QF1' }, // Pink
          away: { winnerOf: 'QF4' }, // Navy
          result: { winner: 'home', homeScore: ['6', '6'], awayScore: ['4', '4'] },
        },
        {
          id: 'SF2',
          home: { winnerOf: 'QF2' }, // White
          away: { winnerOf: 'QF3' }, // Orange
          result: { winner: 'home', homeScore: ['6', '6'], awayScore: ['4', '3'] },
        },
      ],
    },
    {
      name: 'Final',
      format: 'First to two sets',
      matches: [
        {
          id: 'F',
          home: { winnerOf: 'SF1' }, // Pink
          away: { winnerOf: 'SF2' }, // White
          // Pink took the title in straights, the second on a 7-3 breaker.
          result: { winner: 'home', homeScore: ['6', '7'], awayScore: ['4', '6(3)'] },
        },
      ],
    },
  ],
};

export default season4;
