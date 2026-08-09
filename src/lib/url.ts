import { teamSlug } from '../config/aliases.ts';
import type { FinalsStage } from './types.ts';

const BASE = import.meta.env.BASE_URL || '/';

/** Prefix an absolute-from-root path with the configured base, safely. */
export function withBase(path: string): string {
  const b = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}` || '/';
}

export function playerHref(slug: string): string {
  return withBase(`/players/${slug}/`);
}

export function seasonHref(season: number): string {
  return withBase(`/seasons/${season}/`);
}

/**
 * The round part of a match URL: a home-and-away round keeps its number, a
 * final uses its stage code. Note this is the *stage*, not `roundLabel` — the
 * label for a final is "Final", and `f` is what belongs in a path.
 */
export function roundSlug(round: number, stage: FinalsStage | null): string {
  return stage ? stage.toLowerCase() : String(round);
}

/**
 * The two teams, alphabetically. Sorted rather than home-first so a match has
 * one canonical URL however you arrived at it — from either side's row, from a
 * player's match log, or from the round carousel.
 */
export function matchSlug(a: string, b: string): string {
  return [teamSlug(a), teamSlug(b)].sort().join('-vs-');
}

export function matchHref(
  season: number,
  round: number,
  stage: FinalsStage | null,
  a: string,
  b: string
): string {
  return withBase(
    `/seasons/${season}/rounds/${roundSlug(round, stage)}/${matchSlug(a, b)}/`
  );
}

export const scheduleHref = (): string => withBase('/schedule/');
