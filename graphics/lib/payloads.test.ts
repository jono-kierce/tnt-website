import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SealedVotesError,
  draftPayload,
  ladderPayload,
  latestRound,
  nextPreviewRound,
  predictionsPayloads,
  previewPayload,
  resolveRound,
  resultCardPayloads,
  rows,
  scoreboardPayload,
  seasonRounds,
  pairBoardPayload,
  mvpSimPayloads,
  statBoardPayload,
  streakBoardPayload,
} from './payloads.ts';
import { ANALYSTS } from './predictions.ts';
import {
  ladderWithPairings,
  winStreaks,
  pairRecord,
  seasonRounds as matchRounds,
} from '../../src/lib/stats.ts';
import { SITE, TEAMS } from '../../src/config/site.ts';
import { getSeasonConfig } from './season-configs.ts';

/** Compact "6 7" / "4 6³" for asserting on a whole side at once. */
const line = (sets: { games: string; tiebreak: string | null }[]) =>
  sets.map((s) => s.games + (s.tiebreak ? `^${s.tiebreak}` : '')).join(' ');

describe('round resolution', () => {
  it('reads a home-and-away round and a finals stage', () => {
    expect(resolveRound('9')).toMatchObject({
      round: 9,
      stage: null,
      label: 'Round 9',
      fileTag: 'r09',
    });
    expect(resolveRound('F')).toMatchObject({ stage: 'F', label: 'Grand Final', fileTag: 'rF' });
    expect(resolveRound('QF')).toMatchObject({ stage: 'QF', label: 'Qualifying Final' });
    expect(resolveRound('SF')).toMatchObject({ stage: 'SF', label: 'Semi Final' });
  });

  it('zero-pads the file tag so a folder sorts chronologically', () => {
    const tags = [1, 2, 9].map((n) => resolveRound(String(n)).fileTag);
    expect(tags).toEqual(['r01', 'r02', 'r09']);
    expect([...tags].sort()).toEqual(tags);
  });

  it('puts finals after the home-and-away season', () => {
    const s4 = seasonRounds(4);
    expect(s4.map((r) => r.fileTag).slice(-3)).toEqual(['rQF', 'rSF', 'rF']);
    expect(latestRound(4)?.stage).toBe('F');
  });
});

describe('result card scorelines', () => {
  /** The one fixture in a round, winner's side first. */
  const card = async (season: number, round: string) =>
    (await resultCardPayloads(season, resolveRound(round)))[0];

  it('renders the Season 4 grand final, 6-4 7-6(3)', async () => {
    const c = await card(4, 'F');
    expect(c.sides.map((s) => s.team)).toEqual(['Pink', 'White']);
    expect(line(c.sides[0].sets)).toBe('6 7');
    // The breaker is written on the loser's side in the CSV, and that's the
    // side that prints it — nothing here inverts a score to get the other view.
    expect(line(c.sides[1].sets)).toBe('4 6^3');
    expect(c.sides[0].won).toBe(true);
  });

  it('renders the Season 3 grand final, 6-0 0-6 6-4', async () => {
    const c = await card(3, 'F');
    expect(line(c.sides[0].sets)).toBe('6 0 6');
    expect(line(c.sides[1].sets)).toBe('0 6 4');
    expect(c.sides[0].sets.map((s) => s.won)).toEqual([true, false, true]);
  });

  it('renders the Season 1 grand final, 4-6 7-6(4) 6-1', async () => {
    const c = await card(1, 'F');
    expect(line(c.sides[0].sets)).toBe('4 7 6');
    expect(line(c.sides[1].sets)).toBe('6 6^4 1');
  });

  it('handles a one-set tie and a tiebreak in the qualifying round', async () => {
    const cards = await resultCardPayloads(4, resolveRound('QF'));
    expect(cards).toHaveLength(4);
    const upset = cards.find((c) => c.slug === 'white-v-green')!;
    expect(line(upset.sides[0].sets)).toBe('7');
    expect(line(upset.sides[1].sets)).toBe('6^3');
    // The 7th seed beat the 2nd — seeds come off the final ladder, not the draw.
    expect(upset.sides.map((s) => s.seed)).toEqual([7, 2]);
  });

  it('marks the winner of a set left level, off win? rather than the score', async () => {
    // Season 4, Round 9: Green beat Yellow on a 5-5 nobody recorded a breaker
    // for. Neither side won the set, so the card can't infer a winner from it.
    const cards = await resultCardPayloads(4, resolveRound('9'));
    const level = cards.find((c) => c.slug === 'green-v-yellow')!;
    expect(level.sides.map((s) => s.sets[0].games)).toEqual(['5', '5']);
    expect(level.sides.every((s) => !s.sets[0].won)).toBe(true);
    expect(level.sides.every((s) => s.sets[0].level)).toBe(true);
    // ...but exactly one of them won the match, and it's listed first.
    expect(level.sides.map((s) => s.won)).toEqual([true, false]);
    expect(level.sides[0].team).toBe('Green');
  });

  it('labels a home-and-away round and a final differently', async () => {
    expect((await card(4, '9')).roundLabel).toBe('Round 9');
    expect((await card(4, 'F')).roundLabel).toBe('Grand Final');
  });
});

