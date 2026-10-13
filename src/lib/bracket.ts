import type { FinalsMatch, FinalsRound, FinalsSlot } from '../config/seasons/schema.ts';

/**
 * Where every tie in a finals bracket sits, and how the lines between them run.
 *
 * Shared by the season page (`FinalsBracket.astro`) and the Instagram finals
 * graphic, so a posted bracket and the printed one can't be drawn differently.
 * Pure geometry, in abstract units — each renderer multiplies by its own pixel
 * sizes — and nothing season-specific: the shape is read off the
 * `winnerOf`/`loserOf` references, so a straight knockout and an AFL-style
 * double chance both lay themselves out.
 *
 * Coordinates: a column per round, left to right. `pos` runs down the page,
 * one unit per tie in the busiest round, a tie's centre on its `pos`.
 *
 * The busiest round is the anchor. Its order comes from the rounds that follow
 * (each tie sorted by the average position of the ties it feeds), every later
 * tie sits at the average of whatever feeds it, and every earlier one lines up
 * with what it feeds. That's what lays a plain knockout out as 1v8 above 4v5
 * with their semi between them, and what puts the AFL qualifying finals in the
 * middle of their round with the elimination finals outside them, so each loser
 * drops a single row into the semi it's sent to.
 *
 * A tie can also feed one in its *own* round — S5's wildcard is played first
 * on the night of the qualifying and elimination finals, and its winner fills
 * a side of EF2. That tie stacks directly under (an `away` slot) or over (a
 * `home` slot) the one it feeds, joined by a short vertical `stacked` edge.
 */

export type EdgeKind = 'winner' | 'loser';
export type Slot = 'home' | 'away';

export interface PlacedTie {
  match: FinalsMatch;
  /** Round index, left to right. */
  col: number;
  /** Centre, in units down the page. */
  pos: number;
  /** A `loserOf` points at this tie: losing it isn't the end. */
  doubleChance: boolean;
}

export interface BracketEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Which side of the target this edge fills — it arrives on that row. */
  slot: Slot;
  fromCol: number;
  toCol: number;
  /** Leaves the source here (its centre, nudged apart when it has two exits). */
  y1: number;
  /** Arrives on the target's `slot` row (a stacked edge: the target's centre). */
  y2: number;
  /**
   * Source and target share a round: the source sits directly above or below
   * the target and the edge is a straight vertical run between their centres,
   * drawn behind both ties so only the gap between them shows.
   */
  stacked: boolean;
  /**
   * The vertical run sits in the gap just before the target's column. Edges
   * whose runs would overlap get separate lanes; `lane` is 0..lanes-1 and the
   * renderer spreads them across the gap.
   */
  lane: number;
  lanes: number;
}

export interface BracketLayout {
  columns: { round: FinalsRound; ties: PlacedTie[] }[];
  edges: BracketEdge[];
  /** Total height in units: every tie fits inside 0..span. */
  span: number;
  /** Any `loserOf` in the bracket. */
  doubleChance: boolean;
}

export interface LayoutOptions {
  /** A side row's centre, as an offset from the tie's centre. Default 0.16. */
  slot?: number;
  /** Gap between a tie's two exits, when it has two. Default 0.12. */
  port?: number;
  /** Closest two ties in one column may sit. Default 1. */
  minGap?: number;
}

const ref = (s: FinalsSlot): { id: string; kind: EdgeKind } | null =>
  'winnerOf' in s
    ? { id: s.winnerOf, kind: 'winner' }
    : 'loserOf' in s
      ? { id: s.loserOf, kind: 'loser' }
      : null;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Settle a column's targets into positions at least `gap` apart, each as close
 * to its target as it can get. Neighbours that would collide merge into one
 * block centred on their targets' mean, and blocks keep merging until nothing
 * overlaps — which keeps a lone tie exactly on its target.
 */
