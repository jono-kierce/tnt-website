import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { withBase } from './url.ts';

const root = process.cwd();
const BIOS_DIR = path.join(root, 'content/bios');
const SEASONS_DIR = path.join(root, 'content/seasons');

const STUB = /^no bio written yet/i;

/** Rewrite bare-slug markdown links `](my-slug)` -> `](/players/my-slug/)`. */
function linkPlayers(md: string): string {
  return md.replace(/\]\((?!https?:|\/|#)([a-z0-9-]+)\)/g, (_m, slug) => {
    return `](${withBase(`/players/${slug}/`)})`;
  });
}

/** Player bio HTML, or null if there's no real bio yet. */
export function bioHtml(slug: string): string | null {
  const file = path.join(BIOS_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw || STUB.test(raw)) return null;
  return marked.parse(linkPlayers(raw)) as string;
}

/** Season recap HTML, or null if no recap file exists. */
export function seasonRecapHtml(season: number): string | null {
  const file = path.join(SEASONS_DIR, `season-${season}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return null;
  return marked.parse(linkPlayers(raw)) as string;
}

/** Web URL for a manifest photo (see src/lib/photos.ts). */
export function photoSrc(photo: { file: string }): string {
  return withBase(`/photos/${photo.file}`);
}
