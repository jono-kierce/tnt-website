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
  ];
}
