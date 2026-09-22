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
