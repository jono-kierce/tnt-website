import { defineConfig } from 'astro/config';

// GitHub Pages: for a project page the site lives at
//   https://<user>.github.io/<repo>/  -> base must be "/<repo>".
// Override both via env in CI, or hard-code them here. If you point a custom
// domain at the repo (CNAME at the root), set SITE_BASE="/".
const SITE_URL = process.env.SITE_URL ?? 'https://jono-kierce.github.io';
const SITE_BASE = process.env.SITE_BASE ?? '/tnt-website';

export default defineConfig({
  site: SITE_URL,
  base: SITE_BASE,
  trailingSlash: 'always',
  // Honour PORT so tooling can assign a free port when 4321 is taken.
  server: { port: Number(process.env.PORT) || 4321 },
  build: { format: 'directory' },
  // Static site — no adapter needed; `astro build` emits plain HTML to dist/.
});