describe('ladder payload', () => {
  it('is the same ladder the site renders, formatted for print', async () => {
    const p = await ladderPayload(4, resolveRound('9'));
    const site = ladderWithPairings(4, rows, () => undefined);

    expect(p.rows.map((r) => r.team)).toEqual(site.map((r) => r.team));
    expect(p.rows.map((r) => r.ratio)).toEqual(site.map((r) => r.ratio.toFixed(2)));
    expect(p.rows[0]).toMatchObject({
      rank: 1,
      team: 'Pink',
      pairing: 'L. Sharrock & A. Hume',
      played: 8,
      wins: 8,
      ratio: '1.67',
      qualifies: true,
    });
  });

  it('takes the pairing order from the season config', async () => {
    const p = await ladderPayload(4, resolveRound('9'));
    // season-4.ts lists Orange captain-first as Gorton then Simpson; games
    // played alone would put Simpson first.
    expect(p.rows.find((r) => r.team === 'Orange')!.pairing).toBe(
      'J. Gorton & E. Simpson'
    );
  });

  it('marks only the top eight as qualifying', async () => {
    const p = await ladderPayload(4, resolveRound('9'));
    expect(p.finalsCutoff).toBe(8);
    expect(p.rows.filter((r) => r.qualifies)).toHaveLength(8);
    expect(p.rows.at(-1)).toMatchObject({ rank: 9, qualifies: false });
  });

  it('gives the ladder as it stood mid-season', async () => {
    const early = await ladderPayload(4, resolveRound('3'));
    expect(early.title).toBe('Standings');
    expect(early.subtitle).toContain('After Round 3');
    expect(early.rows.every((r) => r.played <= 3)).toBe(true);
  });

  it('keeps finals off the ladder they seeded', async () => {
    const afterFinal = await ladderPayload(4, resolveRound('F'));
    const afterR9 = await ladderPayload(4, resolveRound('9'));
    expect(afterFinal.rows).toEqual(afterR9.rows);
    expect(afterFinal.title).toBe('Final Ladder');
  });
});

describe('preview board', () => {
  it('never carries a win probability — insights only, or nothing', async () => {
    const p = await previewPayload(5, resolveRound('1'));
    for (const m of p.matches) {
      if (m.insight === null) continue;
      expect(m.insight).toEqual({ label: expect.any(String), detail: expect.any(String) });
      expect(JSON.stringify(m.insight)).not.toMatch(/%/);
    }
  });

  it('reports no upcoming fixtures for a season that has finished', async () => {
    expect(await nextPreviewRound(4)).toBeNull();
  });

  it('throws rather than silently rendering an empty round', async () => {
    await expect(previewPayload(5, resolveRound('99'))).rejects.toThrow(/no round/);
  });
});

