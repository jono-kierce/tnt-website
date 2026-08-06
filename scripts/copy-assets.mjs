/**
 * Copies build-time assets into `public/` so Astro serves them:
 *  - the source CSV        -> public/data/alltimestats.csv   (download link)
 *  - content/photos/**     -> public/photos/**               (player galleries)
 *
 * Runs automatically before `dev` and `build` (see package.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();

// Not site assets: docs, the photo manifest, .DS_Store and friends.
const SKIP = (name) =>
  name.startsWith('.') || name.toLowerCase() === 'readme.md' || name === 'photos.yaml';

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else copyFile(src, dest);
  }
}

// Copying alone leaves orphans behind: rename or delete a photo in content/ and
// the old file sits in public/ forever, invisible in the manifest but still
// shipped in dist/. public/photos is generated (and gitignored), so anything
// here that content/ no longer has is stale by definition.
function pruneDir(from, to) {
  if (!fs.existsSync(to)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(to, { withFileTypes: true })) {
    const dest = path.join(to, entry.name);
    const src = path.join(from, entry.name);
    if (entry.isDirectory()) {
      removed += pruneDir(src, dest);
      if (fs.readdirSync(dest).length === 0) fs.rmdirSync(dest);
    } else if (!fs.existsSync(src)) {
      fs.rmSync(dest);
      console.log(`[copy-assets] pruned stale ${path.relative(root, dest)}`);
      removed++;
    }
  }
  return removed;
}

// 1. CSV for download
const csv = path.join(root, 'data/alltimestats.csv');
if (fs.existsSync(csv)) {
  copyFile(csv, path.join(root, 'public/data/alltimestats.csv'));
  console.log('[copy-assets] data/alltimestats.csv -> public/data/');
}

// 2. Photos
const photosDir = path.join(root, 'content/photos');
const publicPhotos = path.join(root, 'public/photos');
copyDir(photosDir, publicPhotos);
const pruned = pruneDir(photosDir, publicPhotos);
console.log(
  `[copy-assets] content/photos -> public/photos${pruned ? ` (${pruned} stale file(s) pruned)` : ''}`
);

// A photo on disk that photos.yaml doesn't list is invisible on the site —
// say so on every dev/build, since that's when a new photo usually arrives.
const manifest = path.join(photosDir, 'photos.yaml');
const listed = new Set(
  (fs.existsSync(manifest) ? (parse(fs.readFileSync(manifest, 'utf8')) ?? []) : [])
    .map((e) => e?.file)
    .filter(Boolean)
);
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const onDisk = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (EXT.has(path.extname(entry.name).toLowerCase())) {
      onDisk.push(path.relative(photosDir, full).split(path.sep).join('/'));
    }
  }
})(photosDir);
for (const f of onDisk.filter((f) => !listed.has(f)).sort()) {
  console.warn(`[copy-assets] ⚠ content/photos/${f} is NOT in photos.yaml — it won't show on the site`);
}
