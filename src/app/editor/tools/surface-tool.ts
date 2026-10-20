/**
 * Surfaces: a material laid over the ground on an outline, with the lines
 * of a pitch, a court, a track, a car park or a platform (MapSurface, TODO
 * E237). Draw puts down an outline: a click per corner, or hold and drag to
 * paint it freehand; Enter, a double click or a right click closes it, with
 * the panel's material and marking, the marking fitted to the outline. Edit
 * picks a surface by a click inside it (the smallest there), drags its
 * corners (the marking fits itself again) or the corners of its marking's
 * rectangle (the opposite corner stays), Shift+click on its edge adds a
 * corner there, Delete removes the chosen corner (an outline keeps three)
 * or, with none chosen, the surface. Every finished outline and drag is one
 * step in the history. With symmetry on, a new outline gets its images too
 * (in the same step).
 */
import type { MapPoint, MapSurface } from '../../world/custom-map/map-document';
import { insideSurface, MAX_SURFACE_POINTS, MAX_SURFACES, newSurfaceId, surfaceArea } from '../../world/custom-map/map-surfaces';
import { nearestOnShape, outlineArea } from '../../world/custom-map/map-life';
import { insideMap } from '../../map-ops/grid';
import { TD_THEME } from '../../styles/td-theme';
import { SnapshotCommand } from '../model/commands/snapshot';
import { markingCorners, newSurface, pullMarkingCorner, refitMarking, surfacesCommand } from '../ops/surfaces';
import { surfaceImages, symmetryImages } from '../ops/symmetry';
import type { OverlayShape } from '../view/overlay/tool-overlay';
import { patch, type EditorTool, type ToolContext, type ToolPointer } from './tool';

/** Screen pixels a handle or an edge takes a click from */
const PICK_PX = 12;
/** Metres between two points of a freehand outline */
const FREEHAND_STEP = 4;
/** Colours of the outlines and of the chosen surface's marking */
const OUTLINE = TD_THEME.tealLight;
const MARKING = TD_THEME.brassLight;

export class SurfaceTool implements EditorTool {
  readonly id = 'surfaces' as const;
  /** The outline being drawn */
  private draft: MapPoint[] = [];
  /** Held down in Draw: freehand once the pointer moved */
  private holding: { from: MapPoint; freehand: boolean } | null = null;
  /** A handle of the chosen surface being dragged, and the list before */
  private dragging: { before: MapSurface[] | undefined; moved: boolean } | null = null;
  private lastClick = 0;
  private lastClickAt = { x: -1e6, y: -1e6 };
  /** What the overlay shows now */
  private shown: { surfaces: unknown; chosen: string | null; point: number } | null = null;

  brushVisible(): boolean {
    return false;
  }

  activate(ctx: ToolContext): void {
    this.shown = null;
    this.redraw(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.cancel(ctx);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.surfaces();
    if (p.button === 2 && this.draft.length) {
      this.finish(ctx);
      return true;
    }
    if (p.button !== 0 || !p.hit) return false;
    const now = performance.now();
    const double = now - this.lastClick < 320 && Math.hypot(p.clientX - this.lastClickAt.x, p.clientY - this.lastClickAt.y) < 6;
    this.lastClick = now;
    this.lastClickAt = { x: p.clientX, y: p.clientY };
    if (s.mode === 'draw') {
      if (double && this.draft.length) {
        this.finish(ctx);
        return true;
      }
      this.holding = { from: { x: p.hit.x, y: p.hit.y }, freehand: false };
      if (this.draft.length < MAX_SURFACE_POINTS) this.draft.push(round({ x: p.hit.x, y: p.hit.y }));
      return true;
    }
    return this.editDown(p, ctx);
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!p.hit) return;
    const hold = this.holding;
    if (hold) {
      // Held and moved: the outline follows the pointer, a point every few metres
      const last = this.draft[this.draft.length - 1];
      if (!hold.freehand && Math.hypot(p.hit.x - hold.from.x, p.hit.y - hold.from.y) > FREEHAND_STEP) hold.freehand = true;
      if (hold.freehand && last && Math.hypot(p.hit.x - last.x, p.hit.y - last.y) >= FREEHAND_STEP && this.draft.length < MAX_SURFACE_POINTS) {
        this.draft.push(round({ x: p.hit.x, y: p.hit.y }));
      }
      return;
    }
    const d = this.dragging;
    const s = ctx.settings.surfaces();
    if (!d || !insideMap(ctx.editor.doc.terrain, p.hit)) return;
    const surface = this.chosen(ctx);
    if (!surface || s.point < 0) return;
    const at = round({ x: p.hit.x, y: p.hit.y });
    if (s.point < surface.outer.length) {
      surface.outer[s.point] = at;
    } else if (surface.marking && s.point < surface.outer.length + 4) {
      surface.marking = pullMarkingCorner(surface.marking, s.point - surface.outer.length, at);
    } else return;
    d.moved = true;
    this.shown = null;
    ctx.editor.emit({ surfaces: true });
  }

