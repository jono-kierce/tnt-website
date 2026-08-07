import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 5 (2026) — drafted, not yet live.
 *
 * Teams are set from the draft; S5 runs TEN teams for the first time (Brown
 * joins the nine-colour palette). The season goes live when the first S5 rows
 * land in the CSV: flip `currentSeason` to 5 in `src/config/site.ts` at that
 * point (and add 5 to `sealedVoteSeasons` if votes stay hidden until awards
 * night). Until there are rows, no /seasons/5/ page is generated.
 *
 * `honours`/`finals` get filled at season's end.
 */
const season5: SeasonConfig = {
  season: 5,
  year: 2026,

  // Captain-first, draftee-second — the order they were read out in the draft.
  teams: {
    Navy: { captain: 'Will Mumme', pair: ['Will Mumme', 'Ed Simpson'] },
    Black: { captain: 'Archie Littlejohn', pair: ['Archie Littlejohn', 'Angus Hume'] },
    'Light Blue': { captain: 'Shayl Inlander', pair: ['Shayl Inlander', 'Ethan Seamer'] },
    Green: { captain: 'Quinn Feikema', pair: ['Quinn Feikema', 'Lewis Mossman'] },
    Orange: { captain: 'Jimmy Gorton', pair: ['Jimmy Gorton', 'Lachy Godden'] },
    Pink: { captain: 'Charlie Simpson', pair: ['Charlie Simpson', 'Damon Maurice'] },
    Red: { captain: 'Lachlan Jenkin', pair: ['Lachlan Jenkin', 'Jamie Harris'] },
    Brown: { captain: 'Adam Dickson', pair: ['Adam Dickson', 'Ted Angel'] },
    White: { captain: 'Jonathan Kierce', pair: ['Jonathan Kierce', 'Jackson Virgona'] },
    Yellow: { captain: 'Luke Sharrock', pair: ['Luke Sharrock', 'Jack Raines'] },
  },

  honours: [],
};

export default season5;
