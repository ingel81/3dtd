/**
 * The road network as undoable steps: delete, join, tidy, width and kind,
 * lines edited with the built roads laid anew, the dressing rebuilt, the
 * ground flattened and painted under the roads.
 */
import type { MapPaths } from '../../world/custom-map/map-document';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { EditCommand } from '../model/doc-change';
import type { EditorDocument } from '../model/editor-document';
import { SnapshotCommand } from '../model/commands/snapshot';
import { deleteEdge, deleteNode, dissolveNode } from '../../map-ops/path-graph';
import { flattenUnderPaths, paintUnderPaths } from '../../map-ops/path-terrain';
import { rebuildDressing, relayRoads, surfaceRoads, type RoadOptions } from './landscape/road';
import { LandscapeContext } from './landscape/landscape-context';

/** Lonely nodes (a started road that never got its second click) go when the tool ends a line */
export function dropLonelyNodes(paths: MapPaths): void {
  paths.nodes = paths.nodes.filter((n) => paths.edges.some((e) => e.a === n.id || e.b === n.id));
}

export const pathCommands = {
  /** Removes roads and nodes (with the roads at them) as one step */
  removeMany(editor: EditorDocument, nodes: readonly string[], edges: readonly string[]): EditCommand {
    const label = nodes.length + edges.length > 1 ? 'Delete roads' : nodes.length ? 'Delete node' : 'Delete road';
    return SnapshotCommand.record(editor.doc, label, ['paths'], (d) => {
      for (const id of edges) deleteEdge(d.paths, id);
      for (const id of nodes) deleteNode(d.paths, id);
      dropLonelyNodes(d.paths);
    });
  },
  dissolve(editor: EditorDocument, nodeId: string): EditCommand | null {
    const trial = structuredClone(editor.doc.paths);
    if (!dissolveNode(trial, nodeId)) return null;
    return SnapshotCommand.record(editor.doc, 'Join edges', ['paths'], (d) => dissolveNode(d.paths, nodeId));
  },
  /** Clear lonely nodes, as one step (after a line was abandoned) */
  tidy(editor: EditorDocument): EditCommand | null {
    const p = editor.doc.paths;
    if (p.nodes.every((n) => p.edges.some((e) => e.a === n.id || e.b === n.id))) return null;
    return SnapshotCommand.record(editor.doc, 'Tidy roads', ['paths'], (d) => dropLonelyNodes(d.paths));
  },
};

/**
 * Changes the road network as one undo step (`edit` works on the document's
 * paths); the roads the road brush built whose line or width changed are
 * laid anew along it (relayRoads)
 */
export function editRoads(editor: EditorDocument, catalog: CatalogIndex, label: string, edit: (paths: MapPaths) => void): void {
  const before = structuredClone(editor.doc.paths);
  edit(editor.doc.paths);
  commitRoads(editor, catalog, label, before);
}

/**
 * "Rebuild road dressing": the selected roads' embankment, surface, lamps
 * and fences laid anew along their lines, from their dress, what the map
 * shows, or the road brush's settings; one step
 */
export function rebuildRoads(editor: EditorDocument, catalog: CatalogIndex, edgeIds: readonly string[], road: RoadOptions): void {
  const stroke = new LandscapeContext(editor.begin('Rebuild road dressing'), 1, catalog);
  const surface = road.surface.find((m) => catalog.materials.has(m));
  rebuildDressing(stroke, edgeIds, { adapt: road.adapt, ...(surface ? { surface } : {}), lamps: road.lamps, fences: road.fences, objects: [] });
  stroke.changed({ paths: true });
  stroke.finish();
}

/** The surface of the selected roads (null: none, the drawn road), painted at once; one step */
export function setRoadSurface(editor: EditorDocument, catalog: CatalogIndex, edgeIds: readonly string[], material: string | null): number {
  const stroke = new LandscapeContext(editor.begin('Road surface'), 1, catalog);
  const n = surfaceRoads(stroke, edgeIds, material);
  stroke.finish();
  return n;
}

/** Width or kind for several roads as one step */
export function setRoads(editor: EditorDocument, catalog: CatalogIndex, edgeIds: readonly string[], patch: { width?: number; kind?: MapPaths['edges'][number]['kind'] }): void {
  const set = new Set(edgeIds);
  editRoads(editor, catalog, patch.width !== undefined ? 'Road width' : 'Road kind', (paths) => {
    paths.edges = paths.edges.map((e) => (set.has(e.id) ? { ...e, ...patch } : e));
  });
}

/**
 * The paths as they are now against `before`, kept as one step: a plain
 * snapshot, or with the built roads laid anew in a landscape stroke
 */
export function commitRoads(editor: EditorDocument, catalog: CatalogIndex, label: string, before: MapPaths): void {
  const doc = editor.doc;
  const after = doc.paths;
  // The stroke has to see the paths of before, then the new ones
  doc.paths = structuredClone(before);
  const stroke = new LandscapeContext(editor.begin(label), 1, catalog);
  stroke.markPaths();
  doc.paths = after;
  stroke.refreshRoads();
  relayRoads(stroke, before);
  stroke.changed({ paths: true });
  stroke.finish();
}

/** "Flatten road" over the given edges (all when null) as one undo step */
export function flattenRoads(editor: EditorDocument, edgeIds: string[] | null): boolean {
  const stroke = editor.begin('Flatten roads');
  const rect = flattenUnderPaths(editor.doc.terrain, editor.doc.paths, edgeIds, undefined, (r) => stroke.touch('heights', r));
  if (rect) stroke.changed({ heights: rect });
  return stroke.commit() !== null;
}

/** Paint a ground layer under the given edges as one undo step */
export function paintRoads(editor: EditorDocument, layer: number, edgeIds: string[] | null): boolean {
  const stroke = editor.begin('Paint roads');
  const rect = paintUnderPaths(editor.doc.terrain, editor.doc.paths, layer, edgeIds, 2, (r) => {
    stroke.touchSplat(r);
  });
  if (rect) stroke.changed({ splat: rect });
  return stroke.commit() !== null;
}
