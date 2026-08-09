/**
 * Season configs, loaded outside Vite.
 *
 * `./index.ts` auto-discovers `season-N.ts` with `import.meta.glob`, which only
 * exists under Vite — that's why `check-data`, `print-ladder` and the Instagram
 * renderer can't import it. They need the same configs (the declared team
 * field, captain-first pairing order, the finals bracket) but run under plain
 * Node, so this discovers them the same way with `readdir` + dynamic import.
 *
 * Same contract as the Vite version: drop in `season-6.ts` and it's picked up.
 * The two loaders read the same files, so they can't disagree about content —
 * only about how the directory listing was obtained.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { SeasonConfig, TeamConfig } from './schema.ts';

const SEASON_DIR = dirname(fileURLToPath(import.meta.url));

let cache: Map<number, SeasonConfig> | null = null;

async function load(): Promise<Map<number, SeasonConfig>> {
  if (cache) return cache;
  cache = new Map();
  const files = readdirSync(SEASON_DIR)
    .filter((f) => /^season-\d+\.ts$/.test(f))
    .sort();
  for (const file of files) {
    const mod: { default: SeasonConfig } = await import(
      pathToFileURL(resolve(SEASON_DIR, file)).href
    );
    cache.set(mod.default.season, mod.default);
  }
  return cache;
}

export async function getSeasonConfig(
  season: number
): Promise<SeasonConfig | undefined> {
  return (await load()).get(season);
}

export async function allSeasonConfigs(): Promise<SeasonConfig[]> {
  return [...(await load()).values()].sort((a, b) => a.season - b.season);
}

/**
 * A lookup of per-team overrides for one season, in the shape `teamRoster`
 * wants. Returns a function rather than the map so callers can pass it straight
 * through to `ladderWithPairings`.
 */
export async function seasonTeamConfigs(
  season: number
): Promise<(team: string) => TeamConfig | undefined> {
  const cfg = await getSeasonConfig(season);
  return (team: string) => cfg?.teams?.[team];
}

/**
 * The season's declared field — every team the config names, in config order.
 *
 * This is what a drawn-but-unplayed season has instead of CSV rows, and what
 * `ladder` and `seasonRounds` need so a team on a bye in round one still
 * counts as one of the season's teams. Empty for a season whose config doesn't
 * bother listing teams (S1–S3 name only one apiece), which is right: those
 * seasons are long since played and the CSV knows their field perfectly well.
 */
export async function declaredTeams(season: number): Promise<string[]> {
  const cfg = await getSeasonConfig(season);
  return Object.keys(cfg?.teams ?? {});
}
