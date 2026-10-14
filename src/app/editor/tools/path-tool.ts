/**
 * Paths: Draw adds a node per click and joins it to the last one; a click
 * near a node joins that node, a click near an edge splits it into a
 * junction (Alt places freely). Enter, Esc, a right click or a double click
 * ends the line. Edit selects and drags nodes (dropped on another node they
 * merge), selects edges; Shift adds to the selection, a drag on free ground
 * selects by box, Ctrl+A everything; dragging one of several selected nodes
 * moves them all. Delete removes, S smooths, X straightens, J joins the two
 * edges at a node into one.
 */
import type { MapPaths, MapPoint } from '../../world/custom-map/map-document';
import { SnapshotCommand, pathSelection, selectedEdges, selectedNodes, type EditCommand, type EditorDocument, type Selection } from '../model/editor-document';
import { insideMap } from '../model/grid';
import {
  addNode,
  connect,
  deleteEdge,
  deleteNode,
  dissolveNode,
  mergeNodes,
  moveNode,
  nearestNode,
  nearestOnEdges,
  nodeById,
  smoothEdge,
  splitEdge,
  straightenEdge,
} from '../ops/path-graph';
import { flattenUnderPaths, paintUnderPaths } from '../ops/path-terrain';
import { rebuildDressing, relayRoads, type RoadOptions } from '../ops/landscape/road';
import { LandscapeStroke } from '../ops/landscape/landscape-stroke';
import type { CatalogIndex } from '../catalog/asset-catalog';
import { symmetryImages } from '../ops/symmetry';
import { BrushStroke } from './brush-stroke';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

export class PathTool implements EditorTool {
  readonly id = 'paths' as const;
  /** The node the line goes on from while drawing */
  private last: string | null = null;
  /** Nodes being dragged: from where, and where each stood */
  private dragging: { ids: string[]; before: MapPaths; from: MapPoint; start: MapPoint[] } | null = null;
  /** A box being drawn on free ground (client pixels); `add` keeps what was selected */
  private box: { x0: number; y0: number; x1: number; y1: number; add: boolean } | null = null;
  private lastClick = 0;
  private lastClickAt = { x: -1e6, y: -1e6 };
  /** The last node of each symmetric image of the line being drawn */
  private mirrored: string[] = [];

  brushVisible(): boolean {
    return false;
  }

  activate(ctx: ToolContext): void {
    ctx.overlay.setNodesVisible(true);
  }

