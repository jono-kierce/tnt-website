/**
 * Copies build-time assets into `public/` so Astro serves them:
 *  - the source CSV        -> public/data/alltimestats.csv   (download link)
 *  - content/photos/**     -> public/photos/**               (player galleries)
 *
 * Runs automatically before `dev` and `build` (see package.json).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.name.toLowerCase() !== 'readme.md') copyFile(src, dest);
  }
}

// 1. CSV for download
const csv = path.join(root, 'data/alltimestats.csv');
if (fs.existsSync(csv)) {
  copyFile(csv, path.join(root, 'public/data/alltimestats.csv'));
  console.log('[copy-assets] data/alltimestats.csv -> public/data/');
}

// 2. Player photos
copyDir(path.join(root, 'content/photos'), path.join(root, 'public/photos'));
console.log('[copy-assets] content/photos -> public/photos');
