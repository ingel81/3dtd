/**
 * Layered layout for a directed acyclic graph: which level a node sits on,
 * where it lands on the cross axis, and the path an edge takes between two
 * nodes.
 *
 * Kept free of Angular, SVG and any domain knowledge so the rules can be unit
 * tested on their own. The research tree (`research-tree.config.ts`) is the
 * first caller; the hero tech tree is meant to be the second, which is why
 * nothing here knows about costs, prerequisites or unlocks. Callers map their
 * own data onto {@link DagNode} and {@link DagEdge} and read coordinates back.
 */

/** A node to place. `id` is what edges refer to and what comes back out. */
export interface DagNode {
  id: string;
}

/** A directed edge. `from` must be laid out before `to`, that is the DAG. */
export interface DagEdge {
  from: string;
  to: string;
}

/** Which way the levels run. */
export type DagOrientation = 'horizontal' | 'vertical';

export interface DagLayoutOptions {
  /** Node box, in the same units the caller draws in. */
  nodeWidth: number;
  nodeHeight: number;
  /** Gap between two levels, edge of box to edge of box. */
  levelGap: number;
  /** Gap between two neighbours inside one level. */
  siblingGap: number;
  /**
   * `horizontal` puts level 0 on the left and lets levels grow to the right,
   * `vertical` puts it on top. Everything else is identical, only the two
   * axes swap.
   */
  orientation: DagOrientation;
}

export interface LaidOutNode {
  id: string;
  /** Longest path from any root, see {@link layoutDag}. Roots are 0. */
  level: number;
  /** Position inside the level, 0-based, in drawing order. */
  order: number;
  /** Top left corner of the node box. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  /**
   * True when the edge spans more than one level and therefore runs past the
   * levels in between. Drawn as a wider curve so it does not cut through the
   * boxes it passes.
   */
  skipsLevels: boolean;
  /** SVG path data, a cubic bezier from the source anchor to the target one. */
  path: string;
}

export interface DagLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  /** Bounding box of everything, starting at 0,0. */
  width: number;
  height: number;
  /** How many levels the graph has; 0 for an empty graph. */
  levelCount: number;
}

/** Thrown when the input is not a DAG, or an edge names a node that is absent. */
export class DagLayoutError extends Error {}

/**
 * Lays the graph out in levels.
 *
 * A node's level is the **longest** path from any root, not the depth of its
 * first parent. With two parents on different levels the node has to sit
 * behind the deeper one, otherwise its edge would run backwards. Today's
 * research tree has two nodes with two prerequisites each and both parents
 * happen to sit on the same level, so the rule makes no visible difference
 * yet; it makes one the first time somebody inserts a node where it does.
 *
 * Inside a level, nodes are ordered by the mean position of their
 * predecessors, which keeps most edges from crossing. One pass is enough at
 * this size: an iterative crossing reduction would be work without a visible
 * gain for twenty nodes. Nodes without predecessors keep the order they came
 * in, and ties are broken the same way, so the same input always gives the
 * same output and nodes do not jump around between two openings of a dialog.
 *
 * @throws DagLayoutError on a cycle or on an edge naming an unknown node.
 */
export function layoutDag(
  nodes: readonly DagNode[],
  edges: readonly DagEdge[],
  options: DagLayoutOptions,
): DagLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, levelCount: 0 };
  }

  const inputIndex = new Map<string, number>();
  nodes.forEach((node, i) => {
    if (inputIndex.has(node.id)) {
      throw new DagLayoutError(`Duplicate node id: ${node.id}`);
    }
    inputIndex.set(node.id, i);
  });

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const id of inputIndex.keys()) {
    parents.set(id, []);
    children.set(id, []);
  }
  for (const edge of edges) {
    if (!inputIndex.has(edge.from) || !inputIndex.has(edge.to)) {
      throw new DagLayoutError(`Edge names an unknown node: ${edge.from} -> ${edge.to}`);
    }
    parents.get(edge.to)!.push(edge.from);
    children.get(edge.from)!.push(edge.to);
  }

  const level = assignLevels(nodes, parents, children);
  const levels = groupByLevel(nodes, level);
  orderWithinLevels(levels, parents, inputIndex);

  const placed = place(levels, options);
  const placedById = new Map(placed.map((node) => [node.id, node]));

  const laidOutEdges = edges.map((edge) => {
    const from = placedById.get(edge.from)!;
    const to = placedById.get(edge.to)!;
    const skipsLevels = to.level - from.level > 1;
    return { from: edge.from, to: edge.to, skipsLevels, path: edgePath(from, to, skipsLevels, options) };
  });

  const width = Math.max(...placed.map((n) => n.x + n.width));
  const height = Math.max(...placed.map((n) => n.y + n.height));
  return { nodes: placed, edges: laidOutEdges, width, height, levelCount: levels.length };
}

/**
 * Longest path from a root, by processing nodes in topological order. The
 * count of unresolved parents doubles as the cycle check: if nothing is ready
 * while nodes are left, they hold each other up.
 */
