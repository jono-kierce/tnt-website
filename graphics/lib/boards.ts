/**
 * The stat boards the CLI renders for a round.
 *
 * A spec is pure configuration — which stat, which window, which end of the
 * range is the good end. All the numbers still come from `stats.ts` via
 * `statBoardPayload`. Adding a board is adding an entry here; nothing else
 * needs to change.
 */

import type { StatBoardSpec } from './payloads.ts';

/**
 * Boards for one season's round. `season` is threaded through so the same list
 * works for any season, and a vote board on a sealed season is refused at
 * render time rather than being left out here — the CLI says why it skipped it.
 */
export function seasonBoards(season: number): StatBoardSpec[] {
  return [
    {
      id: 'mvp-race',
      title: 'The MVP Race',
      subtitle: 'Home & away votes · 3-2-1 from two voters',
      metricLabel: 'Votes',
      stat: 'votes',
      season,
      showPhoto: true,
      note: 'Finals votes are a separate award',
    },
    {
      id: 'good-stats',
      title: 'Good Stats',
      subtitle: 'Winners per set',
      metricLabel: 'Winners / set',
      stat: 'winners',
      perSet: true,
      season,
      polarity: 'high',
    },
    {
      id: 'bad-stats',
      title: 'Bad Stats',
      subtitle: 'Unforced errors per set',
      metricLabel: 'UE / set',
      stat: 'unforcedErrors',
      perSet: true,
      season,
      // Still ranked biggest-first — #1 always means the biggest number. The
      // ramp is what flips, so topping this board reads as the disgrace it is.
      polarity: 'low',
    },
    {
      id: 'clean-hitters',
      title: 'Clean Hitters',
      subtitle: 'Winners for every unforced error',
      metricLabel: 'W : UE',
      stat: 'winnerToUe',
      season,
      polarity: 'high',
    },
  ];
}

/** All-time boards — the ones that don't move week to week. */
export function careerBoards(): StatBoardSpec[] {
  return [
    {
      id: 'career-winners',
      title: 'Career Winners',
      subtitle: 'Per set · every season',
      metricLabel: 'Winners / set',
      stat: 'winners',
      perSet: true,
      polarity: 'high',
      showPhoto: true,
    },
    // A pair, and they're meant to be posted as one. Both count every night a
    // player was on court, fill-ins included — a 6-0 is a 6-0 whoever you were
    // turning out for, and leaving those matches out would quietly drop a
    // result somebody definitely remembers. `isBagelFor` keeps the semis and
    // the final out on its own, so nothing here has to say so.
    {
      id: 'bagels-handed-out',
      title: 'Bagels Handed Out',
      subtitle: '6-0 results',
      metricLabel: 'Bagels',
      stat: 'bagelsFor',
      polarity: 'high',
      rows: 10,
      includeFillIns: true,
    },
    {
      id: 'bagels-received',
      title: 'Bagels Received',
      subtitle: '6-0 defeats',
      metricLabel: 'Bagels',
      stat: 'bagelsAgainst',
      // Ranking never flips — #1 is the biggest number, as everywhere else.
      // The ramp is what turns this board red at the top.
      polarity: 'low',
      rows: 10,
      includeFillIns: true,
    },
  ];
}

/**
 * The main counting stats, each as a season total and a per-match rate — a
 * carousel of eight, rendered on request (`--only leaders`) rather than every
 * week alongside `seasonBoards`.
 *
 * "Per match" is the per-set rate over the home-and-away season, and the two
 * are the same number: every Tuesday match is one set, so on the `'regular'`
 * scope sets == matches. The scope is what keeps it honest — widen it and a
 * three-set semi would count as one "match" worth of winners times three. A
 * test holds every player's sets to their matches so the label can't drift.
 */
export function leaderBoards(season: number): StatBoardSpec[] {
  const stats = [
    { key: 'winners', title: 'Winners', polarity: 'high' },
    // #1 is still the biggest number; the ramp flips so topping it reads red.
    { key: 'unforcedErrors', title: 'Unforced Errors', polarity: 'low' },
    { key: 'aces', title: 'Aces', polarity: 'high' },
    { key: 'errorsForced', title: 'Errors Forced', polarity: 'high' },
  ] as const;
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

  // The title stays the bare stat on both boards so it never wraps; the
  // subtitle and the column heading are what tell the pair apart.
  return stats.flatMap(({ key, title, polarity }): StatBoardSpec[] => [
    {
      id: `${slug(title)}-total`,
      title,
      subtitle: 'Season total · home & away',
      metricLabel: 'Total',
      heroUnit: title,
      stat: key,
      season,
      scope: 'regular',
      polarity,
      showPhoto: true,
    },
    {
      id: `${slug(title)}-per-match`,
      title,
      subtitle: 'Per match · home & away',
      metricLabel: 'Per match',
      heroUnit: `${title} / match`,
      stat: key,
      perSet: true,
      season,
      scope: 'regular',
      polarity,
      showPhoto: true,
      // Second frame where there is one, so a player leading both halves of
      // a stat isn't pictured identically on consecutive slides.
      photoIndex: 1,
    },
  ]);
}
