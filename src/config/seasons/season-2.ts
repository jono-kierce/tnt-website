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

  // TODO: add the finals bracket + results for Season 2.
  // Copy the `finals` block out of season-1.ts and swap in the scores — the
  // seeding (1 v 8, 2 v 7, 3 v 6, 4 v 5) and round formats are the same.
  finals: [],
};

export default season2;
