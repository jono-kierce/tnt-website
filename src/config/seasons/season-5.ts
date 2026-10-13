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
 * `finals` below is the bracket *shape* only — no `result` on any match yet,
 * so seed slots resolve against the live in-progress ladder and `winnerOf` /
 * `loserOf` slots show "Winner of …" / "Loser of …" until each tie is played.
 * S5 is the first AFL-style bracket: all nine teams, a double chance for the
 * top four, and a wildcard for eighth and ninth. Add `result`
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

  // AFL-style, over all nine teams: everybody plays finals, and where you
  // finish decides how many lives you get.
  //
  //   Week 1  Wildcard          8 v 9, played first on the night — loser out.
  //           Qualifying        1 v 4, 2 v 3 — the double chance: the winners
  //                             skip a week into the prelims, the losers drop
  //                             into a semi.
  //           Elimination       6 v 7, 5 v the wildcard — loser out.
  //   Week 2  Semis             loser 1v4 v winner 6v7; loser 2v3 v winner 5vWC.
  //   Week 3  Preliminaries     each QF winner meets the semi winner from the
  //                             *other* side, so no QF is replayed before the GF.
  //   Week 4  Grand Final
  //
  // Seeds are off the live ladder, so this fills in as S5 is played. Each
  // tie's home/away is the order its feeders sit on the page (SF1 lists the
  // 6v7 winner first, because that tie draws above 1v4), so no two lines cross
  // where they arrive. The ids double as the CSV's `Round` stage once a tie
  // is played (digits stripped: WC, QF, EF, SF, PF, GF).
  finals: [
    {
      name: 'Qualifying & Elimination',
      // WC is played first on the night; its winner takes EF2's second slot.
      // It draws stacked under EF2, the tie it feeds.
      matches: [
        { id: 'WC', label: 'WC · 8 v 9', home: { seed: 8 }, away: { seed: 9 } },
        { id: 'QF1', label: 'QF1 · 1 v 4', home: { seed: 1 }, away: { seed: 4 } },
        { id: 'QF2', label: 'QF2 · 2 v 3', home: { seed: 2 }, away: { seed: 3 } },
        { id: 'EF1', label: 'EF1 · 6 v 7', home: { seed: 6 }, away: { seed: 7 } },
        { id: 'EF2', label: 'EF2 · 5 v WC', home: { seed: 5 }, away: { winnerOf: 'WC' } },
      ],
    },
    {
      name: 'Semi Finals',
      matches: [
        { id: 'SF1', label: 'SF1', home: { winnerOf: 'EF1' }, away: { loserOf: 'QF1' } },
        { id: 'SF2', label: 'SF2', home: { loserOf: 'QF2' }, away: { winnerOf: 'EF2' } },
      ],
    },
    {
      name: 'Preliminary Finals',
      matches: [
        { id: 'PF1', label: 'PF1', home: { winnerOf: 'SF1' }, away: { winnerOf: 'QF2' } },
        { id: 'PF2', label: 'PF2', home: { winnerOf: 'QF1' }, away: { winnerOf: 'SF2' } },
      ],
    },
    {
      name: 'Grand Final',
      matches: [{ id: 'GF', label: 'GF', home: { winnerOf: 'PF1' }, away: { winnerOf: 'PF2' } }],
    },
  ],
};

export default season5;
