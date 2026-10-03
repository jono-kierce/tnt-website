# Photos

Every photo on the site is listed in **`photos.yaml`** — that file decides who's
tagged in a photo, which season it belongs to, and the caption. The folders are
just storage, organised by season:

```
content/photos/
  photos.yaml     <- the manifest (this is the file you edit)
  season-1/ … season-5/
  misc/           <- photos that don't belong to a season
```

## Adding a photo (two steps)

1. Drop the image into the season folder, e.g. `season-5/r3-tiebreak.jpg`.
   Use short lowercase filenames. Accepted: `.jpg` `.jpeg` `.png` `.webp` `.gif` `.avif`.
2. Add an entry to `photos.yaml`:

```yaml
- file: season-5/r3-tiebreak.jpg
  players: [jonathan-kierce, adam-dickson]
  season: 5
  caption: "Round 3: the 11-9 tiebreak that decided top spot"
```

That's it. The photo appears on every tagged player's page and in the season's
gallery. If you forget step 2, `npm run dev`, `npm run build` and
`npm run check-data` all print a warning naming the file.

## Rules

- `players` are **slugs** (`lachlan-jenkin`, not "Lachie") — `check-data` errors
  on typos. Tag everyone recognisable; the photo shows on each player's page.
- `season` puts the photo in that season's gallery. Omit it for off-season/misc
  shots — they still show on player pages.
- `caption` is optional; leave it blank for none.
- **Order matters**: galleries render in manifest order, and a player's avatar
  is their first *solo-tagged* photo (falling back to their first tagged one).
  Reorder entries to change what leads.
- **Profile pictures**: the avatar is shown at 64–120px, where a wide action
  shot is a speck. To use a close-up instead, crop a square headshot into
  `avatars/<slug>.jpg` and list it with `avatar: true` and exactly one player.
  It becomes that player's avatar and never appears in a gallery, so it can be
  cut from a photo that's already listed (or one that isn't, like a team pair)
  without showing anyone twice:

  ```yaml
  - file: avatars/jim-papa.jpg   # cut from season-3/black-pair-s3.jpg
    players: [jim-papa]
    avatar: true
  ```

Photos are copied into the built site automatically (`scripts/copy-assets.mjs`);
you don't need to touch `public/`.
