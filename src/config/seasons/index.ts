import type { SeasonConfig } from './schema.ts';

/**
 * Auto-discovers every `season-N.ts` in this folder via Vite's glob import.
 * Dropping in `season-5.ts` is picked up automatically — no wiring needed.
 * (Consumed at build time by Astro pages, which run through Vite.)
 */
const modules = import.meta.glob<{ default: SeasonConfig }>('./season-*.ts', {
  eager: true,
});

const BY_SEASON = new Map<number, SeasonConfig>();
for (const mod of Object.values(modules)) {
  const cfg = mod.default;
  BY_SEASON.set(cfg.season, cfg);
}

export function getSeasonConfig(season: number): SeasonConfig | undefined {
  return BY_SEASON.get(season);
}

export function seasonTeamConfig(season: number, team: string) {
  return getSeasonConfig(season)?.teams?.[team];
}

export function allSeasonConfigs(): SeasonConfig[] {
  return [...BY_SEASON.values()].sort((a, b) => a.season - b.season);
}
