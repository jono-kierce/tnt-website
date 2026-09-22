import type { SeasonConfig } from './schema.ts';

/**
 * SEASON 5 (2026) — live.
 *
 * Drafted as TEN teams, the first time TNT has run more than nine (Brown
 * joined the nine-colour palette). **Black withdrew after round four**: its
 * four rounds stand — Navy, Light Blue, Orange and Yellow keep what they got
 * off it, and Littlejohn and Hume keep those matches on their career pages —
 * but it is off the ladder and out of the draw from round five, and Angus Hume
 * moved to Green alongside Quinn Feikema. That leaves nine teams and a redrawn
 * back half: rounds five to ten run three or four matches a night with byes,
 * 40 fixtures across the season rather than the 45 originally drawn.
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
  // Green is the exception: it was drafted Feikema & Mossman, and reads
  // Feikema & Hume from round five, when Black folded into it.
  teams: {
    Navy: { captain: 'Will Mumme', pair: ['Will Mumme', 'Ed Simpson'] },
    // Withdrew after round four. Kept here, and in `draftOrder` below, so the
    // four rounds it did play still print a pairing rather than a colour.
    Black: {
      captain: 'Archie Littlejohn',
      pair: ['Archie Littlejohn', 'Angus Hume'],
      withdrawn: true,
    },
    'Light Blue': { captain: 'Shayl Inlander', pair: ['Shayl Inlander', 'Ethan Seamer'] },
    Green: {
      captain: 'Quinn Feikema',
      pair: ['Quinn Feikema', 'Angus Hume'],
      drafted: ['Quinn Feikema', 'Lewis Mossman'],
    },
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

  // Drafted as a top-10 field: 1 and 2 bye to the qualifying round; 7 v 8 play
  // in first for a shot at 2. Seeds are off the live ladder, so this fills in
  // as S5 is played — now out of nine teams, Black having withdrawn, which
  // makes it eight of nine, the same cut S1–S4 ran.
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
