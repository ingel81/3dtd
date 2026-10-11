/**
 * Paths: Draw adds a node per click and joins it to the last one; a click
 * near a node joins that node, a click near an edge splits it into a
 * junction (Alt places freely). Enter, Esc, a right click or a double click
 * ends the line. Edit selects and drags nodes (dropped on another node they
 * merge), selects edges; Delete removes, S smooths, X straightens, J joins
 * the two edges at a node into one.
 */
import type { MapPaths, MapPoint } from '../../world/custom-map/map-document';
import { SnapshotCommand, type EditCommand, type EditorDocument } from '../model/editor-document';
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
import { BrushStroke } from './brush-stroke';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

export class PathTool implements EditorTool {
  readonly id = 'paths' as const;
  /** The node the line goes on from while drawing */
  private last: string | null = null;
  private dragging: { id: string; before: MapPaths } | null = null;
  private lastClick = 0;

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
    const now = performance.now();
    const double = now - this.lastClick < 320;
    this.lastClick = now;
    if (s.mode === 'draw') {
      if (double && this.last) {
        this.cancel(ctx);
        return true;
      }
      this.drawClick(p, ctx);
      return true;
    }
    const picked = ctx.pick(p);
    if (picked?.kind === 'node') {
      ctx.editor.select({ kind: 'node', id: picked.id });
      this.dragging = { id: picked.id, before: structuredClone(ctx.editor.doc.paths) };
      return true;
    }
    if (picked?.kind === 'edge') {
      ctx.editor.select({ kind: 'edge', id: picked.id });
      return true;
    }
    ctx.editor.select(null);
    return true;
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    const d = this.dragging;
    if (!d || !p.hit) return;
    const doc = ctx.editor.doc;
    if (!insideMap(doc.terrain, p.hit)) return;
    moveNode(doc.paths, d.id, p.hit);
    ctx.editor.emit({ paths: true });
  }

  pointerUp(p: ToolPointer, ctx: ToolContext): void {
    const d = this.dragging;
    this.dragging = null;
    if (!d) return;
    const doc = ctx.editor.doc;
    const moved = nodeById(doc.paths, d.id);
    const original = nodeById(d.before, d.id);
    if (!moved || !original || (moved.x === original.x && moved.y === original.y)) return;
    let label = 'Move node';
    const onto = p.alt ? null : nearestNode(doc.paths, moved, ctx.settings.paths.snap * 0.6, d.id);
    if (onto) {
      mergeNodes(doc.paths, d.id, onto.id);
      ctx.editor.select({ kind: 'node', id: onto.id });
      label = 'Join nodes';
    }
    ctx.editor.push(new SnapshotCommand(label, { paths: d.before }, { paths: structuredClone(doc.paths) }), { paths: true });
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
    ctx.overlay.setDraft([from, this.snapPoint(p, ctx).point]);
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    const editor = ctx.editor;
    const sel = editor.selection;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter' && this.last) {
      this.cancel(ctx);
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && (sel?.kind === 'node' || sel?.kind === 'edge')) {
      editor.execute(pathCommands.remove(editor, sel.kind, sel.id));
      editor.select(null);
      return true;
    }
    if (k === 's' && (sel?.kind === 'edge' || sel?.kind === 'node')) {
      editor.execute(pathCommands.smooth(editor, edgesOf(editor, sel)));
      return true;
    }
    if (k === 'x' && (sel?.kind === 'edge' || sel?.kind === 'node')) {
      editor.execute(pathCommands.straighten(editor, edgesOf(editor, sel)));
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
  }

  hint(ctx: ToolContext): string {
    if (ctx.settings.paths.mode === 'edit') {
      return 'Click a node or edge | drag nodes, drop on a node to join | Del delete | S smooth | X straighten | J join edges';
    }
    return this.last
      ? 'Click to add the next node | near a node joins it, near a road makes a junction | Alt places freely | Enter or right click ends'
      : 'Click to start a road | near a node or road it branches off';
  }

  private drawClick(p: ToolPointer, ctx: ToolContext): void {
    const editor = ctx.editor;
    const s = ctx.settings.paths;
    if (!insideMap(editor.doc.terrain, p.hit!)) return;
    const target = this.snapPoint(p, ctx);
    const from = this.last;
    let end = '';
    const command = SnapshotCommand.record(editor.doc, from ? 'Draw road' : 'Start road', ['paths'], (d) => {
      if (target.node) end = target.node;
      else if (target.edge) end = splitEdge(d.paths, target.edge, target.point)!.id;
      else end = addNode(d.paths, target.point).id;
      if (from && from !== end) connect(d.paths, from, end, s.width, s.kind);
    });
    // A lone first click on empty ground leaves a node that waits for its edge
    editor.push(command, { paths: true });
    this.last = end;
    editor.select({ kind: 'node', id: end });
  }

  /** Where a click would land: an existing node, a point on an edge, or free ground */
  private snapPoint(p: ToolPointer, ctx: ToolContext): { point: MapPoint; node?: string; edge?: string } {
    const hit = { x: p.hit!.x, y: p.hit!.y };
    if (p.alt) return { point: hit };
    const paths = ctx.editor.doc.paths;
    const snap = ctx.settings.paths.snap;
    const node = nearestNode(paths, hit, snap);
    if (node && node.id !== this.last) return { point: { x: node.x, y: node.y }, node: node.id };
    const edge = nearestOnEdges(paths, hit, snap * 0.7);
    if (edge && edge.edge.a !== this.last && edge.edge.b !== this.last) return { point: edge.point, edge: edge.edge.id };
    return { point: hit };
  }
}

