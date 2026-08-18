import { describe, expect, it } from 'vitest';
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
  seasonRounds,
  statBoardPayload,
  streakBoardPayload,
} from './payloads.ts';
import { ANALYSTS } from './predictions.ts';
import { ladderWithPairings, winStreaks } from '../../src/lib/stats.ts';
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
    // sealedVoteSeasons is empty today, so seal one for the length of this test.
    const sealed = SITE.sealedVoteSeasons as unknown as number[];
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
    }
  });

  it('leaves an unsealed season vote board alone', () => {
    expect(SITE.sealedVoteSeasons).toHaveLength(0);
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
