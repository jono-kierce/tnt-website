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
 * `finals` below is the bracket *shape* only — no `result` on any match yet,
 * so seed slots resolve against the live in-progress ladder and `winnerOf`
 * slots show "Winner of …" until each tie is actually played. Add `result`
 * to a match as finals are played; `honours` gets filled at season's end.
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

  // Captains in pick order, number one pick first. Drives the draft graphic.
  draftOrder: [
    'Navy', // 1  W. Mumme
    'Black', // 2  A. Littlejohn
    'Light Blue', // 3  S. Inlander
    'Green', // 4  Q. Feikema
    'Orange', // 5  J. Gorton
    'Pink', // 6  C. Simpson
    'Red', // 7  L. Jenkin
    'Brown', // 8  A. Dickson
    'White', // 9  J. Kierce
    'Yellow', // 10 L. Sharrock
  ],

  honours: [],

  // Top-10 field: 1 and 2 bye to the qualifying round; 7 v 8 play in first for
  // a shot at 2. Seeds are off the live ladder, so this fills in as S5 is played.
  finals: [
    {
      name: 'Wildcard',
      matches: [
        {
          id: 'WC',
          label: '7 v 8',
          home: { seed: 7 },
          away: { seed: 8 },
        },
      ],
    },
    {
      name: 'Qualifying Round',
      matches: [
        {
          id: 'QF1',
          label: '2 v (7/8)',
          home: { seed: 2 },
          away: { winnerOf: 'WC' },
        },
        {
          id: 'QF2',
          label: '3 v 6',
          home: { seed: 3 },
          away: { seed: 6 },
        },
        {
          id: 'QF3',
          label: '4 v 5',
          home: { seed: 4 },
          away: { seed: 5 },
        },
      ],
    },
    {
      name: 'Semi Finals',
      matches: [
        {
          id: 'SF1',
          home: { seed: 1 },
          away: { winnerOf: 'QF3' },
        },
        {
          id: 'SF2',
          home: { winnerOf: 'QF1' },
          away: { winnerOf: 'QF2' },
        },
      ],
    },
    {
      name: 'Final',
      matches: [
        {
          id: 'F',
          home: { winnerOf: 'SF1' },
          away: { winnerOf: 'SF2' },
        },
      ],
    },
  ],
};

export default season5;
