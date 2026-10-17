/**
 * Measure: each click adds a point; the panel shows the length on the map
 * and along the ground, and the height climbed. Esc or a right click clears.
 */
import type { EditorTool, ToolContext, ToolPointer } from './tool';

export class MeasureTool implements EditorTool {
  readonly id = 'measure' as const;

  brushVisible(): boolean {
    return false;
  }

  activate(ctx: ToolContext): void {
    ctx.overlay.measure.set(ctx.settings.measure());
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button === 2) {
      this.cancel(ctx);
      return true;
    }
    if (p.button !== 0 || !p.hit) return false;
    const hit = { x: p.hit.x, y: p.hit.y };
    ctx.settings.measure.update((points) => [...points, hit]);
    return true;
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const pts = ctx.settings.measure();
    ctx.overlay.measure.set(p?.hit && pts.length ? [...pts, p.hit] : pts);
  }

  cancel(ctx: ToolContext): boolean {
    const had = ctx.settings.measure().length > 0;
    ctx.settings.measure.set([]);
    ctx.overlay.measure.clear();
    return had;
  }

  hint(ctx: ToolContext): string {
    return ctx.settings.measure().length ? 'Click to add a point | Esc or right click clears' : 'Click points on the map to measure';
  }
}
