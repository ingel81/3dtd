/**
 * Life: life areas and routes on the map (map-life.ts, TODO E190). Area
 * draws an outline: a click per corner, or hold and drag to paint it
 * freehand; Enter, a double click or a right click closes it. Route draws
 * a line the same way. What the new one holds (birds, fireflies, fog,
 * leaves, embers, sparks, boats, a sound) is the panel's kind. Edit picks
 * an area by a click inside it (a route near its line), drags its points,
 * Shift+click on its edge adds a point there, Delete removes the chosen
 * point (an outline keeps three, a line two) or, with none chosen, the
 * area. Every finished outline, line and drag is one step in the history.
 */
import type { CustomMapDocument, MapLife, MapLifeArea, MapPoint } from '../../world/custom-map/map-document';
import { LIFE_KIND_INFO, MAX_LIFE_AREAS, MAX_LIFE_POINTS, nearestOnShape, newLifeId, outlineArea, shapeLength } from '../../world/custom-map/map-life';
import { SnapshotCommand } from '../model/editor-document';
import { insideMap } from '../model/grid';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

/** Screen pixels a handle or a route's line takes a click from */
const PICK_PX = 12;
/** Metres between two points of a freehand outline */
const FREEHAND_STEP = 6;

/** The map's life with a change, a fresh copy (the document keeps undo snapshots of the old one) */
export function withLife(doc: CustomMapDocument, change: (life: MapLife) => void): MapLife {
  const life: MapLife = structuredClone(doc.life ?? {});
  change(life);
  return life;
}

/** Defaults a new area of a kind starts with */
export function newLifeArea(id: string, kind: MapLifeArea['kind'], shape: MapLifeArea['shape'], points: MapPoint[]): MapLifeArea {
  const area: MapLifeArea = { id, kind, shape, points };
  if (kind === 'sound') area.sound = shape === 'route' ? 'stream' : 'birdsong';
  return area;
}

export class LifeTool implements EditorTool {
  readonly id = 'life' as const;
  /** The outline or line being drawn */
  private draft: MapPoint[] = [];
  /** Held down in a draw mode: freehand once the pointer moved */
  private holding: { from: MapPoint; freehand: boolean } | null = null;
  /** A point of the chosen area being dragged, and the map's life before */
  private dragging: { before: MapLife | undefined; moved: boolean } | null = null;
  private lastClick = 0;
  private lastClickAt = { x: -1e6, y: -1e6 };
  /** What the overlay shows now: the life object and the chosen area and point */
  private shown: { life: unknown; chosen: string | null; point: number } | null = null;

  brushVisible(): boolean {
    return false;
  }

