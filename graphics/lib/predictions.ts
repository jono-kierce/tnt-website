/**
 * "The Analysts Predict" — the pundits' pre-season picks.
 *
 * A once-off Instagram post: each analyst calls the six season awards. This is
 * opinion, not data, so — like the headline card — nothing here is derived from
 * `stats.ts`. What the analysts named is all that's stored: a **team colour** for
 * a team award and a **canonical player name** for an individual one. The pairing
 * behind a colour and the team a player wears are looked up from the season config
 * by the payload builder, so a pick written as "Yellow" still prints both players
 * and a pick written as a name still wears the right colour — and neither is
 * hand-typed here where it could drift from the draft.
 *
 * Player names must match the canonical spelling in `src/config/seasons/season-N.ts`
 * exactly; team keys must be a colour in that season's `teams`. The payload builder
 * throws if a pick resolves to nobody, and a test re-runs it.
 */

/**
 * One analyst's card. Team awards (`champions`, `minorPremiers`, `woodenSpoon`)
 * carry a colour key; individual awards (`mvp`, `finalsMvp`, `mostImproved`)
 * carry a canonical player name.
 */
export interface AnalystPredictions {
  /** Display name, shown as the card's headline. */
  analyst: string;
  champions: string; // team colour
  minorPremiers: string; // team colour
  mvp: string; // player
  finalsMvp: string; // player
  woodenSpoon: string; // team colour
  mostImproved: string; // player
}

/**
 * The five analysts, in slide order. Claude is the last card. Names resolved
 * against the S5 draft:
 *   - Will Burgess's "Jono Jackson" (minor premiers) reads as the White pairing.
 *   - Declan Croucher's "Jono" (MVP) reads as Jonathan Kierce.
 */
export const ANALYSTS: AnalystPredictions[] = [
  {
    analyst: 'Emerson Wise',
    champions: 'Yellow',
    minorPremiers: 'Pink',
    mvp: 'Charlie Simpson',
    finalsMvp: 'Luke Sharrock',
    woodenSpoon: 'Black',
    mostImproved: 'Jack Raines',
  },
  {
    analyst: 'The Commissioner',
    champions: 'Yellow',
    minorPremiers: 'Navy',
    mvp: 'Charlie Simpson',
    finalsMvp: 'Luke Sharrock',
    woodenSpoon: 'Black',
    mostImproved: 'Lachy Godden',
  },
  {
    analyst: 'Will Burgess',
    champions: 'Pink',
    minorPremiers: 'White',
    mvp: 'Luke Sharrock',
    finalsMvp: 'Charlie Simpson',
    woodenSpoon: 'Black',
    mostImproved: 'Jack Raines',
  },
  {
    analyst: 'Declan Croucher',
    champions: 'Yellow',
    minorPremiers: 'Green',
    mvp: 'Jonathan Kierce',
    finalsMvp: 'Luke Sharrock',
    woodenSpoon: 'Navy',
    mostImproved: 'Jackson Virgona',
  },
  {
    analyst: 'AI (Claude)',
    champions: 'White',
    minorPremiers: 'Yellow',
    mvp: 'Luke Sharrock',
    finalsMvp: 'Jonathan Kierce',
    woodenSpoon: 'Navy',
    mostImproved: 'Ted Angel',
  },
];
