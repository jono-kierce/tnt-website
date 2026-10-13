/**
 * Test support — never imported by the site or the renderer.
 *
 * Plenty of tests are about what a fixture must *not* do: count on a ladder,
 * touch a career, sway the model. They used to read the fixtures straight out
 * of the live CSV, which only works while a season is mid-flight — the night
 * its last result goes in there's nothing left to test against, and the tests
 * fail for a reason that has nothing to do with the code. This rebuilds the
 * draw from the real rows instead, so they hold in any week of the year.
 */
import { CSV_PATH, normalizeRows } from './normalize.ts';
import { readCsvFile } from './csv.ts';
import type { StatRow } from './types.ts';

/** What a fixture row keeps: everything the draw knows before the night. */
const DRAW_COLUMNS = new Set(['Team', 'Opponent', 'Season', 'Round', 'Start', 'Player', '']);

/**
 * The real CSV with every home-and-away match of `season` from `fromRound` on
 * put back to an unplayed draw — the file as it stood the morning of that
 * round. Finals are left alone.
 */
export function redrawnRows(season: number, fromRound: number): StatRow[] {
  return normalizeRows(
    readCsvFile(CSV_PATH).map((r) => {
      const round = Number(r['Round']);
      if (Number(r['Season']) !== season || !(round >= fromRound)) return r;
      return Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, DRAW_COLUMNS.has(k) ? v : ''])
      );
    })
  );
}
