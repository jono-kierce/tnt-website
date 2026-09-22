/**
 * MVP simulation input — the one payload source that isn't `data/alltimestats.csv`.
 *
 * The projection is produced outside this repo (the owner's Monte Carlo over
 * the rounds still to be played) and arrives as a summary CSV, one row per
 * player. This module's whole job is to read that file, canonicalise the names
 * against `aliases.ts`, and hand back typed rows. It is the analogue of
 * `predictions.ts`: external input, parsed and validated here so that
 * `payloads.ts` stays presentation-only.
 *
 * It does NOT compute anything. Every number is read straight out of the file,
 * because the model that produced them isn't in this repo and a board that
 * re-derived half of them would be a second, disagreeing model. What this file
 * *does* do is refuse to trust the input blindly: a player the season doesn't
 * have, or a team that contradicts the season config, is an error or a warning
 * rather than something that quietly renders.
 */

import { readFileSync } from 'node:fs';
import { canonicalName, stripFillIn } from '../../src/config/aliases.ts';
import { getSeasonConfig } from './season-configs.ts';

/** One player's simulated finish, exactly as the summary CSV records it. */
export interface MvpSimRow {
  player: string;
  /** The team the season config says they play for — not the file's own guess. */
  team: string | null;
  /** Share of runs finishing 1st / top 3 / top 5 / top 10, as percentages. */
  first: number;
  top3: number;
  top5: number;
  top10: number;
  /** Projected final vote tally: the median, the mean, and the 5th–95th band. */
  medianVotes: number;
  meanVotes: number;
  p5Votes: number;
  p95Votes: number;
}

export interface MvpSimFile {
  rows: MvpSimRow[];
  /** Disagreements with the repo's own data. Reported by the CLI, not thrown. */
  warnings: string[];
}

/**
 * Column headers as the summary CSV writes them. Keyed by the field they fill,
 * so a renamed column in the generator fails loudly here with the name it
 * wanted rather than silently parsing as `NaN`.
 */
const COLUMNS = {
  player: 'Player',
  team: 'Team',
  first: '1st Percentage',
  top3: 'Top 3 Percentage',
  top5: 'Top 5 Percentage',
  top10: 'Top 10 Percentage',
  medianVotes: 'Median Votes',
  meanVotes: 'Mean Votes',
  p5Votes: '5th Pct Votes',
  p95Votes: '95th Pct Votes',
} as const;

/**
 * Split one CSV line. The summary file is machine-written with no quoted
 * fields, but it does carry a UTF-8 BOM and CRLF line endings on some runs —
 * both of which would otherwise end up inside the first header and the last
 * value.
 */
function cells(line: string): string[] {
  return line.replace(/\r$/, '').split(',').map((c) => c.trim());
}

/** `"98.4%"` and `"26.0"` both mean a number. A blank does not. */
function numeric(raw: string, field: string, player: string): number {
  const cleaned = raw.replace(/%/g, '').trim();
  if (cleaned === '') {
    throw new Error(`MVP sim: ${player} has no value for "${field}".`);
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    throw new Error(`MVP sim: ${player}'s "${field}" is not a number: "${raw}".`);
  }
  return n;
}

/**
 * Read a simulation summary CSV.
 *
 * `season` is what the file is checked against: every player must be on that
 * season's declared list, and the file's `Team` column must agree with the
 * season config. The config wins — it's the same rule the rest of the pipeline
 * runs on, where a colour comes from the repo and never from the input.
 */
export async function loadMvpSim(path: string, season: number): Promise<MvpSimFile> {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error(`MVP sim: ${path} has no data rows.`);
  }

  const header = cells(lines[0]);
  const index: Record<keyof typeof COLUMNS, number> = {} as never;
  for (const [field, name] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const at = header.indexOf(name);
    if (at === -1) {
      throw new Error(
        `MVP sim: ${path} has no "${name}" column. Found: ${header.join(', ')}`
      );
    }
    index[field] = at;
  }

  // The season's own roster, from the config that also drives the ladder and
  // the draft board. `pair` is captain-first, which doesn't matter here — what
  // matters is that this is the repo's answer to "who plays for whom".
  //
  // Withdrawn teams are laid down first so an active team overwrites them: a
  // player whose team folded under him is in two `pair` lists, and the one he
  // plays for now is the one the board should colour him. Relying on the key
  // order of `teams` to settle that would be settling it by accident.
  const config = await getSeasonConfig(season);
  const teamOf = new Map<string, string>();
  const entries = Object.entries(config?.teams ?? {});
  for (const [team, cfg] of entries) {
    if (!cfg.withdrawn) continue;
    for (const member of cfg.pair ?? []) teamOf.set(member, team);
  }
  for (const [team, cfg] of entries) {
    if (cfg.withdrawn) continue;
    for (const member of cfg.pair ?? []) teamOf.set(member, team);
  }
  if (!teamOf.size) {
    throw new Error(
      `MVP sim: src/config/seasons/season-${season}.ts declares no team ` +
        `pairings, so there's nothing to check the projection against.`
    );
  }

  const warnings: string[] = [];
  const rows: MvpSimRow[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    const c = cells(line);
    const raw = c[index.player] ?? '';
    if (raw === '') continue;

    // The summary shouldn't carry a fill-in suffix, but canonicalise the same
    // way the CSV loader does so a name can't diverge between the two files.
    const player = canonicalName(stripFillIn(raw).name);
    if (seen.has(player)) {
      throw new Error(`MVP sim: ${player} appears twice in ${path}.`);
    }
    seen.add(player);

    const team = teamOf.get(player) ?? null;
    if (team === null) {
      warnings.push(
        `MVP sim: "${player}" is not on any Season ${season} team in ` +
          `src/config/seasons/season-${season}.ts — row rendered with no colour.`
      );
    } else {
      const claimed = c[index.team] ?? '';
      if (claimed !== '' && claimed !== team) {
        warnings.push(
          `MVP sim: the file has ${player} on ${claimed}; season ${season}'s ` +
            `config has them on ${team}. Using ${team}.`
        );
      }
    }

    const num = (field: keyof typeof COLUMNS) =>
      numeric(c[index[field]] ?? '', COLUMNS[field], player);

    rows.push({
      player,
      team,
      first: num('first'),
      top3: num('top3'),
      top5: num('top5'),
      top10: num('top10'),
      medianVotes: num('medianVotes'),
      meanVotes: num('meanVotes'),
      p5Votes: num('p5Votes'),
      p95Votes: num('p95Votes'),
    });
  }

  if (!rows.length) throw new Error(`MVP sim: ${path} has no player rows.`);

  // Anyone in the season but missing from the projection is worth saying out
  // loud — a board that silently dropped a player would read as a demotion.
  const missing = [...teamOf.keys()].filter((p) => !seen.has(p));
  if (missing.length) {
    warnings.push(
      `MVP sim: Season ${season} has ${missing.length} player(s) with no row ` +
        `in the projection: ${missing.join(', ')}.`
    );
  }

  return { rows, warnings };
}
