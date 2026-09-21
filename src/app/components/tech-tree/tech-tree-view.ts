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

/** What a node looks like to the player. The five states research already uses. */
export type TechTreeNodeState = 'completed' | 'active' | 'queued' | 'available' | 'locked';

export interface TechTreeNode {
  id: string;
  title: string;
  /** One short line under the title, for instance cost and duration. */
  subtitle?: string;
  icon?: TdIconName;
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

export interface TechTreeViewEdge {
  from: string;
  to: string;
  path: string;
  skipsLevels: boolean;
  /**
   * True when the target is not reachable yet. Drawn faintly, so the part of
   * the tree that is open stands out from the part that is not.
   */
  dimmed: boolean;
}

export interface TechTreeView {
  nodes: TechTreeViewNode[];
  edges: TechTreeViewEdge[];
  width: number;
  height: number;
}

/** Node box and gaps, in pixels. One place, so SVG and HTML cannot drift. */
export const TECH_TREE_METRICS = {
  nodeWidth: 168,
  nodeHeight: 72,
  levelGap: 72,
  siblingGap: 16,
} as const;

export function buildTechTreeView(
  nodes: readonly TechTreeNode[],
  edges: readonly DagEdge[],
  orientation: DagOrientation = 'horizontal',
): TechTreeView {
  const options: DagLayoutOptions = { ...TECH_TREE_METRICS, orientation };
  const layout = layoutDag(
    nodes.map((n) => ({ id: n.id })),
    edges,
    options,
  );

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placedById = new Map(layout.nodes.map((n) => [n.id, n]));

  const viewNodes = layout.nodes.map((placed) => ({
    ...byId.get(placed.id)!,
    level: placed.level,
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
  }));

  const viewEdges = layout.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    path: edge.path,
    skipsLevels: edge.skipsLevels,
    dimmed: byId.get(edge.to)?.state === 'locked',
  }));

  // Drawing order: a node sorted by level keeps the tab order along the tree
  // instead of following the order its data happened to arrive in.
  viewNodes.sort((a, b) => a.level - b.level || placedById.get(a.id)!.order - placedById.get(b.id)!.order);

  return { nodes: viewNodes, edges: viewEdges, width: layout.width, height: layout.height };
}