  deactivate(ctx: ToolContext): void {
    this.cancel(ctx);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button === 2 && this.last) {
      this.cancel(ctx);
      return true;
    }
    if (p.button !== 0 || !p.hit) return false;
    const s = ctx.settings.paths;
    // A double click is two clicks in the same spot: quick clicks along a road are nodes, not its end
    const now = performance.now();
    const double = now - this.lastClick < 320 && Math.hypot(p.clientX - this.lastClickAt.x, p.clientY - this.lastClickAt.y) < 6;
    this.lastClick = now;
    this.lastClickAt = { x: p.clientX, y: p.clientY };
    if (s.mode === 'draw') {
      if (double && this.last) {
        this.cancel(ctx);
        return true;
      }
      this.drawClick(p, ctx);
      return true;
    }
    const editor = ctx.editor;
    const picked = ctx.pick(p);
    const nodes = selectedNodes(editor.selection);
    const edges = selectedEdges(editor.selection);
    if (picked?.kind === 'node') {
      if (p.shift) {
        editor.select(pathSelection(toggle(nodes, picked.id), edges));
        return true;
      }
      // One of several selected nodes drags them all
      const group = nodes.length > 1 && nodes.includes(picked.id);
      if (!group) editor.select({ kind: 'node', id: picked.id });
      const ids = group ? nodes : [picked.id];
      const paths = editor.doc.paths;
      this.dragging = {
        ids,
        before: structuredClone(paths),
        from: { x: p.hit.x, y: p.hit.y },
        start: ids.map((id) => {
          const n = nodeById(paths, id);
          return { x: n?.x ?? 0, y: n?.y ?? 0 };
        }),
      };
      return true;
    }
    if (picked?.kind === 'edge') {
      editor.select(p.shift ? pathSelection(nodes, toggle(edges, picked.id)) : { kind: 'edge', id: picked.id });
      return true;
    }
    this.box = { x0: p.clientX, y0: p.clientY, x1: p.clientX, y1: p.clientY, add: p.shift };
    return true;
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    const box = this.box;
    if (box) {
      box.x1 = p.clientX;
      box.y1 = p.clientY;
      ctx.setBox(box);
      return;
    }
    const d = this.dragging;
    if (!d || !p.hit) return;
    const doc = ctx.editor.doc;
    if (!insideMap(doc.terrain, p.hit)) return;
    const dx = p.hit.x - d.from.x;
    const dy = p.hit.y - d.from.y;
    // A single node goes where the pointer is; several keep their places to each other
    if (d.ids.length === 1) moveNode(doc.paths, d.ids[0], p.hit);
    else d.ids.forEach((id, k) => moveNode(doc.paths, id, { x: Math.round((d.start[k].x + dx) * 10) / 10, y: Math.round((d.start[k].y + dy) * 10) / 10 }));
    ctx.editor.emit({ paths: true });
  }

  pointerUp(p: ToolPointer, ctx: ToolContext): void {
    const box = this.box;
    this.box = null;
    if (box) {
      ctx.setBox(null);
      this.selectBox(box, ctx);
      return;
    }
    const d = this.dragging;
    this.dragging = null;
    if (!d) return;
    const doc = ctx.editor.doc;
    const movedAny = d.ids.some((id) => {
      const a = nodeById(doc.paths, id);
      const b = nodeById(d.before, id);
      return !!a && !!b && (a.x !== b.x || a.y !== b.y);
    });
    if (!movedAny) return;
    let label = d.ids.length > 1 ? 'Move nodes' : 'Move node';
    if (d.ids.length === 1) {
      const moved = nodeById(doc.paths, d.ids[0])!;
      const onto = p.alt ? null : nearestNode(doc.paths, moved, ctx.settings.paths.snap * 0.6, moved.id);
      if (onto) {
        mergeNodes(doc.paths, moved.id, onto.id);
        ctx.editor.select({ kind: 'node', id: onto.id });
        label = 'Join nodes';
      }
    }
    commitRoads(ctx.editor, ctx.catalog, label, d.before);
  }

  /** Nodes whose foot is in the box on the screen, and the roads with both ends in it */
  private selectBox(box: { x0: number; y0: number; x1: number; y1: number; add: boolean }, ctx: ToolContext): void {
    const editor = ctx.editor;
    if (Math.abs(box.x1 - box.x0) < 4 && Math.abs(box.y1 - box.y0) < 4) {
      if (!box.add) editor.select(null);
      return;
    }
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const y1 = Math.max(box.y0, box.y1);
    const paths = editor.doc.paths;
    const inside = new Set(
      paths.nodes
        .filter((n) => {
          const q = ctx.toScreen(n.x, n.y, ctx.heightAt(n.x, n.y));
          return !!q && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
        })
        .map((n) => n.id),
    );
    const edges = paths.edges.filter((e) => inside.has(e.a) && inside.has(e.b)).map((e) => e.id);
    const keep = box.add ? editor.selection : null;
    const nodes = [...new Set([...selectedNodes(keep), ...inside])];
    const all = [...new Set([...selectedEdges(keep), ...edges])];
    editor.select(pathSelection(nodes, all));
    const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
    ctx.status(`${count(nodes.length, 'node')} and ${count(all.length, 'road')} selected`);
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    if (ctx.settings.paths.mode !== 'draw' || !this.last || !p?.hit) {
      ctx.overlay.setDraft(null);
      return;
    }
    const from = nodeById(ctx.editor.doc.paths, this.last);
    if (!from) {
      this.last = null;
      return;
    }
    ctx.overlay.setDraft([from, snapPoint(ctx.editor.doc.paths, p.hit, p.alt, this.last, ctx.settings.paths.snap).point]);
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    const editor = ctx.editor;
    const sel = editor.selection;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter' && this.last) {
      this.cancel(ctx);
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'a' && ctx.settings.paths.mode === 'edit') {
      const paths = editor.doc.paths;
      editor.select(pathSelection(paths.nodes.map((n) => n.id), paths.edges.map((x) => x.id)));
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const nodes = selectedNodes(sel);
    const edges = selectedEdges(sel);
    if ((e.key === 'Delete' || e.key === 'Backspace') && (nodes.length || edges.length)) {
      editor.execute(pathCommands.removeMany(editor, nodes, edges));
      editor.select(null);
      return true;
    }
    if (k === 's' && (nodes.length || edges.length)) {
      editRoads(editor, ctx.catalog, 'Smooth road', (paths) => edgesOf(editor, sel).forEach((id) => smoothEdge(paths, id)));
      return true;
    }
    if (k === 'x' && (nodes.length || edges.length)) {
      editRoads(editor, ctx.catalog, 'Straighten road', (paths) => edgesOf(editor, sel).forEach((id) => straightenEdge(paths, id)));
      return true;
    }
    if (k === 'j' && sel?.kind === 'node') {
      const command = pathCommands.dissolve(editor, sel.id);
      if (command) {
        editor.execute(command);
        editor.select(null);
      } else ctx.status('Only a node between exactly two edges can be joined away');
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    const last = this.last;
    this.last = null;
    this.mirrored = [];
    // A line that never got its second node takes its lone start back
    if (last && ctx.editor.undoLabel === 'Start road' && !ctx.editor.doc.paths.edges.some((e) => e.a === last || e.b === last)) {
      ctx.editor.undo();
    }
    ctx.overlay.setDraft(null);
    if (this.dragging) {
      ctx.editor.doc.paths = this.dragging.before;
      ctx.editor.emit({ paths: true });
      this.dragging = null;
    }
    if (this.box) {
      ctx.setBox(null);
      this.box = null;
    }
  }

  hint(ctx: ToolContext): string {
    if (ctx.settings.paths.mode === 'edit') {
      return 'Click a node or edge, Shift adds, drag a box on free ground | drag nodes, drop on a node to join | Del delete | S smooth | X straighten | J join edges';
    }
    return this.last
      ? 'Click to add the next node | near a node joins it, near a road makes a junction | Alt places freely | Enter or right click ends'
      : 'Click to start a road | near a node or road it branches off';
  }

  private drawClick(p: ToolPointer, ctx: ToolContext): void {
    const editor = ctx.editor;
    const s = ctx.settings.paths;
    if (!insideMap(editor.doc.terrain, p.hit!)) return;
    const t = editor.doc.terrain;
    const images = symmetryImages(ctx.settings.symmetry, t.grid.columns === t.grid.rows);
    const hit = { x: p.hit!.x, y: p.hit!.y };
    const from = this.last;
    const ends: string[] = [];
    const command = SnapshotCommand.record(editor.doc, from ? 'Draw road' : 'Start road', ['paths'], (d) => {
      // The road where the pointer is, then its symmetric images, each going on from its own last node
      images.forEach((img, k) => {
        const last = k === 0 ? from : (this.mirrored[k - 1] ?? null);
        if (k > 0 && from && !last) return;
        const target = snapPoint(d.paths, img.point(hit), p.alt, last, s.snap);
        let end: string;
        if (target.node) end = target.node;
        else if (target.edge) end = splitEdge(d.paths, target.edge, target.point)!.id;
        else end = addNode(d.paths, target.point).id;
        if (last && last !== end) connect(d.paths, last, end, s.width, s.kind);
        ends.push(end);
      });
    });
    // A lone first click on empty ground leaves a node that waits for its edge
    editor.push(command, { paths: true });
    this.last = ends[0];
    this.mirrored = ends.slice(1);
    editor.select({ kind: 'node', id: ends[0] });
  }


}

