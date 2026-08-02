# Player photos

Create one folder per player, named by the player's **slug**, and drop 3–4
photos inside. Example:

```
content/photos/
  luke-sharrock/
    1.jpg
    2.jpg
    3.jpg
  angus-hume/
    action.jpg
    portrait.webp
```

Accepted extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`.
Filenames don't matter — every image in the folder is shown in the player's
gallery, sorted alphabetically. If a folder is missing or empty, the player
gets an initials avatar in their team colour instead.

These are copied into the built site automatically at build time (see
`scripts/copy-assets.mjs`); you don't need to touch `public/`.
