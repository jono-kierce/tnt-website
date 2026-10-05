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

// Split one CSV line into its raw cells, quotes and all, so a line can be
// re-joined byte-for-byte with only the cells we touched changed.
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/**
 * The CSV as published: the `votes` cell blanked on every row of a season in
 * `SITE.sealedVoteSeasons`. The site and the graphics blank those votes
 * themselves (`sealVotes` in stats.ts), but the download link would otherwise
 * hand out the file as committed. BOM, line endings and every other cell are
 * left exactly as they are.
 */
function sealedCsv(text, sealed) {
  if (!sealed.length) return text;
  const lines = text.split('\n');
  const header = splitCsvLine(lines[0].replace(/^﻿/, '').replace(/\r$/, ''));
  const seasonCol = header.indexOf('Season');
  const votesCol = header.indexOf('votes');
  if (seasonCol < 0 || votesCol < 0) {
    throw new Error('[copy-assets] CSV has no Season/votes column — refusing to publish it unsealed');
  }
  let blanked = 0;
  const out = lines.map((line, i) => {
    if (i === 0) return line;
    const cr = line.endsWith('\r') ? '\r' : '';
    const cells = splitCsvLine(cr ? line.slice(0, -1) : line);
    if (!sealed.includes(Number(cells[seasonCol])) || !(cells[votesCol] ?? '').trim()) return line;
    cells[votesCol] = '';
    blanked++;
    return cells.join(',') + cr;
  });
  console.log(`[copy-assets] sealed seasons ${sealed.join(', ')}: ${blanked} vote(s) blanked in the download`);
  return out.join('\n');
}

// 1. CSV for download, sealed votes blanked
const csv = path.join(root, 'data/alltimestats.csv');
if (fs.existsSync(csv)) {
  const { SITE } = await import('../src/config/site.ts');
  const dest = path.join(root, 'public/data/alltimestats.csv');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, sealedCsv(fs.readFileSync(csv, 'utf8'), SITE.sealedVoteSeasons));
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
