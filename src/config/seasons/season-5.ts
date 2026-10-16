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
 * back half: rounds five to nine run three to five matches a night with byes,
 * 40 fixtures across the season rather than the 45 originally drawn, and the
 * round robin is done by 13 Oct — round ten (20 Oct) was dropped.
 *
 * `finals` below is the bracket *shape*, with a `result` only on the wildcard
 * so far. Seed slots resolve against the ladder and `winnerOf` slots show
 * "Winner of …" until each tie is played. It's the usual eight-team knockout
 * with one addition: ninth gets in through an 8 v 9 wildcard, played on
 * Thursday 15 Oct, two days after round nine. Add `result` to a match as
 * finals are played; `honours` gets filled at season's end.
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

  // The usual knockout — 1 v 8, 2 v 7, 3 v 6, 4 v 5, then semis and a final —
  // except that eighth isn't in it yet: eighth and ninth play a wildcard on
  // Thursday 15 Oct, and the winner takes 1st's QF. (Owner's call, 14 Oct
  // 2026, replacing the AFL-style double chance drawn up on 5 Oct.)
  //
  // The wildcard is in the QF round rather than a column of its own because
  // it's the same step of the bracket — its winner goes straight into a QF, two
  // days later rather than the same night; `bracketLayout` stacks it under QF1, the
  // tie its winner fills. Its id doubles as the CSV's `Round` stage once it is
  // played, like the others (digits stripped: WC, QF, SF, F).
  finals: [
    {
      name: 'Quarter Finals',
      matches: [
        { id: 'QF1', label: 'QF1 · 1 v WC', home: { seed: 1 }, away: { winnerOf: 'WC' } },
        {
          id: 'WC',
          label: 'WC · Wildcard 8 v 9',
          home: { seed: 8 }, // Orange
          away: { seed: 9 }, // Navy
          result: { winner: 'home', homeScore: ['6'], awayScore: ['3'] },
        },
        { id: 'QF2', label: 'QF2 · 2 v 7', home: { seed: 2 }, away: { seed: 7 } },
        { id: 'QF3', label: 'QF3 · 3 v 6', home: { seed: 3 }, away: { seed: 6 } },
        { id: 'QF4', label: 'QF4 · 4 v 5', home: { seed: 4 }, away: { seed: 5 } },
      ],
    },
    {
      name: 'Semi Finals',
      matches: [
        { id: 'SF1', label: 'SF1', home: { winnerOf: 'QF1' }, away: { winnerOf: 'QF4' } },
        { id: 'SF2', label: 'SF2', home: { winnerOf: 'QF2' }, away: { winnerOf: 'QF3' } },
      ],
    },
    {
      name: 'Final',
      matches: [{ id: 'F', label: 'Grand Final', home: { winnerOf: 'SF1' }, away: { winnerOf: 'SF2' } }],
    },
  ],
};

export default season5;