function edgesOf(editor: EditorDocument, sel: { kind: 'node' | 'edge'; id: string }): string[] {
  if (sel.kind === 'edge') return [sel.id];
  return editor.doc.paths.edges.filter((e) => e.a === sel.id || e.b === sel.id).map((e) => e.id);
}

/** Lonely nodes (a started road that never got its second click) go when the tool ends a line */
export function dropLonelyNodes(paths: MapPaths): void {
  paths.nodes = paths.nodes.filter((n) => paths.edges.some((e) => e.a === n.id || e.b === n.id));
}

export const pathCommands = {
  remove(editor: EditorDocument, kind: 'node' | 'edge', id: string): EditCommand {
    return SnapshotCommand.record(editor.doc, kind === 'node' ? 'Delete node' : 'Delete road', ['paths'], (d) => {
      if (kind === 'node') deleteNode(d.paths, id);
      else deleteEdge(d.paths, id);
      dropLonelyNodes(d.paths);
    });
  },
  smooth(editor: EditorDocument, edgeIds: string[]): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Smooth road', ['paths'], (d) => {
      for (const id of edgeIds) smoothEdge(d.paths, id);
    });
  },
  straighten(editor: EditorDocument, edgeIds: string[]): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Straighten road', ['paths'], (d) => {
      for (const id of edgeIds) straightenEdge(d.paths, id);
    });
  },
  dissolve(editor: EditorDocument, nodeId: string): EditCommand | null {
    const trial = structuredClone(editor.doc.paths);
    if (!dissolveNode(trial, nodeId)) return null;
    return SnapshotCommand.record(editor.doc, 'Join edges', ['paths'], (d) => dissolveNode(d.paths, nodeId));
  },
  setEdge(editor: EditorDocument, edgeIds: string[], patch: { width?: number; kind?: MapPaths['edges'][number]['kind'] }): EditCommand {
    return SnapshotCommand.record(editor.doc, patch.width !== undefined ? 'Road width' : 'Road kind', ['paths'], (d) => {
      const set = new Set(edgeIds);
      d.paths.edges = d.paths.edges.map((e) => (set.has(e.id) ? { ...e, ...patch } : e));
    });
  },
  /** Clear lonely nodes, as one step (after a line was abandoned) */
  tidy(editor: EditorDocument): EditCommand | null {
    const p = editor.doc.paths;
    if (p.nodes.every((n) => p.edges.some((e) => e.a === n.id || e.b === n.id))) return null;
    return SnapshotCommand.record(editor.doc, 'Tidy roads', ['paths'], (d) => dropLonelyNodes(d.paths));
  },
};

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
