/**
 * Objects: Place puts the chosen asset down per click, Scatter sprays the
 * chosen assets under the brush (Shift thins them out), Erase removes what
 * the brush covers, Select picks by click or box and moves, turns or
 * scales the selection by dragging (W, E, R pick which). Delete removes the
 * selection, Ctrl+D duplicates it.
 */
import type { MapObject, MapPoint } from '../../world/custom-map/map-document';
import { ObjectsCommand, type ObjectEdit } from '../model/editor-document';
import { insideMap } from '../model/grid';
import {
  ObjectGrid,
  ObjectIds,
  centroid,
  duplicateObjects,
  objectsInBox,
  objectsUnderBrush,
  scatterDab,
  snapTo,
} from '../ops/object-ops';
import { objectImages, sameSector, symmetryImages } from '../ops/symmetry';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

type Drag =
  | { kind: 'box'; x0: number; y0: number }
  | { kind: 'gizmo'; start: MapPoint; center: MapPoint; before: Map<string, MapObject> };

export class ObjectTool implements EditorTool {
  readonly id = 'objects' as const;
  private brushing: { added: MapObject[]; removed: ObjectEdit[]; grid: ObjectGrid; ids: ObjectIds; erase: boolean; origin?: MapPoint } | null = null;
  private drag: Drag | null = null;

  brushVisible(ctx: ToolContext): boolean {
    const mode = ctx.settings.objects.mode;
    return mode === 'scatter' || mode === 'erase';
  }