  pointerUp(_p: ToolPointer, ctx: ToolContext): void {
    const hold = this.holding;
    this.holding = null;
    // A freehand stroke ends with the button
    if (hold?.freehand) {
      this.finish(ctx);
      return;
    }
    const d = this.dragging;
    this.dragging = null;
    if (!d?.moved) return;
    const editor = ctx.editor;
    const surface = this.chosen(ctx);
    const point = ctx.settings.surfaces().point;
    // A corner of the outline moved: the marking fits itself again; a corner of the marking keeps where it was put
    if (surface && point < surface.outer.length) refitMarking(surface);
    editor.push(new SnapshotCommand(point < (surface?.outer.length ?? 0) ? ctx.t().editor.surfaces.moveCorner : ctx.t().editor.surfaces.pullMarking, { surfaces: d.before }, { surfaces: structuredClone(editor.doc.surfaces) }), { surfaces: true });
    this.shown = null;
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.surfaces();
    if (s.mode === 'draw' && this.draft.length) {
      const line = [...this.draft];
      if (p?.hit && !this.holding?.freehand) line.push({ x: p.hit.x, y: p.hit.y });
      if (line.length > 2) line.push(line[0]);
      ctx.overlay.draft.set(line);
    } else ctx.overlay.draft.clear();
    this.redraw(ctx);
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Enter' && this.draft.length) {
      this.finish(ctx);
      return true;
    }
    const s = ctx.settings.surfaces();
    if ((e.key === 'Delete' || e.key === 'Backspace') && s.chosen) {
      const surface = this.chosen(ctx);
      if (!surface) return false;
      const id = surface.id;
      if (s.point >= 0 && s.point < surface.outer.length && surface.outer.length > 3) {
        const at = s.point;
        this.change(ctx, ctx.t().editor.surfaces.removeCorner, (list) => {
          const f = list.find((x) => x.id === id);
          if (!f) return;
          f.outer.splice(at, 1);
          refitMarking(f);
        });
        patch(ctx.settings.surfaces, { point: -1 });
      } else {
        this.change(ctx, ctx.t().editor.surfaces.removeSurface, (list) => list.splice(list.findIndex((x) => x.id === id), 1));
        patch(ctx.settings.surfaces, { chosen: null, point: -1 });
      }
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): boolean {
    const s = ctx.settings.surfaces();
    if (this.draft.length) {
      this.draft = [];
      this.holding = null;
      ctx.overlay.draft.clear();
      return true;
    }
    if (!s.chosen) return false;
    patch(ctx.settings.surfaces, { chosen: null, point: -1 });
    return true;
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.surfaces();
    if (s.mode === 'draw') {
      return this.draft.length ? ctx.t().editor.surfaces.hintNext : ctx.t().editor.surfaces.hintDraw;
    }
    return s.chosen
      ? ctx.t().editor.surfaces.hintEdit
      : ctx.t().editor.surfaces.hintChoose;
  }

  /** Ends the outline being drawn: a new surface, the chosen one */
  private finish(ctx: ToolContext): void {
    const s = ctx.settings.surfaces();
    const points = dedupe(this.draft);
    this.draft = [];
    this.holding = null;
    ctx.overlay.draft.clear();
    if (points.length < 3 || outlineArea(points) < 4) {
      ctx.status(ctx.t().editor.surfaces.threeCorners);
      return;
    }
    const list = ctx.editor.doc.surfaces ?? [];
    if (list.length >= MAX_SURFACES) {
      ctx.status(ctx.t().editor.surfaces.tooMany(MAX_SURFACES));
      return;
    }
    const surface = newSurface(list, s.material, points, s.marking === 'none' ? null : s.marking);
    // With symmetry on, its images too, in the same step
    const t = ctx.editor.doc.terrain;
    const taken = [...list, surface];
    const images = surfaceImages([surface], symmetryImages(ctx.settings.symmetry(), t.grid.columns === t.grid.rows), () => {
      const id = newSurfaceId(taken);
      taken.push({ ...surface, id });
      return id;
    }, t.width / 2, t.depth / 2).slice(0, MAX_SURFACES - list.length - 1);
    this.change(ctx, ctx.t().editor.surfaces.addSurface, (l) => l.push(surface, ...images));
    patch(ctx.settings.surfaces, { chosen: surface.id, point: -1 });
    ctx.status(surface.marking || s.marking === 'none' ? ctx.t().editor.surfaces.added : ctx.t().editor.surfaces.addedThin);
  }