function assignLevels(
  nodes: readonly DagNode[],
  parents: Map<string, string[]>,
  children: Map<string, string[]>,
): Map<string, number> {
  const level = new Map<string, number>();
  const open = new Map<string, number>();
  const ready: string[] = [];

  for (const node of nodes) {
    const count = parents.get(node.id)!.length;
    open.set(node.id, count);
    if (count === 0) {
      level.set(node.id, 0);
      ready.push(node.id);
    }
  }
  if (ready.length === 0) {
    throw new DagLayoutError('Every node has a prerequisite, so the graph has a cycle');
  }

  let resolved = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    resolved++;
    for (const child of children.get(id)!) {
      level.set(child, Math.max(level.get(child) ?? 0, level.get(id)! + 1));
      const left = open.get(child)! - 1;
      open.set(child, left);
      if (left === 0) ready.push(child);
    }
  }
  if (resolved < nodes.length) {
    const stuck = [...open.entries()].filter(([, left]) => left > 0).map(([id]) => id);
    throw new DagLayoutError(`Cycle through: ${stuck.join(', ')}`);
  }
  return level;
}

function groupByLevel(nodes: readonly DagNode[], level: Map<string, number>): string[][] {
  const levelCount = Math.max(...[...level.values()]) + 1;
  const levels: string[][] = Array.from({ length: levelCount }, () => []);
  // Input order first, so a level without any predecessor keeps it.
  for (const node of nodes) levels[level.get(node.id)!].push(node.id);
  return levels;
}

/**
 * Sorts each level by the mean position of its predecessors. Level 0 keeps
 * the input order, and every later level is sorted against positions that are
 * already final, so one top-down pass settles it.
 */
function orderWithinLevels(
  levels: string[][],
  parents: Map<string, string[]>,
  inputIndex: Map<string, number>,
): void {
  const positionInLevel = new Map<string, number>();
  levels[0]?.forEach((id, i) => positionInLevel.set(id, i));

  for (let l = 1; l < levels.length; l++) {
    const weight = new Map<string, number>();
    for (const id of levels[l]) {
      const own = parents.get(id)!.map((p) => positionInLevel.get(p)).filter((p): p is number => p !== undefined);
      // A node whose parents all sit further back than this level cannot be
      // weighted; it keeps its input order by falling back to +Infinity, which
      // sorts it after the weighted ones instead of in front of them.
      weight.set(id, own.length > 0 ? own.reduce((a, b) => a + b, 0) / own.length : Number.POSITIVE_INFINITY);
    }
    levels[l].sort((a, b) => {
      const d = weight.get(a)! - weight.get(b)!;
      return d !== 0 && Number.isFinite(d) ? d : inputIndex.get(a)! - inputIndex.get(b)!;
    });
    levels[l].forEach((id, i) => positionInLevel.set(id, i));
  }
}

/**
 * Turns levels and positions into boxes. Each level is centred against the
 * widest one, so a graph with a narrow first level does not hang off one side.
 */
function place(levels: string[][], options: DagLayoutOptions): LaidOutNode[] {
  const { nodeWidth, nodeHeight, levelGap, siblingGap, orientation } = options;
  const horizontal = orientation === 'horizontal';
  const crossSize = horizontal ? nodeHeight : nodeWidth;
  const levelSize = horizontal ? nodeWidth : nodeHeight;

  const extentOf = (count: number) => count * crossSize + Math.max(0, count - 1) * siblingGap;
  const widest = Math.max(...levels.map((ids) => extentOf(ids.length)));

  const out: LaidOutNode[] = [];
  levels.forEach((ids, levelIndex) => {
    const start = (widest - extentOf(ids.length)) / 2;
    ids.forEach((id, order) => {
      const along = levelIndex * (levelSize + levelGap);
      const across = start + order * (crossSize + siblingGap);
      out.push({
        id,
        level: levelIndex,
        order,
        x: horizontal ? along : across,
        y: horizontal ? across : along,
        width: nodeWidth,
        height: nodeHeight,
      });
    });
  });
  return out;
}

/**
 * Cubic bezier from the trailing edge of the source to the leading edge of the
 * target. The control points sit half a level gap away along the level axis,
 * which gives a flat S between neighbours; an edge that skips levels pushes
 * them out to the full span so the curve bows clear of the boxes in between.
 */
function edgePath(
  from: LaidOutNode,
  to: LaidOutNode,
  skipsLevels: boolean,
  options: DagLayoutOptions,
): string {
  const horizontal = options.orientation === 'horizontal';
  const x1 = horizontal ? from.x + from.width : from.x + from.width / 2;
  const y1 = horizontal ? from.y + from.height / 2 : from.y + from.height;
  const x2 = horizontal ? to.x : to.x + to.width / 2;
  const y2 = horizontal ? to.y + to.height / 2 : to.y;

  const span = horizontal ? x2 - x1 : y2 - y1;
  const reach = skipsLevels ? span * 0.5 : Math.max(options.levelGap * 0.5, span * 0.35);
  const c1x = horizontal ? x1 + reach : x1;
  const c1y = horizontal ? y1 : y1 + reach;
  const c2x = horizontal ? x2 - reach : x2;
  const c2y = horizontal ? y2 : y2 - reach;

  return `M ${round(x1)} ${round(y1)} C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(x2)} ${round(y2)}`;
}

/** Two decimals keep the path readable and the output stable across platforms. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