function spread(targets: number[], gap: number): number[] {
  type Block = { start: number; n: number; sum: number };
  const blocks: Block[] = [];
  const top = (b: Block) => b.sum / b.n - ((b.n - 1) * gap) / 2;
  for (let i = 0; i < targets.length; i++) {
    blocks.push({ start: i, n: 1, sum: targets[i] });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (top(a) + a.n * gap <= top(b) + 1e-9) break;
      // Each member's target minus its offset in the block: the block's top
      // is the mean of those, and its centre the mean of the targets.
      blocks.splice(-2, 2, { start: a.start, n: a.n + b.n, sum: a.sum + b.sum });
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(top(b) + k * gap);
  return out;
}

export function bracketLayout(finals: FinalsRound[], opts: LayoutOptions = {}): BracketLayout {
  const slotOff = opts.slot ?? 0.16;
  const portGap = opts.port ?? 0.12;
  const minGap = opts.minGap ?? 1;

  const colOf = new Map<string, number>();
  const declared = new Map<string, number>();
  finals.forEach((r, c) =>
    r.matches.forEach((m, i) => {
      colOf.set(m.id, c);
      declared.set(m.id, i);
    })
  );

  // Every reference to an earlier tie — or one earlier in the same round — is
  // an edge. A dangling or backwards reference draws nothing rather than a
  // line to nowhere.
  type Raw = { from: string; to: string; kind: EdgeKind; slot: Slot };
  const raw: Raw[] = [];
  for (const r of finals) {
    for (const m of r.matches) {
      for (const slot of ['home', 'away'] as const) {
        const src = ref(m[slot]);
        if (!src) continue;
        const fc = colOf.get(src.id);
        if (fc === undefined || fc > colOf.get(m.id)! || src.id === m.id) continue;
        raw.push({ from: src.id, to: m.id, kind: src.kind, slot });
      }
    }
  }
  const into = (id: string) => raw.filter((e) => e.to === id);
  const outOf = (id: string) => raw.filter((e) => e.from === id);

  const pos = new Map<string, number>();
  // Where an edge lands relative to its target's centre.
  const landing = (e: Raw) => pos.get(e.to)! + (e.slot === 'home' ? -slotOff : slotOff);

  const anchor = finals.reduce(
    (best, r, c) => (r.matches.length > finals[best].matches.length ? c : best),
    0
  );

  /** Lay one column out from per-tie targets; untargeted ties keep their turn. */
  function place(c: number, target: (id: string) => number | undefined) {
    const ids = finals[c].matches.map((m) => m.id);
    let fallback = 0;
    const want = ids.map((id) => {
      const t = target(id);
      if (t !== undefined) return t;
      // A tie with nothing to line up on (a bare-seed pairing in a later
      // round) queues below the last placed one rather than landing on it.
      return (fallback = Math.max(fallback, ...[...pos.values()]) + minGap);
    });
    const order = ids
      .map((id, i) => ({ id, want: want[i], i }))
      .sort((a, b) => a.want - b.want || a.i - b.i);
    const at = spread(order.map((o) => o.want), minGap);
    order.forEach((o, k) => pos.set(o.id, at[k]));
  }

  const forward = () => {
    for (let c = anchor + 1; c < finals.length; c++) {
      place(c, (id) => {
        const fed = into(id).filter((e) => pos.has(e.from));
        return fed.length ? mean(fed.map((e) => pos.get(e.from)!)) : undefined;
      });
    }
  };

  // Anchor in declared order first, then let what it feeds sort it, twice —
  // the second pass settles any order the first pass only half fixed.
  finals[anchor].matches.forEach((m, i) => pos.set(m.id, i + 0.5));
  for (let pass = 0; pass < 2; pass++) {
    forward();
    const ids = finals[anchor].matches.map((m) => m.id);
    const key = (id: string, depth = 0): number => {
      const outs = outOf(id).filter((e) => colOf.get(e.to)! > anchor);
      if (outs.length) return mean(outs.map((e) => pos.get(e.to)!));
      // A tie feeding one in this same round sorts right next to it: before
      // it to fill the top row, after it to fill the bottom.
      const stacked = outOf(id).find((e) => colOf.get(e.to) === anchor);
      if (stacked && depth < ids.length) {
        return key(stacked.to, depth + 1) + (stacked.slot === 'home' ? -1e-3 : 1e-3);
      }
      return declared.get(id)! + 0.5;
    };
    [...ids]
      .sort((a, b) => key(a) - key(b) || declared.get(a)! - declared.get(b)!)
      .forEach((id, i) => pos.set(id, i + 0.5));
  }
  forward();
  // Earlier rounds line up with the row they feed, so a wildcard runs straight
  // into the side it fills.
  for (let c = anchor - 1; c >= 0; c--) {
    place(c, (id) => {
      const outs = outOf(id).filter((e) => pos.has(e.to));
      return outs.length ? mean(outs.map(landing)) : undefined;
    });
  }

  // Shift so the topmost tie's top edge sits on 0.
  const all = [...pos.values()];
  const shift = 0.5 - Math.min(...all);
  for (const [id, p] of pos) pos.set(id, p + shift);
  const span = Math.max(...pos.values()) + 0.5;

  // --- Exits. A tie with two exits splits them so neither crosses the other:
  // edges heading up leave from the top, earliest turn uppermost; edges heading
  // down leave from the bottom, earliest turn lowest. A loser dropping one row
  // into the next round then peels away inside the winner's line, not across it.
  const exitY = new Map<Raw, number>();
  for (const id of pos.keys()) {
    const outs = outOf(id).filter((e) => colOf.get(e.to) !== colOf.get(id));
    const y0 = pos.get(id)!;
    const dir = (e: Raw) => Math.sign(landing(e) - y0);
    const sorted = [...outs].sort((a, b) => {
      if (dir(a) !== dir(b)) return dir(a) - dir(b);
      const ca = colOf.get(a.to)!, cb = colOf.get(b.to)!;
      return dir(a) < 0 ? ca - cb : cb - ca;
    });
    sorted.forEach((e, k) => exitY.set(e, y0 + (k - (sorted.length - 1) / 2) * portGap));
  }

  // --- Lanes. Within one gap, two vertical runs that overlap can't share an x.
  const edges: BracketEdge[] = raw.map((e) => {
    const stacked = colOf.get(e.from) === colOf.get(e.to);
    return {
      ...e,
      fromCol: colOf.get(e.from)!,
      toCol: colOf.get(e.to)!,
      y1: stacked ? pos.get(e.from)! : exitY.get(e)!,
      y2: stacked ? pos.get(e.to)! : landing(e),
      stacked,
      lane: 0,
      lanes: 1,
    };
  });
  for (let c = 1; c < finals.length; c++) {
    const gap = edges
      .filter((e) => e.toCol === c && !e.stacked && Math.abs(e.y2 - e.y1) > 1e-9)
      .sort((a, b) => Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2));
    const laneEnds: number[] = [];
    for (const e of gap) {
      const lo = Math.min(e.y1, e.y2), hi = Math.max(e.y1, e.y2);
      let lane = laneEnds.findIndex((end) => end < lo - 1e-9);
      if (lane === -1) lane = laneEnds.push(hi) - 1;
      else laneEnds[lane] = hi;
      e.lane = lane;
    }
    for (const e of gap) e.lanes = laneEnds.length;
  }

  const losersOf = new Set(raw.filter((e) => e.kind === 'loser').map((e) => e.from));
  return {
    columns: finals.map((round, c) => ({
      round,
      ties: round.matches
        .map((match) => ({
          match,
          col: c,
          pos: pos.get(match.id)!,
          doubleChance: losersOf.has(match.id),
        }))
        .sort((a, b) => a.pos - b.pos),
    })),
    edges,
    span,
    doubleChance: losersOf.size > 0,
  };
}
