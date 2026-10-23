/**
 * Which way a felled tree falls (docs/DESTRUCTION_PLAN.md, "Bäume fallen"):
 * away from its blast, turned up to FALL_TURN towards where the fewest
 * standing trees stand in its crown's way, so it lies where it shows, not
 * under the next crowns. A function of the map's trees and which of them
 * still stand: the same on every client, after a restore and a seek.
 */

/** A felled tree turns at most this far (radians, 60°) from the way its blast pushed it, in FALL_STEPS steps each side */
export const FALL_TURN = Math.PI / 3;
const FALL_STEPS = 4;
/** What turning a step costs against a standing tree in the way: the straight way wins where it is about as open */
const FALL_STRAIGHT = 0.08;
/** Metres past its height a felled tree looks for standing ones */
const FALL_REACH_PAD = 6;
/** Edge of a cell of the trees' grid, m */
const TREE_CELL = 16;

/** A tree as the fall reads it: map metres, its crown's radius and its height, m */
export interface TreeSpot {
  id: string;
  x: number;
  y: number;
  crown: number;
  height: number;
}

/** The map's trees on a grid */
export class TreeGrid {
  private readonly cells = new Map<string, TreeSpot[]>();

  constructor(trees: Iterable<TreeSpot>) {
    for (const t of trees) {
      const key = `${Math.floor(t.x / TREE_CELL)},${Math.floor(t.y / TREE_CELL)}`;
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(t);
    }
  }

  /** The trees whose cells reach within `reach` m of (`x`, `y`) */
  near(x: number, y: number, reach: number, out: TreeSpot[] = []): TreeSpot[] {
    const c0 = Math.floor((x - reach) / TREE_CELL);
    const c1 = Math.floor((x + reach) / TREE_CELL);
    const r0 = Math.floor((y - reach) / TREE_CELL);
    const r1 = Math.floor((y + reach) / TREE_CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(...(this.cells.get(`${c},${r}`) ?? []));
    return out;
  }
}

/**
 * The way (map radians) tree `tree` falls: within FALL_TURN of `away` (from
 * its blast) the one where the fewest trees that still `stand` reach into
 * its crown's way (each by how near the line it stands), straight away from
 * the blast where that is about as open
 */
export function fallWay(tree: TreeSpot, away: number, trees: TreeGrid, stands: (id: string) => boolean): number {
  const near = trees.near(tree.x, tree.y, tree.height + FALL_REACH_PAD).filter((t) => t.id !== tree.id && stands(t.id));
  if (!near.length) return away;
  let way = away;
  let least = Infinity;
  for (let k = 0; k <= FALL_STEPS * 2; k++) {
    // 0, then +1, -1, +2, -2 steps: the straighter way wins a tie
    const step = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
    const h = away + (step * FALL_TURN) / FALL_STEPS;
    const ux = Math.cos(h);
    const uy = Math.sin(h);
    let crowded = Math.abs(step) * FALL_STRAIGHT;
    for (const t of near) {
      const vx = t.x - tree.x;
      const vy = t.y - tree.y;
      const along = vx * ux + vy * uy;
      if (along <= 0 || along > tree.height + t.crown) continue;
      crowded += Math.max(0, 1 - Math.abs(vx * uy - vy * ux) / (t.crown + tree.crown));
    }
    if (crowded < least) {
      least = crowded;
      way = h;
    }
  }
  return way;
}
