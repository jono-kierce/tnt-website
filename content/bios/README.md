# Player bios

Drop one markdown file per player here, named by the player's **slug**
(lowercase, spaces → hyphens). Examples:

- `luke-sharrock.md`
- `lachlan-jenkin.md`  ← use the canonical name (not `lachie-jenkin`)
- `jim-papa.md`        ← canonical (not `james-papa`)

Aim for ~150 words. Plain markdown. To link to another player's page, link to
their **slug**:

```markdown
Gorton picked up [Ed Simpson](ed-simpson) in the draft...
```

Bare slug links like `(ed-simpson)` are rewritten to `/players/ed-simpson/`
automatically. If a bio file is missing, the player page shows a short default.

Canonical names are defined in `src/config/aliases.ts`. If you add a player who
appears under two spellings in the CSV, add the alias there and use the
canonical slug for the bio filename.
