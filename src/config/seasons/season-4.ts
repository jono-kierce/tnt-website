import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 4 (2025) — current season, votes sealed until awards night.
 *
 * Team pair order is captain-first, draftee-second (read from the Instagram
 * standings graphic). Captains filled from that graphic per the captain-first
 * convention; correct any you know differently.
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

  // Bracket structure per the TNT finals format (top 8 seeds; 9th misses out).
  // Seeds reference the final ladder position. Add `result` to each match once
  // scores are known — see season-1.ts for the result shape.
  finals: [
    {
      name: 'Qualifying Round',
      matches: [
        { id: 'QF1', label: '1 v 8', home: { seed: 1 }, away: { seed: 8 } },
        { id: 'QF2', label: '2 v 7', home: { seed: 2 }, away: { seed: 7 } },
        { id: 'QF3', label: '3 v 6', home: { seed: 3 }, away: { seed: 6 } },
        { id: 'QF4', label: '4 v 5', home: { seed: 4 }, away: { seed: 5 } },
      ],
    },
    {
      name: 'Semi Finals',
      matches: [
        { id: 'SF1', home: { winnerOf: 'QF1' }, away: { winnerOf: 'QF4' } },
        { id: 'SF2', home: { winnerOf: 'QF2' }, away: { winnerOf: 'QF3' } },
      ],
    },
    {
      name: 'Final',
      matches: [
        {
          id: 'F',
          home: { winnerOf: 'SF1' },
          away: { winnerOf: 'SF2' },
          // Pink (seed 1) won the title. Add scores when you have them:
          // result: { winner: 'home', homeScore: ['6', '6'], awayScore: ['4', '3'] },
        },
      ],
    },
  ],
};

export default season4;