  private editDown(p: ToolPointer, ctx: ToolContext): boolean {
    const hit = p.hit!;
    const reach = ctx.metresPerPixel(hit) * PICK_PX;
    const chosen = this.chosen(ctx);
    if (chosen) {
      // A handle of the chosen surface: a corner of its outline or of its marking
      const handles = [...chosen.outer, ...(chosen.marking ? markingCorners(chosen.marking) : [])];
      const k = nearestPoint(handles, hit, reach);
      if (k >= 0) {
        patch(ctx.settings.surfaces, { point: k });
        this.dragging = { before: structuredClone(ctx.editor.doc.surfaces), moved: false };
        return true;
      }
      if (p.shift) {
        const at = nearestEdge(chosen.outer, hit, reach);
        if (at >= 0 && chosen.outer.length < MAX_SURFACE_POINTS) {
          const id = chosen.id;
          this.change(ctx, ctx.t().editor.surfaces.addCorner, (list) => {
            const f = list.find((x) => x.id === id);
            if (!f) return;
            f.outer.splice(at + 1, 0, round({ x: hit.x, y: hit.y }));
            refitMarking(f);
          });
          patch(ctx.settings.surfaces, { point: at + 1 });
          return true;
        }
      }
    }
    const picked = pickSurface(ctx.editor.doc.surfaces ?? [], hit);
    patch(ctx.settings.surfaces, { chosen: picked?.id ?? null, point: -1 });
    if (picked) ctx.status(ctx.t().editor.surfaces.chosen);
    return true;
  }

  private chosen(ctx: ToolContext): MapSurface | null {
    const id = ctx.settings.surfaces().chosen;
    return (id && ctx.editor.doc.surfaces?.find((s) => s.id === id)) || null;
  }

  /** One step: the map's surfaces before and after `edit` */
  private change(ctx: ToolContext, label: string, edit: (list: MapSurface[]) => void): void {
    ctx.editor.execute(surfacesCommand(ctx.editor.doc, edit, label));
    this.shown = null;
  }

  /** The outlines over the map, the chosen one with its marking and handles, when something changed */
  private redraw(ctx: ToolContext): void {
    const s = ctx.settings.surfaces();
    const surfaces = ctx.editor.doc.surfaces;
    if (this.shown && this.shown.surfaces === surfaces && this.shown.chosen === s.chosen && this.shown.point === s.point) return;
    this.shown = { surfaces, chosen: s.chosen, point: s.point };
    ctx.overlay.shapes.set(surfaceShapes(surfaces ?? [], s.chosen), s.chosen, s.point);
  }
}

/** The outlines and holes of the surfaces, and the chosen one's marking after its outline (its handles follow on) */
export function surfaceShapes(surfaces: readonly MapSurface[], chosen: string | null): OverlayShape[] {
  const out: OverlayShape[] = [];
  for (const s of surfaces) {
    out.push({ id: s.id, points: s.outer, closed: true, color: OUTLINE });
    (s.holes ?? []).forEach((h, k) => out.push({ id: `${s.id}:hole-${k}`, points: h, closed: true, color: OUTLINE }));
    if (s.id === chosen && s.marking) out.push({ id: s.id, points: markingCorners(s.marking), closed: true, color: MARKING });
  }
  return out;
}

/** The surface under a map point: the smallest that holds it */
export function pickSurface(surfaces: readonly MapSurface[], at: MapPoint): MapSurface | null {
  let best: MapSurface | null = null;
  let bestArea = Infinity;
  for (const s of surfaces) {
    if (!insideSurface(s, at)) continue;
    const area = surfaceArea(s);
    if (area < bestArea) {
      bestArea = area;
      best = s;
    }
  }
  return best;
}

/** The point nearest within `reach`; of two as near the first (an outline's corner before the marking's on it) */
function nearestPoint(points: readonly MapPoint[], at: MapPoint, reach: number): number {
  let best = -1;
  let bestD = reach + 1e-6;
  points.forEach((q, k) => {
    const d = Math.hypot(q.x - at.x, q.y - at.y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** The edge of an outline nearest the point within `reach` (its first corner's index), or -1 */
function nearestEdge(points: readonly MapPoint[], at: MapPoint, reach: number): number {
  let best = -1;
  let bestD = reach;
  const out = { x: 0, y: 0 };
  for (let k = 0; k < points.length; k++) {
    const d = nearestOnShape({ shape: 'route', points: [points[k], points[(k + 1) % points.length]] }, at.x, at.y, out);
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function round(p: MapPoint): MapPoint {
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

/** The points without ones on top of the one before (or of the first, at the end) */
function dedupe(points: readonly MapPoint[]): MapPoint[] {
  const out: MapPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) out.push(p);
  }
  while (out.length > 3 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 0.5) out.pop();
  return out;
}
