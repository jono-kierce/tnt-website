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

  // TODO: add the finals bracket + results for Season 3.
  // Copy the `finals` block out of season-1.ts and swap in the scores — the
  // seeding (1 v 8, 2 v 7, 3 v 6, 4 v 5) and round formats are the same.
  finals: [],
};

export default season3;