  activate(ctx: ToolContext): void {
    this.shown = null;
    this.redraw(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    ctx.overlay.setLife(null, null, -1);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.life;
    if (p.button === 2 && this.draft.length) {
      this.finish(ctx);
      return true;
    }
    if (p.button !== 0 || !p.hit) return false;
    const now = performance.now();
    const double = now - this.lastClick < 320 && Math.hypot(p.clientX - this.lastClickAt.x, p.clientY - this.lastClickAt.y) < 6;
    this.lastClick = now;
    this.lastClickAt = { x: p.clientX, y: p.clientY };
    if (s.mode !== 'edit') {
      if (double && this.draft.length) {
        this.finish(ctx);
        return true;
      }
      this.holding = { from: { x: p.hit.x, y: p.hit.y }, freehand: false };
      if (this.draft.length < MAX_LIFE_POINTS) this.draft.push(round({ x: p.hit.x, y: p.hit.y }));
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
      if (hold.freehand && last && Math.hypot(p.hit.x - last.x, p.hit.y - last.y) >= FREEHAND_STEP && this.draft.length < MAX_LIFE_POINTS) {
        this.draft.push(round({ x: p.hit.x, y: p.hit.y }));
      }
      return;
    }
    const d = this.dragging;
    const s = ctx.settings.life;
    if (!d || !insideMap(ctx.editor.doc.terrain, p.hit)) return;
    const area = this.chosen(ctx);
    if (!area || s.point < 0 || s.point >= area.points.length) return;
    area.points[s.point] = round({ x: p.hit.x, y: p.hit.y });
    d.moved = true;
    this.shown = null;
    ctx.editor.emit({ life: true });
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
    editor.push(new SnapshotCommand('Move life point', { life: d.before }, { life: structuredClone(editor.doc.life) }), { life: true });
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.life;
    if (s.mode !== 'edit' && this.draft.length) {
      const line = [...this.draft];
      if (p?.hit && !this.holding?.freehand) line.push({ x: p.hit.x, y: p.hit.y });
      if (s.mode === 'area' && line.length > 2) line.push(line[0]);
      ctx.overlay.setDraft(line);
    } else ctx.overlay.setDraft(null);
    this.redraw(ctx);
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Enter' && this.draft.length) {
      this.finish(ctx);
      return true;
    }
    const s = ctx.settings.life;
    if ((e.key === 'Delete' || e.key === 'Backspace') && s.chosen) {
      const area = this.chosen(ctx);
      if (!area) return false;
      const least = area.shape === 'area' ? 3 : 2;
      if (s.point >= 0 && area.points.length > least) {
        const at = s.point;
        this.change(ctx, 'Remove life point', (life) => life.areas?.find((a) => a.id === area.id)?.points.splice(at, 1));
        s.point = -1;
      } else {
        const id = area.id;
        this.change(ctx, `Remove ${LIFE_KIND_INFO[area.kind].label.toLowerCase()}`, (life) => (life.areas = life.areas?.filter((a) => a.id !== id)));
        s.chosen = null;
        s.point = -1;
      }
      ctx.settingsChanged();
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): boolean {
    const s = ctx.settings.life;
    if (this.draft.length) {
      this.draft = [];
      this.holding = null;
      ctx.overlay.setDraft(null);
      return true;
    }
    if (!s.chosen) return false;
    s.chosen = null;
    s.point = -1;
    ctx.settingsChanged();
    return true;
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.life;
    const what = LIFE_KIND_INFO[s.kind].label;
    if (s.mode === 'area') {
      return this.draft.length
        ? `${what}: click the next corner; Enter, a double click or a right click closes the outline`
        : `${what}: click the corners of an outline, or hold and paint it freehand`;
    }
    if (s.mode === 'route') {
      return this.draft.length ? `${what}: click the next point; Enter, a double click or a right click ends the line` : `${what}: click the points of a line, or hold and draw it freehand`;
    }
    return s.chosen ? 'Drag a point; Shift+click on the edge adds one; Delete removes the point or the area' : 'Click inside an area or on a line to change it';
  }

  /** Ends the outline or line being drawn: a new life area, the chosen one */
  private finish(ctx: ToolContext): void {
    const s = ctx.settings.life;
    const points = this.draft;
    this.draft = [];
    this.holding = null;
    ctx.overlay.setDraft(null);
    const shape = s.mode === 'route' ? 'route' : 'area';
    const least = shape === 'area' ? 3 : 2;
    const usable = dedupe(points);
    if (usable.length < least || (shape === 'area' ? outlineArea(usable) < 16 : shapeLength(usable, false) < 4)) {
      ctx.status(shape === 'area' ? 'An outline needs three corners around some ground' : 'A line needs two points apart');
      return;
    }
    const areas = ctx.editor.doc.life?.areas ?? [];
    if (areas.length >= MAX_LIFE_AREAS) {
      ctx.status(`A map holds at most ${MAX_LIFE_AREAS} life areas`);
      return;
    }
    const id = newLifeId(areas, s.kind);
    const label = `${LIFE_KIND_INFO[s.kind].label} ${shape === 'area' ? 'area' : 'route'}`;
    this.change(ctx, label, (life) => (life.areas = [...(life.areas ?? []), newLifeArea(id, s.kind, shape, usable)]));
    s.chosen = id;
    s.point = -1;
    ctx.settingsChanged();
    ctx.status(`${label} added: its settings are in the panel`);
  }

  private editDown(p: ToolPointer, ctx: ToolContext): boolean {
    const s = ctx.settings.life;
    const hit = p.hit!;
    const reach = ctx.metresPerPixel(hit) * PICK_PX;
    const chosen = this.chosen(ctx);
    if (chosen) {
      // A point of the chosen area: drag it
      const k = nearestPoint(chosen.points, hit, reach);
      if (k >= 0) {
        s.point = k;
        this.dragging = { before: structuredClone(ctx.editor.doc.life), moved: false };
        ctx.settingsChanged();
        return true;
      }
      if (p.shift) {
        const at = nearestSegment(chosen, hit, reach);
        if (at >= 0) {
          this.change(ctx, 'Add life point', (life) => life.areas?.find((a) => a.id === chosen.id)?.points.splice(at + 1, 0, round({ x: hit.x, y: hit.y })));
          s.point = at + 1;
          ctx.settingsChanged();
          return true;
        }
      }
    }
    const picked = pickArea(ctx.editor.doc.life?.areas ?? [], hit, reach);
    s.chosen = picked?.id ?? null;
    s.point = -1;
    ctx.settingsChanged();
    if (picked) ctx.status(`${LIFE_KIND_INFO[picked.kind].label} ${picked.shape === 'area' ? 'area' : 'route'} chosen`);
    return true;
  }

  private chosen(ctx: ToolContext): MapLifeArea | null {
    const id = ctx.settings.life.chosen;
    return (id && ctx.editor.doc.life?.areas?.find((a) => a.id === id)) || null;
  }

  /** One step: the map's life before and after `edit` */
  private change(ctx: ToolContext, label: string, edit: (life: MapLife) => void): void {
    const editor = ctx.editor;
    editor.execute(SnapshotCommand.record(editor.doc, label, ['life'], (d) => (d.life = withLife(d, edit))));
    this.shown = null;
  }

  /** The areas over the map in their colours, the chosen one with handles, when something changed */
  private redraw(ctx: ToolContext): void {
    const s = ctx.settings.life;
    const life = ctx.editor.doc.life;
    if (this.shown && this.shown.life === life && this.shown.chosen === s.chosen && this.shown.point === s.point) return;
    this.shown = { life, chosen: s.chosen, point: s.point };
    ctx.overlay.setLife(life?.areas ?? [], s.chosen, s.point);
  }
}

/** The area under a map point: the smallest outline around it, else the nearest line within `reach` */
export function pickArea(areas: readonly MapLifeArea[], at: MapPoint, reach: number): MapLifeArea | null {
  const out = { x: 0, y: 0 };
  let best: MapLifeArea | null = null;
  let bestScore = Infinity;
  for (const a of areas) {
    const d = nearestOnShape(a, at.x, at.y, out);
    // Inside an outline counts by its size (the smallest wins), a line by its distance
    const score = d === 0 && a.shape === 'area' ? -1e9 + outlineArea(a.points) : d <= reach ? d : Infinity;
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function nearestPoint(points: readonly MapPoint[], at: MapPoint, reach: number): number {
  let best = -1;
  let bestD = reach;
  points.forEach((q, k) => {
    const d = Math.hypot(q.x - at.x, q.y - at.y);
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** The segment of the area's shape nearest the point within `reach` (its first point's index), or -1 */
function nearestSegment(area: MapLifeArea, at: MapPoint, reach: number): number {
  const pts = area.points;
  const segments = area.shape === 'area' ? pts.length : pts.length - 1;
  let best = -1;
  let bestD = reach;
  const out = { x: 0, y: 0 };
  for (let k = 0; k < segments; k++) {
    const d = nearestOnShape({ shape: 'route', points: [pts[k], pts[(k + 1) % pts.length]] }, at.x, at.y, out);
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

/** The points without ones on top of the one before */
function dedupe(points: readonly MapPoint[]): MapPoint[] {
  const out: MapPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) out.push(p);
  }
  return out;
}