describe('scoreboard', () => {
  it('reads Season 5 round 2 in kickoff order, winner first', async () => {
    const b = await scoreboardPayload(5, resolveRound('2'));
    expect(b.title).toBe('Round 2');
    expect(b.matches.map((m) => m.time)).toEqual([
      '6:30pm', '7:00pm', '7:30pm', '8:00pm', '8:30pm',
    ]);
    // Winner on top of each pair — MatchRecord.sides is alphabetical, so this
    // is the reordering doing its job (Orange before White, Navy before Black).
    expect(b.matches.map((m) => m.sides[0].team)).toEqual([
      'Orange', 'Navy', 'Red', 'Pink', 'Yellow',
    ]);
    for (const m of b.matches) {
      expect(m.sides[0].won).toBe(true);
      expect(m.sides[1].won).toBe(false);
    }
    expect(line(b.matches[0].sides[0].sets)).toBe('6');
    expect(line(b.matches[0].sides[1].sets)).toBe('1');
    // Ten teams, five matches: nobody sits out.
    expect(b.byes).toEqual([]);
  });

  it('prints the line-up that played, not the season pairing', async () => {
    const b = await scoreboardPayload(5, resolveRound('2'));
    const white = b.matches[0].sides[1];
    expect(white.pairing).toBe('J. Kierce & C. Paraskevas');
  });

  it('takes the winner from `win?`, not from counting sets', async () => {
    // Season 4 round 9 has a 5-5 nobody recorded a breaker for: neither side
    // won that set, and a board that counted bright numbers would call it a
    // draw. `win?` says otherwise, and `win?` is what the board reads.
    const b = await scoreboardPayload(4, resolveRound('9'));
    const levelled = b.matches.find((m) =>
      m.sides.some((s) => s.sets.some((set) => set.level))
    )!;
    expect(levelled).toBeDefined();
    expect(levelled.draw).toBe(false);
    expect(levelled.sides[0].won).toBe(true);
  });

  it('shows only played fixtures — a drawn round is the preview\'s job', async () => {
    // Whichever round is wholly undrawn: naming one pins the test to a week of
    // the season. It can't just be the next round up for preview — a round
    // half entered, four sheets in and the fifth still to come, is a legitimate
    // state (`check-data` warns, never errors), and its board rightly carries
    // the four that were played.
    const drawn = matchRounds(rows, 5).find((r) => r.matches.every((m) => m.scheduled));
    expect(drawn).toBeDefined();
    const b = await scoreboardPayload(5, resolveRound(drawn!.stage ?? String(drawn!.round)));
    expect(b.matches).toEqual([]);
  });

  it('agrees with the result cards about every scoreline', async () => {
    const round = resolveRound('F');
    const [board, cards] = await Promise.all([
      scoreboardPayload(4, round),
      resultCardPayloads(4, round),
    ]);
    expect(board.matches).toHaveLength(cards.length);
    for (const [i, m] of board.matches.entries()) {
      expect(m.sides.map((s) => s.team)).toEqual(cards[i].sides.map((s) => s.team));
      expect(m.sides.map((s) => line(s.sets))).toEqual(
        cards[i].sides.map((s) => line(s.sets))
      );
    }
  });

  it('throws rather than silently rendering an empty round', async () => {
    await expect(scoreboardPayload(5, resolveRound('99'))).rejects.toThrow(/no round/);
  });
});

