import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 1 (2022) — the original. Serve stats were tracked this season only;
 * votes used the old 2/1 + Player-of-the-Round system.
 *
 * Honours are mostly TODO — the bios only confirm that C. Simpson & A. Hume
 * (Red) were runners-up (they knocked Gorton & E. Simpson out of the QF 6-4).
 * Fill in champions / MVP / finals scores from your records.
 */
const season1: SeasonConfig = {
  season: 1,
  year: 2022,

  teams: {
    White: { captain: 'Jonathan Kierce', pair: ['Jonathan Kierce', 'Ethan Seamer'] },
  },

  honours: [
    { title: 'Champions', detail: 'TODO' },
    { title: 'Runners-up', team: 'Red', detail: 'C. Simpson & A. Hume' },
    { title: 'Season MVP', detail: 'TODO' },
    { title: 'Finals MVP', detail: 'TODO' },
  ],

  // TODO: add the finals bracket + results for Season 1.
  finals: [],
};

export default season1;
