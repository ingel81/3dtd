/**
 * Objects: Place puts the chosen asset down per click, Scatter sprays the
 * chosen assets under the brush (Shift thins them out), Erase removes what
 * the brush covers, Select picks by click, box or lasso (Alt drag) and
 * moves, turns or scales the selection with the gizmo (W, E, R pick which):
 * arrows move along one axis (map or the object's own with local space, L
 * toggles), the blue arrow lifts and lowers, the square and the ground
 * inside the ring move freely; Ctrl snaps turns to 15 degrees, heights to
 * half metres and scales to tenths. Delete removes the selection, Ctrl+D
 * duplicates it, End drops it onto the ground. Rocks settle onto their
 * plate wherever they are set down (placed, scattered, dropped).
 */
import type { MapObject, MapPoint } from '../../world/custom-map/map-document';
import { ObjectsCommand, type ObjectEdit } from '../model/editor-document';
import { insideMap } from '../model/grid';
import {
  ObjectGrid,
  ObjectIds,
  centroid,
  duplicateObjects,
  objectsUnderBrush,
  scatterDab,
  setDown,
  rockShape,
  objectsAlong,
  wallAlong,
  wallKitOf,
  freeGroup,
  snapTo,
  withGroups,
  levelForBuildings,
  withGround,
} from '../ops/object-ops';
import { objectImages, sameSector, symmetryImages } from '../ops/symmetry';
import { edgePolyline, nearestOnEdges } from '../ops/path-graph';
import { TransformGizmo, gizmoAnchor, type GizmoHandle } from '../view/transform-gizmo';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

type Drag =
  | { kind: 'box'; x0: number; y0: number }
  | { kind: 'lasso'; points: { x: number; y: number }[] }
  | {
      kind: 'gizmo';
      start: MapPoint;
      center: MapPoint;
      before: Map<string, MapObject>;
      /** The handle taken, null for a drag inside the ring */
      handle: GizmoHandle | null;
      startY: number;
      /** Turn of the arrows (local space) and metres per pixel at the start */
      yaw: number;
      mpp: number;
    };

/** Pixels the gizmo arrows reach on screen */
const GIZMO_PIXELS = 90;

export class ObjectTool implements EditorTool {
  /** Where the pointer was when the hover ring was last picked */
  private hoverAt: { x: number; y: number } | null = null;
  readonly id = 'objects' as const;
  private brushing: {
    added: MapObject[];
    removed: ObjectEdit[];
    grid: ObjectGrid;
    ids: ObjectIds;
    erase: boolean;
    origin?: MapPoint;
    /** Where each object stood in the list when the stroke began: a removal's undo puts it back there */
    startIndex: Map<string, number>;
  } | null = null;
  private drag: Drag | null = null;
  /** The line being drawn in Line mode (free), map points */
  private line: MapPoint[] | null = null;

  brushVisible(ctx: ToolContext): boolean {
    const mode = ctx.settings.objects.mode;
    return mode === 'scatter' || mode === 'erase';
  }


