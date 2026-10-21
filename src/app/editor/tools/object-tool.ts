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
 * plate wherever they are set down (placed, scattered, dropped). Place
 * shows the object's ground under the pointer with its front, turns it with
 * Q E, comma and period or Shift+wheel (in steps, Shift+Q E a quarter) and
 * turns a building with a road near to face the road.
 */
import type { MapObject, MapPoint } from '../../world/custom-map/map-document';
import { objectRadius, type ObjectAssetEntry } from '../../map-ops/asset-catalog';
import { ObjectsCommand, type ObjectEdit } from '../model/commands/objects';
import { insideMap } from '../../map-ops/grid';
import {
  ObjectSpotGrid,
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
  roadFacing,
  withGroups,
} from '../../map-ops/object-ops';
import { levelForBuildings, withGround } from '../ops/object-commands';
import { catalogName } from '../ops/describe';
import { objectImages, sameSector, symmetryImages } from '../ops/symmetry';
import { edgePolyline, nearestOnEdges } from '../../map-ops/path-graph';
import { TransformGizmo, gizmoAnchor, type GizmoHandle } from '../view/transform-gizmo';
import { patch, type EditorTool, type ToolContext, type ToolPointer } from './tool';
import type { EditorDocument } from '../model/editor-document';

type Drag =
  | { kind: 'box'; x0: number; y0: number }
  | { kind: 'lasso'; points: { x: number; y: number }[] }
  | {
      kind: 'gizmo';
      start: MapPoint;
      center: MapPoint;
      before: Map<string, MapObject>;
      /** Where each of them stands in the list: a frame of the drag changes only those */
      at: Map<string, number>;
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
  readonly fixedKeys = [
    { key: 'w', what: 'moveSelection' },
    { key: 'e', what: 'turnSelection' },
    { key: 'r', what: 'scaleSelection' },
    { key: 'l', what: 'arrowsAlong' },
    { key: 'q', what: 'turnNext' },
  ] as const;
  private brushing: {
    added: MapObject[];
    removed: ObjectEdit[];
    /** The spacing grid over the map's objects (scatter only) */
    grid: ObjectSpotGrid | null;
    erase: boolean;
    origin?: MapPoint;
    /** Where each object stood in the list when the stroke began: a removal's undo puts it back there */
    startIndex: Map<string, number>;
  } | null = null;
  private drag: Drag | null = null;
  /**
   * The scatter brush's spacing grid over the map's objects, kept while the
   * tool is on: objects the change notices name since are brought up to date
   * at the next stroke (null: the list changed whole, grid it anew)
   */
  private spots: { editor: EditorDocument; grid: ObjectSpotGrid; cell: number; changed: Set<string> | null; stop: () => void } | null = null;
  /** The selection's centre, ring and height as last worked out (selectionShape) */
  private shape: { ids: readonly string[]; revision: number; center: MapPoint; radius: number; height: number } | null = null;
  /** The line being drawn in Line mode (free), map points */
  private line: MapPoint[] | null = null;
  /** Place: where the outline last stood and the road's turn there, null without one (asked again only when it moves) */
  private placeAt: { x: number; y: number; asset: string; road: number | null } | null = null;

  brushVisible(ctx: ToolContext): boolean {
    const mode = ctx.settings.objects().mode;
    return mode === 'scatter' || mode === 'erase';
  }


  deactivate(ctx: ToolContext): void {
    this.spots?.stop();
    this.spots = null;
    this.hoverAt = null;
    this.endBrush(ctx);
    this.cancel(ctx);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0) return false;
    const s = ctx.settings.objects();
    switch (s.mode) {
      case 'place':
        if (p.hit) this.place(p, ctx);
        return true;
      case 'scatter':
      case 'erase': {
        if (!p.hit) return true;
        const erase = s.mode === 'erase' || p.shift;
        if (s.mode === 'scatter' && !erase && !this.scatterAssets(ctx).length) {
          ctx.status(ctx.t().editor.objectTool.chooseScatter);
          return true;
        }
        const doc = ctx.editor.doc;
        this.brushing = {
          added: [],
          removed: [],
          grid: erase ? null : this.spotGrid(ctx, Math.max(2, s.scatter.minDistance)),
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
      ctx.overlay.draft.set(line);
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
      ctx.overlay.draft.clear();
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
      ctx.status(ctx.t().editor.objectTool.selected(ids.length));
      return;
    }
    const command = ObjectsCommand.fromStates(gizmoLabel(ctx), ctx.editor.doc, drag.before);
    if (!command.empty) ctx.editor.push(command);
  }

  frame(dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.objects();
    const sel = this.selected(ctx);
    const gizmo = ctx.overlay.gizmo.handles;
    const shape = s.mode === 'select' && sel.length ? this.selectionShape(ctx, sel) : null;
    if (shape) {
      const c = shape.center;
      ctx.overlay.gizmo.ring.set(c, shape.radius);
      gizmo.setKind(s.gizmo);
      gizmo.place(gizmoAnchor(c.x, c.y, shape.height), this.axisYaw(ctx, sel), (ctx.metresPerPixel(c) * GIZMO_PIXELS) / 10);
      if (!this.drag && p) gizmo.highlight(ctx.pickGizmo(p));
    } else {
      ctx.overlay.gizmo.ring.clear();
      gizmo.hide();
    }
    this.hoverFrame(p, ctx);
    this.placeFrame(p, ctx);

    const b = this.brushing;
    if (!b || !p?.hit) return;
    const doc = ctx.editor.doc;
    const brush = ctx.settings.brush();
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
    const mode = ctx.settings.symmetry();
    b.origin ??= { x: p.hit.x, y: p.hit.y };
    const origin = b.origin;
    // With symmetry the scatter grows in the stroke's own sector and is copied to the others
    const rockOf = (asset: string) => rockShape(ctx.catalog.object(asset));
    const floats = (asset: string) => !!ctx.catalog.object(asset).float;
    // Trees take their size from the age of their stand (map-ops tree-stands.ts)
    const stands = (asset: string) => ctx.catalog.object(asset).category === 'tree';
    const grid = b.grid!;
    const ids = ctx.editor.objectIds;
    const own = scatterDab(t, p.hit, brush, { ...s.scatter, assets: this.scatterAssets(ctx) }, grid, ids, Math.random, Math.min(dt, 0.1) * 6, rockOf, floats, stands)
      .filter((o) => sameSector(mode, o, origin));
    // Each image tilts with its own ground, and a rock settles from the ground up on its own
    const images = objectImages(own, symmetryImages(mode, t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2).map((o) => {
      const rock = s.scatter.sinkOnSlope ? rockOf(o.asset) : undefined;
      return setDown(t, rock ? { ...o, z: 0 } : o, rock, s.scatter.alignToSlope && !floats(o.asset));
    });
    for (const o of images) grid.add(o);
    const placed = [...own, ...images];
    if (!placed.length) return;
    doc.objects.push(...placed);
    b.added.push(...placed);
    ctx.editor.emit({ objects: placed.map((o) => o.id) });
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    const s = ctx.settings.objects();
    const sel = this.selected(ctx);
    const k = e.key.toLowerCase();
    // Place turns the next object: Q and comma to the left, E and period to the right, Shift a quarter
    if (s.mode === 'place' && !e.ctrlKey && !e.metaKey && !e.altKey && (k === 'q' || k === 'e' || e.key === ',' || e.key === '.')) {
      this.turnPlace(k === 'q' || e.key === ',' ? 1 : -1, e.shiftKey ? 90 : s.turnStep, ctx);
      return true;
    }
    if (!e.ctrlKey && !e.metaKey && k === 'l' && s.mode === 'select') {
      const space = s.space === 'local' ? 'global' : 'local';
      patch(ctx.settings.objects, { space });
      ctx.status(space === 'local' ? ctx.t().editor.objectTool.arrowsObject : ctx.t().editor.objectTool.arrowsMap);
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'g' && sel.length) {
      const doc = ctx.editor.doc;
      if (e.shiftKey) {
        ctx.editor.execute(ObjectsCommand.change(ctx.t().editor.objectTool.ungroup, doc, sel, (o) => {
          const next = { ...o };
          delete next.group;
          return next;
        }));
        ctx.status(ctx.t().editor.objectTool.ungrouped(sel.length));
      } else if (sel.length > 1) {
        const group = freeGroup(doc.objects);
        ctx.editor.execute(ObjectsCommand.change(ctx.t().editor.objectTool.group, doc, sel, (o) => ({ ...o, group })));
        ctx.status(ctx.t().editor.objectTool.grouped(group, sel.length));
      }
      return true;
    }
    if (e.key === 'End' && sel.length) {
      // A rock settles onto its plate: on a slope its middle sinks below the ground
      const t = ctx.editor.doc.terrain;
      ctx.editor.execute(ObjectsCommand.change(ctx.t().editor.objects.undo.drop, ctx.editor.doc, sel, (o) => setDown(t, { ...o, z: 0 }, rockShape(ctx.catalog.object(o.asset)), false)));
      return true;
    }
    if (!e.ctrlKey && !e.metaKey && (k === 'w' || k === 'e' || k === 'r')) {
      patch(ctx.settings.objects, { mode: 'select', gizmo: k === 'w' ? 'move' : k === 'e' ? 'rotate' : 'scale' });
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
      ctx.editor.execute(ObjectsCommand.remove(sel.length === 1 ? ctx.t().editor.objects.undo.deleteOne : ctx.t().editor.objects.undo.deleteMany(sel.length), ctx.editor.doc, sel));
      ctx.editor.select(null);
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'd' && sel.length) {
      const step = Math.max(2, s.snap || 4);
      const copies = duplicateObjects(ctx.editor.doc, sel, { x: step, y: -step }, ctx.editor.objectIds);
      ctx.editor.execute(ObjectsCommand.add(ctx.t().editor.objects.undo.duplicate, ctx.editor.doc, copies));
      ctx.editor.select({ kind: 'objects', ids: copies.map((o) => o.id) });
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'a' && s.mode === 'select') {
      // Like box and lasso: what the view hides stays out, so Delete cannot take it unseen
      const all = ctx.editor.doc.objects;
      const ids = all.filter((o) => ctx.objectVisible(o)).map((o) => o.id);
      ctx.editor.select(ids.length ? { kind: 'objects', ids } : null);
      const hidden = all.length - ids.length;
      ctx.status(hidden ? ctx.t().editor.objectTool.selectedHidden(ids.length, hidden) : ctx.t().editor.objectTool.selected(ids.length));
      return true;
    }
    return false;
  }

  /** Place: Shift and the wheel turn the next object by a step, away from the user to the left */
  wheel(step: number, p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.objects();
    if (s.mode !== 'place' || !p.shift || p.ctrl || p.alt) return false;
    this.turnPlace(step < 0 ? 1 : -1, s.turnStep, ctx);
    return true;
  }

  /** Turns the next placed object by `degrees` onto the grid of the turn step, `dir` 1 to the left (counter-clockwise from above) */
  private turnPlace(dir: 1 | -1, degrees: number, ctx: ToolContext): void {
    const s = ctx.settings.objects();
    const deg = (s.rotation * 180) / Math.PI;
    const next = Math.round((deg + dir * degrees) / s.turnStep) * s.turnStep;
    patch(ctx.settings.objects, { rotation: round(wrap((next * Math.PI) / 180), 1000) });
    if (s.randomRotation) {
      patch(ctx.settings.objects, { randomRotation: false });
      ctx.status(ctx.t().editor.objectTool.randomOff);
    }
  }

  /** The road's turn for a building at a point when Face the road is on and one is near, else null */
  private roadTurn(at: MapPoint, entry: ObjectAssetEntry, ctx: ToolContext): number | null {
    return ctx.settings.objects().faceRoad && entry.footing?.category === 'building' ? roadFacing(ctx.editor.doc.paths, at, entry.radius) : null;
  }

  /** Place: the object's ground and front under the pointer, turned as a click would set it */
  private placeFrame(p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.objects();
    if (s.mode !== 'place' || !s.asset || !p?.hit) {
      if (this.placeAt) ctx.overlay.draft.clear();
      this.placeAt = null;
      return;
    }
    const entry = ctx.catalog.object(s.asset);
    const x = snapTo(p.hit.x, s.snap);
    const y = snapTo(p.hit.y, s.snap);
    const last = this.placeAt;
    // Asked again only when the outline moves or the asset changes: an OSM world has thousands of roads
    const road = last && last.asset === s.asset && Math.hypot(last.x - x, last.y - y) < 0.25 ? last.road : this.roadTurn({ x, y }, entry, ctx);
    this.placeAt = { x, y, asset: s.asset, road };
    // The status line says whether a road turns it
    if ((road === null) !== ((last?.road ?? null) === null)) ctx.hintChanged();
    // A random turn is rolled on the click: the outline shows north until then
    const rotation = road ?? (s.randomRotation ? 0 : s.rotation);
    ctx.overlay.draft.set(placeOutline(entry, { x, y, rotation, scale: 1 }));
  }

  /** In Select, a faint ring shows the object a click would take; picked only when the pointer moved */
  private hoverFrame(p: ToolPointer | null, ctx: ToolContext): void {
    if (ctx.settings.objects().mode !== 'select' || this.drag || !p?.hit) {
      if (this.hoverAt) ctx.overlay.hover.clear();
      this.hoverAt = null;
      return;
    }
    if (this.hoverAt && this.hoverAt.x === p.clientX && this.hoverAt.y === p.clientY) return;
    this.hoverAt = { x: p.clientX, y: p.clientY };
    const picked = ctx.pick(p);
    const o = picked?.kind === 'object' ? ctx.editor.doc.objects.find((x) => x.id === picked.id) : undefined;
    if (!o) ctx.overlay.hover.clear();
    else ctx.overlay.hover.set(o, ctx.catalog.object(o.asset).radius * o.scale * 1.15);
  }

  cancel(ctx: ToolContext): boolean {
    const busy = !!this.line || !!this.drag;
    if (this.placeAt) ctx.overlay.draft.clear();
    this.placeAt = null;
    if (this.line) {
      this.line = null;
      ctx.overlay.draft.clear();
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
    ctx.overlay.gizmo.clear();
    return busy;
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.objects();
    const says = ctx.t().editor.objectTool;
    switch (s.mode) {
      case 'place': {
        if (!s.asset) return says.hintChoose;
        const turn = this.placeAt?.road != null ? says.facingRoad : s.randomRotation ? says.turnedRandom : says.turned(Math.round((s.rotation * 180) / Math.PI) % 360);
        return says.hintPlace(catalogName(ctx.t(), ctx.catalog.object(s.asset)), turn, s.turnStep);
      }
      case 'scatter':
        return says.hintScatter;
      case 'erase':
        return says.hintErase;
      case 'line': {
        const kit = wallKitOf(s.asset);
        if (kit) return s.line.follow === 'roads' ? says.hintKitRoads(ctx.t().editor.wallKits[kit.id]) : says.hintKitLine(ctx.t().editor.wallKits[kit.id]);
        return s.line.follow === 'roads' ? says.hintLineRoads : says.hintLine;
      }
      case 'select':
        return says.hintSelect;
    }
  }

  /** Line mode: a road or river under the pointer at once, or the start of a free line */
  private lineDown(p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.objects();
    if (!p.hit) return true;
    if (!s.asset) {
      ctx.status(ctx.t().editor.objectTool.chooseAsset);
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
      ctx.status(ctx.t().editor.objectTool.noRoad);
      return true;
    }
    this.placeAlong(line, ctx);
    return true;
  }

  /** Objects along a line as one step, with their symmetric images */
  private placeAlong(line: readonly MapPoint[], ctx: ToolContext): void {
    const s = ctx.settings.objects();
    const doc = ctx.editor.doc;
    const t = doc.terrain;
    const ids = ctx.editor.objectIds;
    // A wall kit's piece: the kit's wall fitted along the line, else the asset every few metres
    const kit = wallKitOf(s.asset);
    const own = (
      kit
        ? wallAlong(line, kit, { corners: s.line.corners ?? 'blocks', front: s.line.front ?? 'left' }, ids)
        : objectsAlong(line, s.asset!, s.line, ids, Math.random)
    ).filter((o) => insideMap(t, o));
    if (!own.length) {
      if (kit) ctx.status(ctx.t().editor.objectTool.tooShort);
      return;
    }
    const images = objectImages(own, symmetryImages(ctx.settings.symmetry(), t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2);
    const entry = ctx.catalog.object(s.asset!);
    const label = ctx.t().editor.objectTool.alongLine(kit ? ctx.t().editor.wallKits[kit.id] : catalogName(ctx.t(), ctx.catalog.object(s.asset!)));
    const ground = levelForBuildings(doc, label, [...own, ...images], entry);
    const placed = [...own, ...images].map((o) => setDown(t, o, rockShape(entry), s.alignToSlope && !entry.float, entry.radius));
    ctx.editor.execute(withGround(label, ground, ObjectsCommand.add(label, doc, placed)));
    ctx.status(ctx.t().editor.objectTool.placedAlong(placed.length, lineLength(line)));
  }

  private place(p: ToolPointer, ctx: ToolContext): void {
    const s = ctx.settings.objects();
    if (!s.asset) {
      ctx.status(ctx.t().editor.objectTool.chooseAsset);
      return;
    }
    const doc = ctx.editor.doc;
    const x = snapTo(p.hit!.x, s.snap);
    const y = snapTo(p.hit!.y, s.snap);
    if (!insideMap(doc.terrain, { x, y })) return;
    const entry = ctx.catalog.object(s.asset);
    const object: MapObject = {
      id: ctx.editor.objectIds.take(),
      asset: s.asset,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      z: 0,
      rotation: this.roadTurn({ x, y }, entry, ctx) ?? (s.randomRotation ? round(Math.random() * Math.PI * 2, 1000) : s.rotation),
      scale: 1,
    };
    const t = doc.terrain;
    const ids = ctx.editor.objectIds;
    // A building facing a road: each symmetric image faces its own nearest road (the mirrored turn would face the original's)
    const images = objectImages([object], symmetryImages(ctx.settings.symmetry(), t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2).map((o) => {
      const road = this.roadTurn(o, entry, ctx);
      return road === null ? o : { ...o, rotation: road };
    });
    // Each copy tilts with its own ground: a mirror image does not lean as the original does
    const label = ctx.t().editor.objectTool.place(catalogName(ctx.t(), entry));
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
    const shape = sel.length ? this.selectionShape(ctx, sel) : null;
    if (shape && p.hit && Math.hypot(p.hit.x - shape.center.x, p.hit.y - shape.center.y) <= shape.radius * 1.1) {
      this.startGizmo(p, ctx, sel);
      return true;
    }
    this.drag = { kind: 'box', x0: p.clientX, y0: p.clientY };
    return true;
  }

  private startGizmo(p: ToolPointer, ctx: ToolContext, ids: string[], handle: GizmoHandle | null = null): void {
    const doc = ctx.editor.doc;
    const set = new Set(ids);
    const before = new Map<string, MapObject>();
    const at = new Map<string, number>();
    doc.objects.forEach((o, k) => {
      if (!set.has(o.id)) return;
      before.set(o.id, { ...o });
      at.set(o.id, k);
    });
    const center = centroid(doc, ids)!;
    this.drag = {
      kind: 'gizmo',
      start: p.hit ? { x: p.hit.x, y: p.hit.y } : { ...center },
      center,
      before,
      at,
      handle,
      startY: p.clientY,
      yaw: this.axisYaw(ctx, ids),
      mpp: ctx.metresPerPixel(center),
    };
  }

  private applyGizmo(drag: Extract<Drag, { kind: 'gizmo' }>, p: ToolPointer, ctx: ToolContext): void {
    const s = ctx.settings.objects();
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
    const moved = (b: MapObject): MapObject => {
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
    };
    // Only the dragged objects, in their places: a copy of the whole list each frame cost a big map's frame
    for (const [id, b] of drag.before) {
      let k = drag.at.get(id)!;
      if (doc.objects[k]?.id !== id) drag.at.set(id, (k = doc.objects.findIndex((o) => o.id === id)));
      if (k < 0) continue;
      doc.objects[k] = moved(b);
      changed.push(id);
    }
    ctx.editor.emit({ objects: changed });
  }

  /**
   * The selection's centre, the gizmo ring's radius round it and the height
   * the gizmo stands at (the ground at the centre, raised by the objects' mean
   * lift), worked out once while map and selection stand still: three passes
   * over a big map's list each frame held thousands selected at 26 frames a second
   */
  private selectionShape(ctx: ToolContext, ids: readonly string[]): { center: MapPoint; radius: number; height: number } | null {
    const kept = this.shape;
    const revision = ctx.editor.revision;
    if (kept && kept.ids === ids && kept.revision === revision) return kept;
    const set = new Set(ids);
    const chosen: MapObject[] = [];
    for (const o of ctx.editor.doc.objects) if (set.has(o.id)) chosen.push(o);
    if (!chosen.length) return null;
    let x = 0;
    let y = 0;
    let lift = 0;
    for (const o of chosen) {
      x += o.x;
      y += o.y;
      lift += o.z;
    }
    const center = { x: x / chosen.length, y: y / chosen.length };
    let r = 2;
    for (const o of chosen) r = Math.max(r, Math.hypot(o.x - center.x, o.y - center.y) + objectRadius(o, ctx.catalog) * o.scale);
    this.shape = { ids, revision, center, radius: r * 1.15, height: ctx.heightAt(center.x, center.y) + lift / chosen.length };
    return this.shape;
  }

  /** The arrows' turn: the first selected object's in local space, else the map's */
  private axisYaw(ctx: ToolContext, ids: string[]): number {
    if (ctx.settings.objects().space !== 'local' || !ids.length) return 0;
    const first = ctx.editor.doc.objects.find((o) => o.id === ids[0]);
    return first?.rotation ?? 0;
  }

  private selected(ctx: ToolContext): string[] {
    const s = ctx.editor.selection;
    return s?.kind === 'objects' ? s.ids : [];
  }

  /**
   * The spacing grid for a scatter stroke with cells of `cell` metres: the
   * kept one with the objects changed since moved, dropped or added (one pass
   * over the list, nothing gridded anew), or a new one over the whole list
   */
  private spotGrid(ctx: ToolContext, cell: number): ObjectSpotGrid {
    const editor = ctx.editor;
    const doc = editor.doc;
    let kept = this.spots;
    if (kept && (kept.editor !== editor || kept.cell !== cell || !kept.changed || kept.changed.size > doc.objects.length / 4)) {
      kept.stop();
      kept = this.spots = null;
    }
    if (!kept) {
      const fresh: NonNullable<ObjectTool['spots']> = { editor, cell, grid: new ObjectSpotGrid(cell, doc.objects), changed: new Set(), stop: () => undefined };
      fresh.stop = editor.onChange((c) => {
        if (c.objects === 'all') fresh.changed = null;
        else if (c.objects && fresh.changed) for (const id of c.objects) fresh.changed.add(id);
      });
      this.spots = fresh;
      return fresh.grid;
    }
    const changed = kept.changed!;
    if (changed.size) {
      const seen = new Set<string>();
      for (const o of doc.objects) {
        if (!changed.has(o.id)) continue;
        kept.grid.add(o);
        seen.add(o.id);
      }
      for (const id of changed) if (!seen.has(id)) kept.grid.drop(id);
      changed.clear();
    }
    return kept.grid;
  }

  private scatterAssets(ctx: ToolContext): string[] {
    const s = ctx.settings.objects();
    if (s.scatter.assets.length) return [...s.scatter.assets];
    return s.asset ? [s.asset] : [];
  }

  private endBrush(ctx: ToolContext): void {
    const b = this.brushing;
    this.brushing = null;
    if (!b || (!b.added.length && !b.removed.length)) return;
    const doc = ctx.editor.doc;
    // Places of the new objects, looked up once instead of a search of the list for each
    const added = new Set(b.added.map((o) => o.id));
    const at = new Map<string, number>();
    doc.objects.forEach((o, k) => added.has(o.id) && at.set(o.id, k));
    const edits: ObjectEdit[] = [
      ...b.removed,
      ...b.added.map((o) => ({ before: null, after: { ...o }, index: at.get(o.id) ?? -1 })),
    ];
    const label = b.erase ? ctx.t().editor.objectTool.removeMany(b.removed.length) : ctx.t().editor.objectTool.scatterMany(b.added.length);
    ctx.editor.push(new ObjectsCommand(label, edits));
  }
}

function gizmoLabel(ctx: ToolContext): string {
  const undo = ctx.t().editor.objects.undo;
  return { move: undo.move, rotate: undo.turn, scale: undo.scale }[ctx.settings.objects().gizmo];
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

/**
 * The ground an object takes as one line over the map: its rectangle (a
 * catalogue `box`) or its footprint circle, with a spike out of the middle of
 * its front (local +z), so Place shows where the object faces
 */
export function placeOutline(entry: Pick<ObjectAssetEntry, 'radius' | 'box'>, o: Pick<MapObject, 'x' | 'y' | 'rotation' | 'scale'>): MapPoint[] {
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  const sc = o.scale || 1;
  // Model (x, z) to the map, as object-ground.ts turns it
  const put = (mx: number, mz: number): MapPoint => ({ x: o.x - (mx * cos + mz * sin) * sc, y: o.y + (-mx * sin + mz * cos) * sc });
  const b = entry.box;
  const out: MapPoint[] = [];
  let front: [number, number];
  if (b) {
    front = [b[0], b[1] + b[3]];
    out.push(put(...front), put(b[0] + b[2], b[1] + b[3]), put(b[0] + b[2], b[1] - b[3]), put(b[0] - b[2], b[1] - b[3]), put(b[0] - b[2], b[1] + b[3]), put(...front));
  } else {
    const r = entry.radius;
    front = [0, r];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      out.push(put(r * Math.sin(a), r * Math.cos(a)));
    }
  }
  const spike = Math.max(1.5, entry.radius * 0.4);
  out.push(put(front[0], front[1] + spike), put(...front));
  return out;
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

