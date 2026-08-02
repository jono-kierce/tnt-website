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