  deactivate(ctx: ToolContext): void {
    ctx.overlay.setHover(null);
    this.hoverAt = null;
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
          startIndex: erase ? new Map(doc.objects.map((o, k) => [o.id, k])) : new Map(),
        };
        return true;
      }
      case 'select':
        return this.selectDown(p, ctx);
      case 'line':
        return this.lineDown(p, ctx);
    }
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    const line = this.line;
    if (line && p.hit) {
      const last = line[line.length - 1];
      if (Math.hypot(p.hit.x - last.x, p.hit.y - last.y) >= 2) line.push({ x: p.hit.x, y: p.hit.y });
      ctx.overlay.setDraft(line);
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'box') {
      ctx.setBox({ x0: drag.x0, y0: drag.y0, x1: p.clientX, y1: p.clientY });
      return;
    }
    if (drag.kind === 'lasso') {
      const last = drag.points[drag.points.length - 1];
      if (!last || Math.hypot(p.clientX - last.x, p.clientY - last.y) >= 4) {
        drag.points.push({ x: p.clientX, y: p.clientY });
        ctx.setLasso(drag.points);
      }
      return;
    }
    // Lifting needs no ground under the pointer
    if (!p.hit && drag.handle !== 'z') return;
    this.applyGizmo(drag, p, ctx);
  }

  pointerUp(p: ToolPointer, ctx: ToolContext): void {
    if (this.line) {
      const line = this.line;
      this.line = null;
      ctx.overlay.setDraft(null);
      if (p.hit && lineLength([line[line.length - 1], p.hit]) >= 1) line.push({ x: p.hit.x, y: p.hit.y });
      if (lineLength(line) >= 2) this.placeAlong(line, ctx);
      return;
    }
    this.endBrush(ctx);
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.kind === 'box' || drag.kind === 'lasso') {
      ctx.setBox(null);
      ctx.setLasso(null);
      let inside: (q: { x: number; y: number }) => boolean;
      if (drag.kind === 'box') {
        const x0 = Math.min(drag.x0, p.clientX);
        const x1 = Math.max(drag.x0, p.clientX);
        const y0 = Math.min(drag.y0, p.clientY);
        const y1 = Math.max(drag.y0, p.clientY);
        if (x1 - x0 < 4 && y1 - y0 < 4) {
          if (!p.shift) ctx.editor.select(null);
          return;
        }
        inside = (q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
      } else {
        if (drag.points.length < 3) return;
        const poly = drag.points;
        inside = (q) => insidePolygon(q, poly);
      }
      // What the eye sees inside the outline: each object's foot on the screen
      const doc = ctx.editor.doc;
      const ids = withGroups(
        doc.objects,
        doc.objects
          .filter((o) => {
            if (!ctx.objectVisible(o)) return false;
            const q = ctx.toScreen(o.x, o.y, ctx.heightAt(o.x, o.y) + o.z);
            return !!q && inside(q);
          })
          .map((o) => o.id),
      );
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
    const gizmo = ctx.overlay.transform;
    if (s.mode === 'select' && sel.length) {
      const c = centroid(ctx.editor.doc, sel)!;
      ctx.overlay.setGizmo(c, this.gizmoRadius(ctx, sel));
      const z = this.selectionHeight(ctx, sel, c);
      gizmo.setKind(s.gizmo);
      gizmo.place(gizmoAnchor(c.x, c.y, z), this.axisYaw(ctx, sel), (ctx.metresPerPixel(c) * GIZMO_PIXELS) / 10);
      if (!this.drag && p) gizmo.highlight(ctx.pickGizmo(p));
    } else {
      ctx.overlay.setGizmo(null, 0);
      gizmo.hide();
    }
    this.hoverFrame(p, ctx);

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
        // Indices of the list before the stroke: frames remove from a list already shorter
        else b.removed.push({ before: { ...o }, after: null, index: b.startIndex.get(o.id) ?? k });
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
    const rockOf = (asset: string) => rockShape(ctx.catalog.object(asset));
    const floats = (asset: string) => !!ctx.catalog.object(asset).float;
    const own = scatterDab(t, p.hit, brush, { ...s.scatter, assets: this.scatterAssets(ctx) }, b.grid, b.ids, Math.random, Math.min(dt, 0.1) * 6, rockOf, floats)
      .filter((o) => sameSector(mode, o, origin));
    // Each image tilts with its own ground, and a rock settles from the ground up on its own
    const images = objectImages(own, symmetryImages(mode, t.grid.columns === t.grid.rows), () => b.ids.take(), t.width / 2, t.depth / 2).map((o) => {
      const rock = s.scatter.sinkOnSlope ? rockOf(o.asset) : undefined;
      return setDown(t, rock ? { ...o, z: 0 } : o, rock, s.scatter.alignToSlope && !floats(o.asset));
    });
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
    if (!e.ctrlKey && !e.metaKey && k === 'l' && s.mode === 'select') {
      s.space = s.space === 'local' ? 'global' : 'local';
      ctx.settingsChanged();
      ctx.status(s.space === 'local' ? 'Arrows follow the object' : 'Arrows follow the map');
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'g' && sel.length) {
      const doc = ctx.editor.doc;
      if (e.shiftKey) {
        ctx.editor.execute(ObjectsCommand.change('Ungroup', doc, sel, (o) => {
          const next = { ...o };
          delete next.group;
          return next;
        }));
        ctx.status(`${sel.length} objects ungrouped`);
      } else if (sel.length > 1) {
        const group = freeGroup(doc.objects);
        ctx.editor.execute(ObjectsCommand.change('Group', doc, sel, (o) => ({ ...o, group })));
        ctx.status(`Group ${group}: ${sel.length} objects, picked and moved together (Ctrl+Shift+G ungroups)`);
      }
      return true;
    }
    if (e.key === 'End' && sel.length) {
      // A rock settles onto its plate: on a slope its middle sinks below the ground
      const t = ctx.editor.doc.terrain;
      ctx.editor.execute(ObjectsCommand.change('Drop to the ground', ctx.editor.doc, sel, (o) => setDown(t, { ...o, z: 0 }, rockShape(ctx.catalog.object(o.asset)), false)));
      return true;
    }
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
      // Like box and lasso: what the view hides stays out, so Delete cannot take it unseen
      const all = ctx.editor.doc.objects;
      const ids = all.filter((o) => ctx.objectVisible(o)).map((o) => o.id);
      ctx.editor.select(ids.length ? { kind: 'objects', ids } : null);
      const hidden = all.length - ids.length;
      ctx.status(hidden ? `${ids.length} objects selected, ${hidden} hidden ones left out` : `${ids.length} objects selected`);
      return true;
    }
    return false;
  }

  /** In Select, a faint ring shows the object a click would take; picked only when the pointer moved */
  private hoverFrame(p: ToolPointer | null, ctx: ToolContext): void {
    if (ctx.settings.objects.mode !== 'select' || this.drag || !p?.hit) {
      if (this.hoverAt) ctx.overlay.setHover(null);
      this.hoverAt = null;
      return;
    }
    if (this.hoverAt && this.hoverAt.x === p.clientX && this.hoverAt.y === p.clientY) return;
    this.hoverAt = { x: p.clientX, y: p.clientY };
    const picked = ctx.pick(p);
    const o = picked?.kind === 'object' ? ctx.editor.doc.objects.find((x) => x.id === picked.id) : undefined;
    if (!o) ctx.overlay.setHover(null);
    else ctx.overlay.setHover(o, ctx.catalog.object(o.asset).radius * o.scale * 1.15);
  }

  cancel(ctx: ToolContext): boolean {
    const busy = !!this.line || !!this.drag;
    if (this.line) {
      this.line = null;
      ctx.overlay.setDraft(null);
    }
    if (this.drag?.kind === 'gizmo') {
      // Put the objects back where the drag found them
      const before = this.drag.before;
      const doc = ctx.editor.doc;
      doc.objects = doc.objects.map((o) => (before.has(o.id) ? { ...before.get(o.id)! } : o));
      ctx.editor.emit({ objects: [...before.keys()] });
    }
    this.drag = null;
    ctx.setBox(null);
    ctx.setLasso(null);
    ctx.overlay.setGizmo(null, 0);
    ctx.overlay.transform.hide();
    return busy;
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
      case 'line': {
        const kit = wallKitOf(s.asset);
        if (kit) return s.line.follow === 'roads' ? `Click a road or river: a ${kit.name.toLowerCase()} along it` : `Drag a line: a ${kit.name.toLowerCase()} along it, end on its start for a ring`;
        return s.line.follow === 'roads'
          ? 'Click a road or river: objects along it, every few metres'
          : 'Drag a line: objects along it, every few metres';
      }
      case 'select':
        return 'Click, drag a box or Alt drag a lasso | arrows move along an axis, blue lifts (W E R, L local) | Del delete | Ctrl+D duplicate | End to the ground';
    }
  }

  /** Line mode: a road or river under the pointer at once, or the start of a free line */
  private lineDown(p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.objects;
    if (!p.hit) return true;
    if (!s.asset) {
      ctx.status('Choose an asset first');
      return true;
    }
    if (s.line.follow === 'free') {
      this.line = [{ x: p.hit.x, y: p.hit.y }];
      return true;
    }
    const doc = ctx.editor.doc;
    const road = nearestOnEdges(doc.paths, p.hit, 12);
    const river = nearestRiver(doc, p.hit);
    const line = road && (!river || road.dist <= river.dist) ? edgePolyline(doc.paths, road.edge) : river?.points ?? null;
    if (!line) {
      ctx.status('No road or river here: click on one, or draw freely');
      return true;
    }
    this.placeAlong(line, ctx);
    return true;
  }

  /** Objects along a line as one step, with their symmetric images */
  private placeAlong(line: readonly MapPoint[], ctx: ToolContext): void {
    const s = ctx.settings.objects;
    const doc = ctx.editor.doc;
    const t = doc.terrain;
    const ids = new ObjectIds(doc.objects);
    // A wall kit's piece: the kit's wall fitted along the line, else the asset every few metres
    const kit = wallKitOf(s.asset);
    const own = (
      kit
        ? wallAlong(line, kit, { corners: s.line.corners ?? 'blocks', front: s.line.front ?? 'left' }, ids)
        : objectsAlong(line, s.asset!, s.line, ids, Math.random)
    ).filter((o) => insideMap(t, o));
    if (!own.length) {
      if (kit) ctx.status('The line is too short for a wall');
      return;
    }
    const images = objectImages(own, symmetryImages(ctx.settings.symmetry, t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2);
    const entry = ctx.catalog.object(s.asset!);
    const label = kit ? `${kit.name} along a line` : `${ctx.catalog.object(s.asset!).name} along a line`;
    const ground = levelForBuildings(doc, label, [...own, ...images], entry);
    const placed = [...own, ...images].map((o) => setDown(t, o, rockShape(entry), s.alignToSlope && !entry.float, entry.radius));
    ctx.editor.execute(withGround(label, ground, ObjectsCommand.add(label, doc, placed)));
    ctx.status(`${placed.length} objects placed along ${Math.round(lineLength(line))} m`);
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
    // Each copy tilts with its own ground: a mirror image does not lean as the original does
    const entry = ctx.catalog.object(s.asset);
    const label = `Place ${entry.name}`;
    // A building levels its ground first, in the same step
    const ground = levelForBuildings(doc, label, [object, ...images], entry);
    const placed = [object, ...images].map((o) => setDown(t, o, rockShape(entry), s.alignToSlope && !entry.float, entry.radius));
    ctx.editor.execute(withGround(label, ground, ObjectsCommand.add(label, doc, placed)));
  }

  private selectDown(p: ToolPointer, ctx: ToolContext): boolean {
    const sel = this.selected(ctx);
    // A gizmo handle first: it draws over everything
    const handle = sel.length ? ctx.pickGizmo(p) : null;
    if (handle) {
      this.startGizmo(p, ctx, sel, handle);
      return true;
    }
    if (p.alt) {
      this.drag = { kind: 'lasso', points: [{ x: p.clientX, y: p.clientY }] };
      return true;
    }
    const picked = ctx.pick(p);
    if (picked?.kind === 'object') {
      if (p.shift) {
        const next = sel.includes(picked.id) ? sel.filter((id) => id !== picked.id) : [...sel, picked.id];
        ctx.editor.select(next.length ? { kind: 'objects', ids: next } : null);
        return true;
      }
      // A click takes the whole group; Ctrl click one member alone
      const ids = sel.includes(picked.id) ? sel : p.ctrl ? [picked.id] : withGroups(ctx.editor.doc.objects, [picked.id]);
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

  private startGizmo(p: ToolPointer, ctx: ToolContext, ids: string[], handle: GizmoHandle | null = null): void {
    const doc = ctx.editor.doc;
    const set = new Set(ids);
    const before = new Map(doc.objects.filter((o) => set.has(o.id)).map((o) => [o.id, { ...o }]));
    const center = centroid(doc, ids)!;
    this.drag = {
      kind: 'gizmo',
      start: p.hit ? { x: p.hit.x, y: p.hit.y } : { ...center },
      center,
      before,
      handle,
      startY: p.clientY,
      yaw: this.axisYaw(ctx, ids),
      mpp: ctx.metresPerPixel(center),
    };
  }

  private applyGizmo(drag: Extract<Drag, { kind: 'gizmo' }>, p: ToolPointer, ctx: ToolContext): void {
    const s = ctx.settings.objects;
    const doc = ctx.editor.doc;
    const hit = p.hit ?? { x: drag.start.x, y: drag.start.y, z: 0 };
    const c = drag.center;
    let dx = hit.x - drag.start.x;
    let dy = hit.y - drag.start.y;
    const a0 = Math.atan2(drag.start.y - c.y, drag.start.x - c.x);
    let turn = Math.atan2(hit.y - c.y, hit.x - c.x) - a0;
    if (p.ctrl) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12);
    const d0 = Math.max(0.5, Math.hypot(drag.start.x - c.x, drag.start.y - c.y));
    const factor = Math.max(0.05, Math.hypot(hit.x - c.x, hit.y - c.y) / d0);
    let factorSnapped = factor;
    if (p.ctrl) factorSnapped = Math.max(0.1, Math.round(factor * 10) / 10);
    // An arrow: only along its axis
    if (s.gizmo === 'move' && (drag.handle === 'x' || drag.handle === 'y')) {
      const axis = TransformGizmo.axis(drag.handle, drag.yaw);
      const along = dx * axis.x + dy * axis.y;
      const d = s.snap > 0 ? snapTo(along, s.snap) : along;
      dx = axis.x * d;
      dy = axis.y * d;
    } else if (s.snap > 0) {
      dx = snapTo(dx, s.snap);
      dy = snapTo(dy, s.snap);
    }
    // The blue arrow: up and down with the pointer's height on the screen
    let dz = 0;
    if (drag.handle === 'z') {
      dx = 0;
      dy = 0;
      dz = (drag.startY - p.clientY) * drag.mpp;
      if (p.ctrl) dz = Math.round(dz * 2) / 2;
    }
    const changed: string[] = [];
    doc.objects = doc.objects.map((o) => {
      const b = drag.before.get(o.id);
      if (!b) return o;
      changed.push(o.id);
      switch (s.gizmo) {
        case 'move':
          return { ...b, x: round(b.x + dx), y: round(b.y + dy), z: round(b.z + dz) };
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
            scale: round(Math.min(20, Math.max(0.05, b.scale * factorSnapped)), 1000),
            x: round(c.x + (b.x - c.x) * (drag.before.size > 1 ? factorSnapped : 1)),
            y: round(c.y + (b.y - c.y) * (drag.before.size > 1 ? factorSnapped : 1)),
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

  /** The arrows' turn: the first selected object's in local space, else the map's */
  private axisYaw(ctx: ToolContext, ids: string[]): number {
    if (ctx.settings.objects.space !== 'local' || !ids.length) return 0;
    const first = ctx.editor.doc.objects.find((o) => o.id === ids[0]);
    return first?.rotation ?? 0;
  }

  /** Where the gizmo stands: on the ground at the centre, raised by the objects' mean lift */
  private selectionHeight(ctx: ToolContext, ids: string[], c: MapPoint): number {
    const set = new Set(ids);
    let lift = 0;
    let n = 0;
    for (const o of ctx.editor.doc.objects) {
      if (!set.has(o.id)) continue;
      lift += o.z;
      n++;
    }
    return ctx.heightAt(c.x, c.y) + (n ? lift / n : 0);
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

/** Whether a screen point lies inside a polygon (even-odd rule) */
export function insidePolygon(q: { x: number; y: number }, poly: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function round(v: number, f = 100): number {
  return Math.round(v * f) / f;
}

function wrap(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}

function lineLength(line: readonly MapPoint[]): number {
  let n = 0;
  for (let k = 1; k < line.length; k++) n += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  return n;
}

/** The river whose band the point is in or near (within 8 m of its banks), with its points */
function nearestRiver(doc: { terrain: { rivers?: { points: { x: number; y: number; width: number }[] }[] } }, p: MapPoint): { points: MapPoint[]; dist: number } | null {
  let best: { points: MapPoint[]; dist: number } | null = null;
  for (const r of doc.terrain.rivers ?? []) {
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k];
      const b = r.points[k + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      const d = Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y) - (a.width + (b.width - a.width) * u) / 2;
      if (d <= 8 && (!best || d < best.dist)) best = { points: r.points.map((q) => ({ x: q.x, y: q.y })), dist: Math.max(0, d) };
    }
  }
  return best;
}