/** Where a click would land: an existing node, a point on an edge, or free ground (alt: always free) */
function snapPoint(paths: MapPaths, at: MapPoint, free: boolean, last: string | null, snap: number): { point: MapPoint; node?: string; edge?: string } {
  const point = { x: at.x, y: at.y };
  if (free) return { point };
  const node = nearestNode(paths, point, snap);
  if (node && node.id !== last) return { point: { x: node.x, y: node.y }, node: node.id };
  const edge = nearestOnEdges(paths, point, snap * 0.7);
  if (edge && edge.edge.a !== last && edge.edge.b !== last) return { point: edge.point, edge: edge.edge.id };
  return { point };
}

/** The selected roads and the roads at the selected nodes */
function edgesOf(editor: EditorDocument, sel: Selection): string[] {
  const edges = new Set(selectedEdges(sel));
  const nodes = new Set(selectedNodes(sel));
  return editor.doc.paths.edges.filter((e) => edges.has(e.id) || nodes.has(e.a) || nodes.has(e.b)).map((e) => e.id);
}

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

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
  const stroke = new LandscapeStroke(editor, 'Rebuild road dressing', 1, catalog);
  const surface = road.surface.find((m) => catalog.materials.has(m));
  rebuildDressing(stroke, edgeIds, { adapt: road.adapt, ...(surface ? { surface } : {}), lamps: road.lamps, fences: road.fences, objects: [] });
  stroke.changed({ paths: true });
  stroke.finish();
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
function commitRoads(editor: EditorDocument, catalog: CatalogIndex, label: string, before: MapPaths): void {
  const doc = editor.doc;
  const after = doc.paths;
  // The stroke has to see the paths of before, then the new ones
  doc.paths = structuredClone(before);
  const stroke = new LandscapeStroke(editor, label, 1, catalog);
  stroke.markPaths();
  doc.paths = after;
  stroke.refreshRoads();
  relayRoads(stroke, before);
  stroke.changed({ paths: true });
  stroke.finish();
}

/** "Flatten road" over the given edges (all when null) as one undo step */
export function flattenRoads(editor: EditorDocument, edgeIds: string[] | null): boolean {
  const stroke = new BrushStroke(editor, 'Flatten roads', ['heights']);
  const rect = flattenUnderPaths(editor.doc.terrain, editor.doc.paths, edgeIds, undefined, (r) => stroke.touch('heights', r));
  if (rect) stroke.changed({ heights: rect });
  return stroke.finish() !== null;
}

/** Paint a ground layer under the given edges as one undo step */
export function paintRoads(editor: EditorDocument, layer: number, edgeIds: string[] | null): boolean {
  const stroke = new BrushStroke(editor, 'Paint roads', ['splat0', 'splat1']);
  const rect = paintUnderPaths(editor.doc.terrain, editor.doc.paths, layer, edgeIds, 2, (r) => {
    stroke.touch('splat0', r);
    stroke.touch('splat1', r);
  });
  if (rect) stroke.changed({ splat: rect });
  return stroke.finish() !== null;
}
