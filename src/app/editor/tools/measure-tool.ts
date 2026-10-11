/**
 * Measure: each click adds a point; the panel shows the length on the map
 * and along the ground, and the height climbed. Esc or a right click clears.
 */
import type { MapPoint, MapTerrain } from '../../world/custom-map/map-document';
import { heightAt } from '../model/grid';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

export interface MeasureResult {
  /** Straight length on the map */
  flat: number;
  /** Length along the ground, up and down included */
  ground: number;
  climb: number;
  drop: number;
}

/** Lengths of a measured line, sampled every 2 m along the ground */
export function measureLine(t: MapTerrain, points: readonly MapPoint[]): MeasureResult {
  let flat = 0;
  let ground = 0;
  let climb = 0;
  let drop = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    flat += len;
    const n = Math.max(1, Math.ceil(len / 2));
    let h = heightAt(t, a.x, a.y);
    for (let s = 1; s <= n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n;
      const y = a.y + ((b.y - a.y) * s) / n;
      const next = heightAt(t, x, y);
      ground += Math.hypot(len / n, next - h);
      if (next > h) climb += next - h;
      else drop += h - next;
      h = next;
    }
  }
  return { flat, ground, climb, drop };
}

export class MeasureTool implements EditorTool {
  readonly id = 'measure' as const;

  brushVisible(): boolean {
    return false;
  }

  deactivate(ctx: ToolContext): void {
    ctx.overlay.setMeasure(null);
  }

  activate(ctx: ToolContext): void {
    ctx.overlay.setMeasure(ctx.settings.measure);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button === 2) {
      this.cancel(ctx);
      return true;
    }
    if (p.button !== 0 || !p.hit) return false;
    ctx.settings.measure = [...ctx.settings.measure, { x: p.hit.x, y: p.hit.y }];
    ctx.settingsChanged();
    return true;
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const pts = ctx.settings.measure;
    ctx.overlay.setMeasure(p?.hit && pts.length ? [...pts, p.hit] : pts);
  }

  cancel(ctx: ToolContext): void {
    ctx.settings.measure = [];
    ctx.overlay.setMeasure(null);
    ctx.settingsChanged();
  }

  hint(ctx: ToolContext): string {
    return ctx.settings.measure.length ? 'Click to add a point | Esc or right click clears' : 'Click points on the map to measure';
  }
}
