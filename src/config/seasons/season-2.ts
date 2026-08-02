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
    { title: 'Season MVP', detail: 'TODO — fill from awards night' },
    { title: 'Finals MVP', detail: 'J. Gorton (best-on in all three finals)' },
  ],

  // TODO: add the finals bracket + results for Season 2.
  finals: [],
};

export default season2;