  deactivate(ctx: ToolContext): void {
    this.endBrush(ctx);
    this.cancel(ctx);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0) return false;
    const s = ctx.settings.objects;
    switch (s.mode) {
      case 'place':
        if (p.hit) this.place(p, ctx);
        return true;
      case 'scatter':
      case 'erase': {
        if (!p.hit) return true;
        const erase = s.mode === 'erase' || p.shift;
        if (s.mode === 'scatter' && !erase && !this.scatterAssets(ctx).length) {
          ctx.status('Choose one or more assets to scatter');
          return true;
        }
        const doc = ctx.editor.doc;
        this.brushing = {
          added: [],
          removed: [],
          grid: new ObjectGrid(Math.max(2, s.scatter.minDistance), doc.objects),
          ids: new ObjectIds(doc.objects),
          erase,
        };
        return true;
      }
      case 'select':
        return this.selectDown(p, ctx);
    }
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'box') {
      ctx.setBox({ x0: drag.x0, y0: drag.y0, x1: p.clientX, y1: p.clientY });
      return;
    }
    if (!p.hit) return;
    this.applyGizmo(drag, p, ctx);
  }

  pointerUp(p: ToolPointer, ctx: ToolContext): void {
    this.endBrush(ctx);
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.kind === 'box') {
      ctx.setBox(null);
      const box = { x0: drag.x0, y0: drag.y0, x1: p.clientX, y1: p.clientY };
      if (Math.abs(box.x1 - box.x0) < 4 && Math.abs(box.y1 - box.y0) < 4) {
        if (!p.shift) ctx.editor.select(null);
        return;
      }
      const corners = ctx.boxToMap(box);
      if (!corners) return;
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const ids = objectsInBox(ctx.editor.doc, { x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) });
      const current = p.shift ? this.selected(ctx) : [];
      const all = [...new Set([...current, ...ids])];
      ctx.editor.select(all.length ? { kind: 'objects', ids: all } : null);
      ctx.status(`${ids.length} objects selected`);
      return;
    }
    const command = ObjectsCommand.fromStates(gizmoLabel(ctx), ctx.editor.doc, drag.before);
    if (!command.empty) ctx.editor.push(command);
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.objects;
    const sel = this.selected(ctx);
    if (s.mode === 'select' && sel.length) {
      const c = centroid(ctx.editor.doc, sel);
      ctx.overlay.setGizmo(c, this.gizmoRadius(ctx, sel));
    } else ctx.overlay.setGizmo(null, 0);

    const b = this.brushing;
    if (!b || !p?.hit) return;
    const doc = ctx.editor.doc;
    const brush = ctx.settings.brush;
    if (b.erase) {
      const assets = s.mode === 'scatter' ? new Set(this.scatterAssets(ctx)) : undefined;
      const ids = objectsUnderBrush(doc, p.hit, brush.radius, assets);
      if (!ids.length) return;
      const set = new Set(ids);
      // Only part of them per frame, so a held brush thins out instead of clearing at once
      const share = s.mode === 'erase' ? 1 : Math.min(1, dt * 4 * brush.strength);
      const removed: string[] = [];
      for (let k = doc.objects.length - 1; k >= 0; k--) {
        const o = doc.objects[k];
        if (!set.has(o.id) || Math.random() > share) continue;
        const added = b.added.findIndex((a) => a.id === o.id);
        if (added >= 0) b.added.splice(added, 1);
        else b.removed.push({ before: { ...o }, after: null, index: k });
        doc.objects.splice(k, 1);
        removed.push(o.id);
      }
      if (removed.length) ctx.editor.emit({ objects: removed });
      return;
    }
    const t = doc.terrain;
    const mode = ctx.settings.symmetry;
    b.origin ??= { x: p.hit.x, y: p.hit.y };
    const origin = b.origin;
    // With symmetry the scatter grows in the stroke's own sector and is copied to the others
    const own = scatterDab(t, p.hit, brush, { ...s.scatter, assets: this.scatterAssets(ctx) }, b.grid, b.ids, Math.random, Math.min(dt, 0.1) * 6)
      .filter((o) => sameSector(mode, o, origin));
    const images = objectImages(own, symmetryImages(mode, t.grid.columns === t.grid.rows), () => b.ids.take(), t.width / 2, t.depth / 2);
    for (const o of images) b.grid.add(o);
    const placed = [...own, ...images];
    if (!placed.length) return;
    doc.objects.push(...placed);
    b.added.push(...placed);
    ctx.editor.emit({ objects: placed.map((o) => o.id) });
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    const s = ctx.settings.objects;
    const sel = this.selected(ctx);
    const k = e.key.toLowerCase();
    if (!e.ctrlKey && !e.metaKey && (k === 'w' || k === 'e' || k === 'r')) {
      s.mode = 'select';
      s.gizmo = k === 'w' ? 'move' : k === 'e' ? 'rotate' : 'scale';
      ctx.settingsChanged();
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
      ctx.editor.execute(ObjectsCommand.remove(sel.length === 1 ? 'Delete object' : `Delete ${sel.length} objects`, ctx.editor.doc, sel));
      ctx.editor.select(null);
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'd' && sel.length) {
      const step = Math.max(2, s.snap || 4);
      const copies = duplicateObjects(ctx.editor.doc, sel, { x: step, y: -step });
      ctx.editor.execute(ObjectsCommand.add('Duplicate', ctx.editor.doc, copies));
      ctx.editor.select({ kind: 'objects', ids: copies.map((o) => o.id) });
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'a' && s.mode === 'select') {
      ctx.editor.select({ kind: 'objects', ids: ctx.editor.doc.objects.map((o) => o.id) });
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    if (this.drag?.kind === 'gizmo') {
      // Put the objects back where the drag found them
      const before = this.drag.before;
      const doc = ctx.editor.doc;
      doc.objects = doc.objects.map((o) => (before.has(o.id) ? { ...before.get(o.id)! } : o));
      ctx.editor.emit({ objects: [...before.keys()] });
    }
    this.drag = null;
    ctx.setBox(null);
    ctx.overlay.setGizmo(null, 0);
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.objects;
    switch (s.mode) {
      case 'place':
        return s.asset ? `Click to place ${ctx.catalog.object(s.asset).name}` : 'Choose an asset, then click to place it';
      case 'scatter':
        return 'Hold to scatter, Shift thins out | [ ] size';
      case 'erase':
        return 'Hold to remove objects under the brush';
      case 'select':
        return 'Click or drag a box to select | drag to move, turn or scale (W E R) | Del delete | Ctrl+D duplicate';
    }
  }

  private place(p: ToolPointer, ctx: ToolContext): void {
    const s = ctx.settings.objects;
    if (!s.asset) {
      ctx.status('Choose an asset first');
      return;
    }
    const doc = ctx.editor.doc;
    const x = snapTo(p.hit!.x, s.snap);
    const y = snapTo(p.hit!.y, s.snap);
    if (!insideMap(doc.terrain, { x, y })) return;
    const object: MapObject = {
      id: new ObjectIds(doc.objects).take(),
      asset: s.asset,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      z: 0,
      rotation: s.randomRotation ? Math.round(Math.random() * Math.PI * 2 * 1000) / 1000 : 0,
      scale: 1,
    };
    const t = doc.terrain;
    const ids = new ObjectIds([...doc.objects, object]);
    const images = objectImages([object], symmetryImages(ctx.settings.symmetry, t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2);
    ctx.editor.execute(ObjectsCommand.add(`Place ${ctx.catalog.object(s.asset).name}`, doc, [object, ...images]));
  }

  private selectDown(p: ToolPointer, ctx: ToolContext): boolean {
    const picked = ctx.pick(p);
    const sel = this.selected(ctx);
    if (picked?.kind === 'object') {
      if (p.shift) {
        const next = sel.includes(picked.id) ? sel.filter((id) => id !== picked.id) : [...sel, picked.id];
        ctx.editor.select(next.length ? { kind: 'objects', ids: next } : null);
        return true;
      }
      const ids = sel.includes(picked.id) ? sel : [picked.id];
      ctx.editor.select({ kind: 'objects', ids });
      if (p.hit) this.startGizmo(p, ctx, ids);
      return true;
    }
    // Inside the gizmo ring: drag the selection
    const c = sel.length ? centroid(ctx.editor.doc, sel) : null;
    if (c && p.hit && Math.hypot(p.hit.x - c.x, p.hit.y - c.y) <= this.gizmoRadius(ctx, sel) * 1.1) {
      this.startGizmo(p, ctx, sel);
      return true;
    }
    this.drag = { kind: 'box', x0: p.clientX, y0: p.clientY };
    return true;
  }

  private startGizmo(p: ToolPointer, ctx: ToolContext, ids: string[]): void {
    const doc = ctx.editor.doc;
    const set = new Set(ids);
    const before = new Map(doc.objects.filter((o) => set.has(o.id)).map((o) => [o.id, { ...o }]));
    this.drag = { kind: 'gizmo', start: { x: p.hit!.x, y: p.hit!.y }, center: centroid(doc, ids)!, before };
  }

  private applyGizmo(drag: Extract<Drag, { kind: 'gizmo' }>, p: ToolPointer, ctx: ToolContext): void {
    const s = ctx.settings.objects;
    const doc = ctx.editor.doc;
    const hit = p.hit!;
    const c = drag.center;
    let dx = hit.x - drag.start.x;
    let dy = hit.y - drag.start.y;
    const a0 = Math.atan2(drag.start.y - c.y, drag.start.x - c.x);
    let turn = Math.atan2(hit.y - c.y, hit.x - c.x) - a0;
    if (p.ctrl) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12);
    const d0 = Math.max(0.5, Math.hypot(drag.start.x - c.x, drag.start.y - c.y));
    const factor = Math.max(0.05, Math.hypot(hit.x - c.x, hit.y - c.y) / d0);
    if (s.snap > 0) {
      dx = snapTo(dx, s.snap);
      dy = snapTo(dy, s.snap);
    }
    const changed: string[] = [];
    doc.objects = doc.objects.map((o) => {
      const b = drag.before.get(o.id);
      if (!b) return o;
      changed.push(o.id);
      switch (s.gizmo) {
        case 'move':
          return { ...b, x: round(b.x + dx), y: round(b.y + dy) };
        case 'rotate': {
          // Turn around the selection's centre; each object turns with it (counter-clockwise from above)
          const rx = b.x - c.x;
          const ry = b.y - c.y;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          return { ...b, x: round(c.x + rx * cos - ry * sin), y: round(c.y + rx * sin + ry * cos), rotation: round(wrap(b.rotation + turn), 1000) };
        }
        case 'scale':
          return {
            ...b,
            scale: round(Math.min(20, Math.max(0.05, b.scale * factor)), 1000),
            x: round(c.x + (b.x - c.x) * (drag.before.size > 1 ? factor : 1)),
            y: round(c.y + (b.y - c.y) * (drag.before.size > 1 ? factor : 1)),
          };
      }
    });
    ctx.editor.emit({ objects: changed });
  }

  private gizmoRadius(ctx: ToolContext, ids: string[]): number {
    const doc = ctx.editor.doc;
    const c = centroid(doc, ids);
    if (!c) return 0;
    const set = new Set(ids);
    let r = 2;
    for (const o of doc.objects) {
      if (!set.has(o.id)) continue;
      r = Math.max(r, Math.hypot(o.x - c.x, o.y - c.y) + ctx.catalog.object(o.asset).radius * o.scale);
    }
    return r * 1.15;
  }

  private selected(ctx: ToolContext): string[] {
    const s = ctx.editor.selection;
    return s?.kind === 'objects' ? s.ids : [];
  }

  private scatterAssets(ctx: ToolContext): string[] {
    const s = ctx.settings.objects;
    if (s.scatter.assets.length) return [...s.scatter.assets];
    return s.asset ? [s.asset] : [];
  }

  private endBrush(ctx: ToolContext): void {
    const b = this.brushing;
    this.brushing = null;
    if (!b || (!b.added.length && !b.removed.length)) return;
    const doc = ctx.editor.doc;
    const edits: ObjectEdit[] = [
      ...b.removed,
      ...b.added.map((o) => ({ before: null, after: { ...o }, index: doc.objects.findIndex((x) => x.id === o.id) })),
    ];
    const label = b.erase ? `Remove ${b.removed.length} objects` : `Scatter ${b.added.length} objects`;
    ctx.editor.push(new ObjectsCommand(label, edits));
  }
}

function gizmoLabel(ctx: ToolContext): string {
  return { move: 'Move', rotate: 'Turn', scale: 'Scale' }[ctx.settings.objects.gizmo];
}

function round(v: number, f = 100): number {
  return Math.round(v * f) / f;
}

function wrap(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