describe('draft board', () => {
  it('reads Season 5 in pick order, captain and draftee split out', async () => {
    const d = await draftPayload(5);
    expect(d.rows).toHaveLength(10);
    expect(d.rows.map((r) => [r.pick, r.captain, r.draftee])).toEqual([
      [1, 'Will Mumme', 'Ed Simpson'],
      [2, 'Archie Littlejohn', 'Angus Hume'],
      [3, 'Shayl Inlander', 'Ethan Seamer'],
      [4, 'Quinn Feikema', 'Lewis Mossman'],
      [5, 'Jimmy Gorton', 'Lachy Godden'],
      [6, 'Charlie Simpson', 'Damon Maurice'],
      [7, 'Lachlan Jenkin', 'Jamie Harris'],
      [8, 'Adam Dickson', 'Ted Angel'],
      [9, 'Jonathan Kierce', 'Jackson Virgona'],
      [10, 'Luke Sharrock', 'Jack Raines'],
    ]);
  });

  it('names a team for every pick, including the tenth colour', async () => {
    const d = await draftPayload(5);
    // Brown joins for S5. A team missing from TEAMS would fall through to the
    // neutral chip rather than to a broken variable, so assert the real list.
    expect(d.rows.map((r) => r.team)).toEqual([
      'Navy', 'Black', 'Light Blue', 'Green', 'Orange',
      'Pink', 'Red', 'Brown', 'White', 'Yellow',
    ]);
    for (const r of d.rows) expect(TEAMS[r.team]).toBeDefined();
  });

  it('keeps draftOrder and teams in step', async () => {
    const cfg = await getSeasonConfig(5);
    // Every drafted team has a pairing, and no team is left off the board.
    expect(new Set(cfg!.draftOrder)).toEqual(new Set(Object.keys(cfg!.teams!)));
    expect(cfg!.draftOrder).toHaveLength(new Set(cfg!.draftOrder).size);
  });

  it('explains itself when a season has no recorded pick order', async () => {
    await expect(draftPayload(4)).rejects.toThrow(/no draftOrder/);
  });
});

describe('stat boards', () => {
  it('tallies the Season 4 MVP race the way the honours board records it', () => {
    // season-4.ts: "A. Dickson — 41 votes (from J. Gorton 40 & L. Sharrock 40)".
    const b = statBoardPayload({
      id: 'mvp',
      title: 'MVP',
      metricLabel: 'Votes',
      stat: 'votes',
      season: 4,
      rows: 3,
    });
    expect(b.rows.map((r) => [r.player, r.value])).toEqual([
      ['Adam Dickson', '41'],
      ['Jimmy Gorton', '40'],
      ['Luke Sharrock', '40'],
    ]);
  });

  it('colours the good end green whichever end the leader is at', () => {
    const spec = {
      id: 'x',
      title: 'x',
      metricLabel: 'x',
      stat: 'unforcedErrors',
      perSet: true,
      season: 4,
      rows: 5,
    } as const;

    const good = statBoardPayload({ ...spec, polarity: 'high' });
    const bad = statBoardPayload({ ...spec, polarity: 'low' });

    // Same ranking — #1 is always the biggest number, as on the site.
    expect(bad.rows.map((r) => r.player)).toEqual(good.rows.map((r) => r.player));
    // Opposite ramp: most unforced errors is the worst place to be.
    expect(good.rows[0].tone).toBe(0);
    expect(bad.rows[0].tone).toBe(1);
    expect(bad.rows.at(-1)!.tone).toBe(0);
  });

  it('reports coverage rather than letting a blank cell pass as a zero', () => {
    const b = statBoardPayload({
      id: 'w',
      title: 'w',
      metricLabel: 'w',
      stat: 'winners',
      perSet: true,
      season: 4,
      rows: 10,
    });
    const partial = b.rows.filter((r) => r.coverage);
    expect(partial.length).toBeGreaterThan(0);
    for (const r of partial) expect(r.coverage).toMatch(/^\d+ of \d+ matches$/);
  });

  it('excludes fill-ins by default and says so', () => {
    const spec = {
      id: 'w',
      title: 'w',
      metricLabel: 'w',
      stat: 'winners',
      perSet: true,
      season: 4,
    } as const;
    expect(statBoardPayload(spec).footnote).toContain('Fill-in matches excluded');
    expect(statBoardPayload({ ...spec, includeFillIns: true }).footnote).not.toContain(
      'Fill-in'
    );
  });

  it('applies the site-wide minimum-matches bar to a rate board', () => {
    const b = statBoardPayload({
      id: 'w',
      title: 'w',
      metricLabel: 'w',
      stat: 'winners',
      perSet: true,
      season: 4,
    });
    expect(b.footnote).toContain(`Min. ${SITE.perGameMinGames} matches`);
  });

  it('refuses to render a vote board for a sealed season', () => {
    // Seal season 4 for the length of this test, then put the list back as it
    // was. Restoring the *contents* rather than emptying the array matters:
    // S5's votes are genuinely sealed, and clearing it here would unseal them
    // for every test that runs after this one.
    const sealed = SITE.sealedVoteSeasons as unknown as number[];
    const before = [...sealed];
    sealed.push(4);
    try {
      const spec = {
        id: 'mvp',
        title: 'The MVP Race',
        metricLabel: 'Votes',
        season: 4,
      } as const;
      expect(() => statBoardPayload({ ...spec, stat: 'votes' })).toThrow(SealedVotesError);
      // BOG is derived from votes, so it leaks the same secret.
      expect(() => statBoardPayload({ ...spec, stat: 'bog' })).toThrow(SealedVotesError);
      expect(() => statBoardPayload({ ...spec, stat: 'finalsVotes' })).toThrow(
        SealedVotesError
      );
      // Everything else still renders — only the votes are under seal.
      expect(() =>
        statBoardPayload({ ...spec, stat: 'winners', perSet: true })
      ).not.toThrow();
    } finally {
      sealed.length = 0;
      sealed.push(...before);
    }
  });

  it('leaves an unsealed season vote board alone', () => {
    expect(SITE.sealedVoteSeasons).not.toContain(4);
    expect(() =>
      statBoardPayload({ id: 'mvp', title: 'x', metricLabel: 'Votes', stat: 'votes', season: 4 })
    ).not.toThrow();
  });
});

