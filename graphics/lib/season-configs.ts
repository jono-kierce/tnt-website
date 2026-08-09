/**
 * Season configs for the renderer.
 *
 * The loader itself lives in `src/config/seasons/node.ts` — `check-data` and
 * `print-ladder` need the same thing, and two `readdir` implementations of the
 * same directory is one more than there should be. This file stays so the
 * renderer's imports read as renderer imports.
 */

export {
  getSeasonConfig,
  allSeasonConfigs,
  seasonTeamConfigs,
  declaredTeams,
} from '../../src/config/seasons/node.ts';
