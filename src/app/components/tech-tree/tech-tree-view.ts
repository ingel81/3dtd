/**
 * Maps a tech tree onto boxes and edge paths: the step between "here are the
 * nodes and what state they are in" and "draw this".
 *
 * Pure, so it can be unit tested without a DOM, and free of any domain
 * knowledge: research, the hero tree or anything else hands in the same shape.
 * The geometry itself comes from {@link layoutDag}.
 */
import { layoutDag, type DagEdge, type DagLayoutOptions, type DagOrientation } from '../../utils/dag-layout';
import type { TdIconName } from '../icon/icon.component';

/**
 * What a node looks like to the player.
 *
 * `poor` and `pending` are the two the game logic does not have: a node that
 * is open but out of reach of the purse, and one that is shut while every
 * prerequisite it still misses is running or queued already.
 */
export type TechTreeNodeState =
  | 'completed'
  | 'active'
  | 'queued'
  | 'available'
  | 'poor'
  | 'pending'
  | 'locked';

export interface TechTreeNode {
  id: string;
  title: string;
  /** One short line under the title, for instance the cost. */
  subtitle?: string;
  /** Set apart at the end of that line, for instance the duration. */
  subtitleAside?: string;
  /** The node's own icon, what it is. Stays the same in every state. */
  icon?: TdIconName;
  /**
   * Small glyph for the state, drawn at the end of the head row. Separate
   * from `icon` so a locked node still shows what it is instead of a row of
   * identical padlocks.
   */
  statusIcon?: TdIconName;
  /** Strand of the tree. Only used to tint the icon plate. */
  branch?: string;
  state: TechTreeNodeState;
  /** 0 to 1, drawn as a bar. Only read while the state is `active`. */
  progress?: number;
  /** Short mark in the corner, for instance the position in a queue. */
  badge?: string;
  /** Plain text for the tooltip, for instance the prerequisites still missing. */
  hint?: string;
}

export interface TechTreeViewNode extends TechTreeNode {
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How an edge reads, from the states of the two nodes it joins. */
export type TechTreeEdgeState = 'done' | 'active' | 'open' | 'pending' | 'locked';

export interface TechTreeViewEdge {
  from: string;
  to: string;
  path: string;
  skipsLevels: boolean;
  state: TechTreeEdgeState;
  /** Where the edge meets the target, for the small cap drawn there. */
  capX: number;
  capY: number;
}

export interface TechTreeView {
  nodes: TechTreeViewNode[];
  edges: TechTreeViewEdge[];
  width: number;
  height: number;
  /** The ids on each level, in drawing order. Feeds the tier gutter. */
  levels: string[][];
}

/**
 * Node box and gaps, in pixels. One place, so SVG and HTML cannot drift.
 *
 * Roomy on purpose: the graph is dragged and scrolled, so it does not have to
 * fit a dialog, and a cramped tree reads worse than a wide one.
 */
export const TECH_TREE_METRICS = {
  nodeWidth: 216,
  nodeHeight: 78,
  levelGap: 82,
  siblingGap: 22,
} as const;

export function buildTechTreeView(
  nodes: readonly TechTreeNode[],
  edges: readonly DagEdge[],
  orientation: DagOrientation = 'vertical',
): TechTreeView {
  const options: DagLayoutOptions = { ...TECH_TREE_METRICS, orientation };
  const layout = layoutDag(
    nodes.map((n) => ({ id: n.id })),
    edges,
    options,
  );

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placedById = new Map(layout.nodes.map((n) => [n.id, n]));
  const vertical = orientation === 'vertical';

  const viewNodes = layout.nodes.map((placed) => ({
    ...byId.get(placed.id)!,
    level: placed.level,
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
  }));

  const viewEdges = layout.edges.map((edge) => {
    const target = placedById.get(edge.to)!;
    return {
      from: edge.from,
      to: edge.to,
      path: edge.path,
      skipsLevels: edge.skipsLevels,
      state: edgeState(byId.get(edge.from)?.state, byId.get(edge.to)?.state),
      capX: vertical ? target.x + target.width / 2 : target.x,
      capY: vertical ? target.y : target.y + target.height / 2,
    };
  });

  // Drawing order: a node sorted by level keeps the tab order along the tree
  // instead of following the order its data happened to arrive in.
  viewNodes.sort((a, b) => a.level - b.level || placedById.get(a.id)!.order - placedById.get(b.id)!.order);

  const levels: string[][] = Array.from({ length: layout.levelCount }, () => []);
  for (const node of viewNodes) levels[node.level].push(node.id);

  return { nodes: viewNodes, edges: viewEdges, width: layout.width, height: layout.height, levels };
}

/**
 * How an edge reads: from the pair, not from one end. A line into a finished
 * node is finished; a line out of a finished node into a running one carries
 * the work; a line whose source is not done is only as alive as that source.
 */
function edgeState(from: TechTreeNodeState | undefined, to: TechTreeNodeState | undefined): TechTreeEdgeState {
  if (to === 'completed') return 'done';
  if (from === 'completed' && to === 'active') return 'active';
  if (from === 'completed') return 'open';
  if (from === 'active' || from === 'queued') return 'pending';
  return 'locked';
}

/**
 * Every node on the way back from `id` to the roots, and the edges between
 * them. Hovering a node lights this chain, which is how a player sees what a
 * research really costs in steps rather than in one price.
 */
export function chainToRoots(id: string, edges: readonly DagEdge[]): { nodes: Set<string>; edges: Set<string> } {
  const parents = new Map<string, string[]>();
  for (const edge of edges) parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);

  const nodes = new Set<string>([id]);
  const chain = new Set<string>();
  const walk = (current: string): void => {
    for (const parent of parents.get(current) ?? []) {
      chain.add(`${parent}>${current}`);
      if (nodes.has(parent)) continue;
      nodes.add(parent);
      walk(parent);
    }
  };
  walk(id);
  return { nodes, edges: chain };
}
