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

  // TODO: add the finals bracket + results for Season 1.
  finals: [],
};

export default season1;
