/**
 * Season configs, loaded outside Vite.
 *
 * `src/config/seasons/index.ts` auto-discovers `season-N.ts` with
 * `import.meta.glob`, which only exists under Vite — that's why `check-data`
 * and `print-ladder` avoid importing it. The renderer needs the same configs
 * (captain-first pairing order, the finals bracket) but runs under plain Node,
 * so it discovers them the same way with `readdir` + dynamic import.
 *
 * Same contract as the Vite version: drop in `season-6.ts` and it's picked up.
 * The two loaders read the same files, so they can't disagree about content —
 * only about how the directory listing was obtained.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { SeasonConfig, TeamConfig } from '../../src/config/seasons/schema.ts';

const SEASON_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/config/seasons'
);

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
