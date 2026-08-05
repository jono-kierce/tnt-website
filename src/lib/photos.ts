/**
 * Photo library, backed by content/photos/photos.yaml — the single source of
 * truth for which photos exist, who's in them, which season they belong to and
 * what the caption says. Folder layout is just storage; tags live here.
 *
 * Manifest order is meaningful: galleries render in it, and a player's avatar
 * is their first solo-tagged photo (falling back to their first tagged one).
 *
 * Kept importable from plain Node (scripts/check-data.ts): no import.meta.env,
 * no Vite-only APIs. Paths are relative — the UI layer applies the site base.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
export const PHOTOS_DIR = path.join(root, 'content/photos');
export const MANIFEST_PATH = path.join(PHOTOS_DIR, 'photos.yaml');

export const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

export interface Photo {
  /** Path relative to content/photos/, e.g. "season-3/s3-champions.jpg". */
  file: string;
  /** Player slugs tagged in the photo. */
  players: string[];
  /** Season the photo belongs to, or null if unknown/off-season. */
  season: number | null;
  /** Caption shown under the photo, or null for none. */
  caption: string | null;
}

let cache: Photo[] | null = null;

/** All manifest entries, in manifest order. Malformed entries are dropped. */
export function allPhotos(): Photo[] {
  if (cache) return cache;
  if (!fs.existsSync(MANIFEST_PATH)) return (cache = []);
  const raw = parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(raw)) return (cache = []);
  cache = raw
    .filter((e) => e && typeof e.file === 'string')
    .map((e) => ({
      file: e.file,
      players: Array.isArray(e.players) ? e.players.map(String) : [],
      season: typeof e.season === 'number' ? e.season : null,
      caption: typeof e.caption === 'string' && e.caption.trim() ? e.caption.trim() : null,
    }));
  return cache;
}

/** Photos tagged with a player, in manifest order. */
export function playerPhotos(slug: string): Photo[] {
  return allPhotos().filter((p) => p.players.includes(slug));
}

/** A player's avatar photo: first solo-tagged, else first tagged, else null. */
export function avatarPhoto(slug: string): Photo | null {
  const mine = playerPhotos(slug);
  return mine.find((p) => p.players.length === 1) ?? mine[0] ?? null;
}

/** Photos belonging to a season, in manifest order. */
export function seasonPhotos(season: number): Photo[] {
  return allPhotos().filter((p) => p.season === season);
}

/** Image files on disk under content/photos/ (relative paths, sorted). */
export function photoFilesOnDisk(): string[] {
  if (!fs.existsSync(PHOTOS_DIR)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (PHOTO_EXT.has(path.extname(entry.name).toLowerCase())) {
        out.push(path.relative(PHOTOS_DIR, full).split(path.sep).join('/'));
      }
    }
  };
  walk(PHOTOS_DIR);
  return out.sort();
}

/** Files on disk that photos.yaml doesn't list — each one is invisible on the site. */
export function unlistedPhotos(): string[] {
  const listed = new Set(allPhotos().map((p) => p.file));
  return photoFilesOnDisk().filter((f) => !listed.has(f));
}

/** Manifest entries whose file doesn't exist on disk. */
export function missingPhotoFiles(): string[] {
  const onDisk = new Set(photoFilesOnDisk());
  return allPhotos()
    .map((p) => p.file)
    .filter((f) => !onDisk.has(f));
}