describe('streak board', () => {
  it('mirrors the site’s winStreaks: same order and counts', () => {
    const p = streakBoardPayload();
    const src = winStreaks(rows).slice(0, 5);
    expect(p.rows).toHaveLength(5);
    expect(p.rows.map((r) => [r.player, r.streak, r.active])).toEqual(
      src.map((s) => [s.player, s.streak, s.active])
    );
    // Ranks are 1..5 in the payload's own order.
    expect(p.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('footnotes the asterisk only when a shown streak is still active', () => {
    const p = streakBoardPayload();
    const hasActive = p.rows.some((r) => r.active);
    expect(p.footnote.includes('* Streak still active')).toBe(hasActive);
    expect(p.footnote).toContain('Fill-in matches excluded');
  });
});

describe('predictions cards', () => {
  it('builds one card per analyst, each with all six awards', async () => {
    const cards = await predictionsPayloads(5);
    expect(cards).toHaveLength(ANALYSTS.length);
    expect(cards.map((c) => c.analyst)).toEqual(ANALYSTS.map((a) => a.analyst));
    for (const c of cards) {
      expect(c.picks.map((p) => p.category)).toEqual([
        'Champions', 'Minor Premiers', 'MVP', 'Finals MVP', 'Wooden Spoon', 'Most Improved',
      ]);
    }
  });

  it('resolves every pick to a real S5 team, colour and all', async () => {
    const cards = await predictionsPayloads(5);
    for (const c of cards) {
      for (const p of c.picks) {
        // A colour the TEAMS map has never seen would silently render on the
        // neutral chip — assert the real palette instead.
        expect(TEAMS[p.team], `${c.analyst} · ${p.category} → ${p.team}`).toBeDefined();
        expect(p.primary.length).toBeGreaterThan(0);
      }
    }
  });

  it('prints a colour pick with its pairing and a player pick with its team', async () => {
    const cards = await predictionsPayloads(5);
    const claude = cards.find((c) => c.analyst === 'AI (Claude)')!;

    // Team award: primary is the colour, secondary is the captain-first pairing.
    const champs = claude.picks.find((p) => p.category === 'Champions')!;
    expect(champs).toMatchObject({
      team: 'White',
      primary: 'White',
      secondary: 'J. Kierce & J. Virgona',
    });

    // Individual award: primary is the player, secondary (and the colour) is their team.
    const finalsMvp = claude.picks.find((p) => p.category === 'Finals MVP')!;
    expect(finalsMvp).toMatchObject({
      team: 'White',
      primary: 'Jonathan Kierce',
      secondary: 'White',
    });
  });

  it('slugs the analyst name for the filename', async () => {
    const cards = await predictionsPayloads(5);
    expect(cards.map((c) => c.slug)).toContain('the-commissioner');
    expect(cards.map((c) => c.slug)).toContain('ai-claude');
  });
});

describe('pair board', () => {
  const board = pairBoardPayload('Ed Simpson', 'Jimmy Gorton');

  it('prints the record stats.ts derived, and does no arithmetic of its own', () => {
    const rec = pairRecord('Ed Simpson', 'Jimmy Gorton', rows)!;
    expect(board.record).toBe(`${rec.wins}\u2013${rec.losses}`);
    expect(board.matchesLine).toBe(`${rec.matches} matches together`);
    expect(board.gamesLine).toBe(`${rec.gamesFor}\u2013${rec.gamesAgainst} games`);
    expect(board.seasons.map((s) => s.label)).toEqual(rec.seasons.map((s) => `S${s.season}`));
    expect(board.seasons.map((s) => s.team)).toEqual(rec.seasons.map((s) => s.team));
  });

  it('lights the bigger number, never "the better one"', () => {
    // Ranking never flips, as on every stat board: Simpson leads the unforced
    // errors because his number is larger, and `polarity` is what turns that
    // red instead of gold.
    const ue = board.stats.find((s) => s.label === 'Unforced errors')!;
    expect(Number(ue.a)).toBeGreaterThan(Number(ue.b));
    expect(ue.lead).toBe('a');
    expect(ue.polarity).toBe('low');

    const winners = board.stats.find((s) => s.label === 'Winners')!;
    expect(Number(winners.b)).toBeGreaterThan(Number(winners.a));
    expect(winners.lead).toBe('b');
    expect(winners.polarity).toBe('high');

    // Every row agrees: `lead` names whichever column holds the bigger number.
    for (const row of board.stats) {
      if (row.a === '\u2014' || row.b === '\u2014' || row.a === row.b) continue;
      expect(row.lead).toBe(Number(row.a) > Number(row.b) ? 'a' : 'b');
    }
  });

  it('footnotes the S1 vote rescale, because this window spans the eras', () => {
    expect(board.footnote).toContain('S1 votes scaled');
  });

  it('refuses a pair who played together in a season with sealed votes', () => {
    // Pink's S5 pair. The board carries votes and BOG, so it is refused rather
    // than rendered — the same rule the MVP race board lives under.
    expect(SITE.sealedVoteSeasons).toContain(5);
    expect(() => pairBoardPayload('Charlie Simpson', 'Damon Maurice')).toThrow(SealedVotesError);
  });

  it('refuses two players who have never partnered', () => {
    expect(() => pairBoardPayload('Jonathan Kierce', 'Jimmy Gorton')).toThrow(
      /never played a match as team-mates/
    );
  });
});

describe('MVP simulation board', () => {
  // A fixture rather than the owner's real summary file: the projection lives
  // outside this repo, so a test that read it would fail on a machine that
  // hasn't run the model. Everything here is shaped exactly like the real file
  // — percentages with a '%', votes bare, and the same column order.
  let dir: string;
  const csv = (body: string) =>
    '﻿Player,1st Percentage,Top 3 Percentage,Top 5 Percentage,Top 10 Percentage,' +
    'Median Votes,Team,Mean Votes,5th Pct Votes,95th Pct Votes\r\n' +
    body;

  // Six S5 players. Median votes are deliberately tied twice, so the
  // documented tiebreaks (mean, then MVP chance, then name) are exercised.
  const SAMPLE = csv(
    [
      'Lachlan Jenkin,98.4%,100.0%,100.0%,100.0%,26.0,Red,25.9,24,28',
      'Luke Sharrock,6.6%,99.8%,100.0%,100.0%,23.0,Yellow,23.0,21,24',
      'Charlie Simpson,0.0%,16.5%,83.4%,100.0%,18.0,Pink,18.1,16,20',
      'Ethan Seamer,0.0%,14.7%,64.8%,99.8%,18.0,Light Blue,17.6,15,21',
      'Will Mumme,0.0%,1.0%,23.4%,99.7%,16.0,Navy,15.9,14,18',
      'Jamie Harris,0.0%,0.0%,0.0%,0.0%,2.0,Red,1.8,1,3',
      '',
    ].join('\r\n')
  );

  const write = (name: string, text: string) => {
    const at = join(dir, name);
    writeFileSync(at, text);
    return at;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tnt-mvp-sim-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ranks by median votes, breaking ties on mean then MVP chance then name', async () => {
    const { slides } = await mvpSimPayloads(write('a.csv', SAMPLE), 5, resolveRound('5'));
    expect(slides).toHaveLength(1);
    expect(slides[0].rows.map((r) => r.player)).toEqual([
      'Lachlan Jenkin',
      'Luke Sharrock',
      // Both on 18; Charlie's mean (18.1) is the higher, so he leads.
      'Charlie Simpson',
      'Ethan Seamer',
      'Will Mumme',
      'Jamie Harris',
    ]);
    expect(slides[0].rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    // The printed column must read top to bottom, which is the whole reason
    // the board ranks on the number it prints.
    const votes = slides[0].rows.map((r) => Number(r.votes));
    expect([...votes].sort((x, y) => y - x)).toEqual(votes);
  });

  it('prints the percentages the way the source does, and a zero as a zero', async () => {
    const { slides } = await mvpSimPayloads(write('b.csv', SAMPLE), 5, resolveRound('5'));
    const [jenkin, , , , mumme, harris] = slides[0].rows;
    // Trailing ".0" dropped; a real decimal kept.
    expect(jenkin.cells.map((c) => c.value)).toEqual(['98.4', '100', '100', '100']);
    expect(mumme.cells.map((c) => c.value)).toEqual(['0', '1', '23.4', '99.7']);
    // 0% is a real result — the model never once produced that finish — so it
    // prints. A dash would mean "not recorded", which is a different claim.
    expect(harris.cells.every((c) => c.value === '0')).toBe(true);
    expect(harris.cells.every((c) => c.tone === 0)).toBe(true);
    // Tone is the plain share, for the template's wash.
    expect(jenkin.cells[0].tone).toBeCloseTo(0.984, 6);
    expect(jenkin.votes).toBe('26');
  });

  it('splits into slides of ten, numbered continuously', async () => {
    const many = csv(
      Array.from({ length: 23 }, (_, i) =>
        // Descending medians, so the expected order is the file's own order.
        `P${String(i).padStart(2, '0')},0.0%,0.0%,0.0%,0.0%,${100 - i}.0,Red,${100 - i},1,3`
      ).join('\r\n')
    );
    const { slides } = await mvpSimPayloads(write('c.csv', many), 5, resolveRound('5'));
    expect(slides.map((s) => s.rows.length)).toEqual([10, 10, 3]);
    expect(slides.map((s) => s.slide)).toEqual([1, 2, 3]);
    expect(slides.every((s) => s.slides === 3)).toBe(true);
    expect(slides[1].rows[0].rank).toBe(11);
    expect(slides[2].rows.at(-1)!.rank).toBe(23);
    // Every slide carries the same header — they're one carousel, and the
    // filename is what tells them apart.
    expect(new Set(slides.map((s) => s.subtitle)).size).toBe(1);
    // None of these fake players is on an S5 team, so each one is reported.
    expect(slides[0].rows.every((r) => r.team === null)).toBe(true);
  });

  it('takes the team from the season config and warns when the file disagrees', async () => {
    // Luke Sharrock is Yellow in season-5.ts; a file that claims otherwise
    // must not be able to recolour a row.
    const wrong = csv('Luke Sharrock,0.0%,0.0%,0.0%,0.1%,6.0,Green,6.4,5,9\r\n');
    const { slides, warnings } = await mvpSimPayloads(
      write('d.csv', wrong),
      5,
      resolveRound('5')
    );
    const cfg = await getSeasonConfig(5);
    expect(cfg!.teams!.Yellow.pair).toContain('Luke Sharrock');
    expect(slides[0].rows[0].team).toBe('Yellow');
    expect(
      warnings.some((w) => /Luke Sharrock on Green.*config has them on Yellow/.test(w))
    ).toBe(true);
  });

  it('colours a player whose team folded by the team he plays for now', async () => {
    // Angus Hume is in two `pair` lists: Black, which withdrew after round
    // four, and Green, which he moved to. The live team wins, and the team
    // that folded still claims the player who left with it.
    const moved = csv(
      'Angus Hume,0.0%,0.0%,0.0%,0.1%,6.0,Green,6.4,5,9\r\n' +
        'Archie Littlejohn,0.0%,0.0%,0.0%,0.0%,2.0,Black,2.0,1,4\r\n'
    );
    const { slides, warnings } = await mvpSimPayloads(
      write('f.csv', moved),
      5,
      resolveRound('5')
    );
    expect(slides[0].rows.map((r) => r.team)).toEqual(['Green', 'Black']);
    // Neither row is a disagreement with the config, so neither is reported.
    // (The rest of the field is missing from this two-row file, which is its
    // own warning and not what this test is about.)
    expect(warnings.some((w) => /config has them on/.test(w))).toBe(false);
  });

  it('warns about a player the season does not have, and renders them uncoloured', async () => {
    const stranger = csv('Roger Federer,0.0%,0.0%,0.0%,0.0%,1.0,Red,1.0,0,2\r\n');
    const { slides, warnings } = await mvpSimPayloads(
      write('e.csv', stranger),
      5,
      resolveRound('5')
    );
    expect(slides[0].rows[0].team).toBeNull();
    expect(warnings.some((w) => w.includes('"Roger Federer" is not on any Season 5 team'))).toBe(
      true
    );
  });

  it('fails loudly on a renamed column rather than parsing it as NaN', async () => {
    const renamed = SAMPLE.replace('Median Votes', 'Median Vote');
    await expect(mvpSimPayloads(write('f.csv', renamed), 5, resolveRound('5'))).rejects.toThrow(
      /no "Median Votes" column/
    );
  });

  it('is the one vote-derived board exempt from sealedVoteSeasons', async () => {
    // A deliberate, scoped exemption: this board prints a PROJECTION, and the
    // point of the post is to tease a live race. The seal still holds for every
    // board that reads the CSV's own `votes` column — that's what this pins.
    expect(SITE.sealedVoteSeasons).toContain(5);
    await expect(
      mvpSimPayloads(write('g.csv', SAMPLE), 5, resolveRound('5'))
    ).resolves.toBeDefined();
    expect(() =>
      statBoardPayload({ id: 'mvp', title: 'x', metricLabel: 'Votes', stat: 'votes', season: 5 })
    ).toThrow(SealedVotesError);
    expect(() => pairBoardPayload('Charlie Simpson', 'Damon Maurice')).toThrow(SealedVotesError);
  });

  it('says "pre-season" when there is no round to report after', async () => {
    const { slides } = await mvpSimPayloads(write('h.csv', SAMPLE), 5, null, { runs: 10000 });
    expect(slides[0].subtitle).toBe('10,000 runs · Pre-season');
    // And a run count is optional — the model may not report one.
    const bare = await mvpSimPayloads(write('i.csv', SAMPLE), 5, resolveRound('5'));
    expect(bare.slides[0].subtitle).toBe('Simulated · After Round 5');
  });
});
