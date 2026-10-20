/**
 * Copy and stamps: in Select, drag a rectangle on the ground and copy it
 * (Ctrl+C); in Paste, the piece follows the pointer as an outline and a
 * click puts it down (Ctrl+V switches to Paste). R and Shift+R turn by 90
 * degrees, comma and period by 15. Every paste is one undo step.
 */
import type { MapPoint } from '../../world/custom-map/map-document';
import { LandscapeContext } from '../ops/landscape/landscape-context';
import { captureStamp, pasteStamp, stampOutline } from '../ops/stamp';
import { patch, type EditorTool, type ToolContext, type ToolPointer } from './tool';

const QUARTER = Math.PI / 2;
const STEP = Math.PI / 12;

export class StampTool implements EditorTool {
  readonly id = 'stamp' as const;
  readonly fixedKeys = [{ key: 'r', what: 'turnCopy' }] as const;
  private dragFrom: MapPoint | null = null;

  brushVisible(): boolean {
    return false;
  }

  deactivate(): void {
    this.dragFrom = null;
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    const s = ctx.settings.stamp();
    if (s.mode === 'paste') {
      this.paste(p.hit, ctx);
      return true;
    }
    this.dragFrom = { x: p.hit.x, y: p.hit.y };
    patch(ctx.settings.stamp, { region: null });
    return true;
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.dragFrom || !p.hit) return;
    patch(ctx.settings.stamp, { region: { x0: this.dragFrom.x, y0: this.dragFrom.y, x1: p.hit.x, y1: p.hit.y } });
  }

  pointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.dragFrom) return;
    this.dragFrom = null;
    const r = ctx.settings.stamp().region;
    if (r && (Math.abs(r.x1 - r.x0) < 4 || Math.abs(r.y1 - r.y0) < 4)) patch(ctx.settings.stamp, { region: null });
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.stamp();
    if (s.mode === 'paste' && s.current && p?.hit) {
      ctx.overlay.draft.set(stampOutline(s.current, p.hit, s.rotation));
      return;
    }
    const r = s.region;
    ctx.overlay.draft.set(
      s.mode === 'select' && r
        ? [
            { x: r.x0, y: r.y0 },
            { x: r.x1, y: r.y0 },
            { x: r.x1, y: r.y1 },
            { x: r.x0, y: r.y1 },
            { x: r.x0, y: r.y0 },
          ]
        : null,
    );
  }

  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    const s = ctx.settings.stamp();
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'c') {
      this.copy(ctx);
      return true;
    }
    if (ctrl && k === 'v') {
      if (!s.current) {
        ctx.status(ctx.t().editor.stamps.copyFirst);
        return true;
      }
      patch(ctx.settings.stamp, { mode: 'paste' });
      return true;
    }
    if (ctrl || s.mode !== 'paste') return false;
    if (k === 'r') {
      patch(ctx.settings.stamp, { rotation: s.rotation + (e.shiftKey ? -QUARTER : QUARTER) });
      return true;
    }
    if (e.key === ',' || e.key === '.') {
      patch(ctx.settings.stamp, { rotation: s.rotation + (e.key === '.' ? -STEP : STEP) });
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): boolean {
    const s = ctx.settings.stamp();
    const busy = !!this.dragFrom || s.mode === 'paste' || !!s.region;
    this.dragFrom = null;
    patch(ctx.settings.stamp, s.mode === 'paste' ? { mode: 'select' } : { region: null });
    ctx.overlay.draft.clear();
    return busy;
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.stamp();
    if (s.mode === 'paste') {
      return s.current
        ? ctx.t().editor.stamps.hintPlace(s.currentName || ctx.t().editor.stamps.theCopy)
        : ctx.t().editor.stamps.hintNothing;
    }
    return s.region ? ctx.t().editor.stamps.hintCopy : ctx.t().editor.stamps.hintDrag;
  }

  /** Copies the chosen rectangle and switches to placing it */
  copy(ctx: ToolContext): boolean {
    const s = ctx.settings.stamp();
    if (!s.region) {
      ctx.status(ctx.t().editor.stamps.dragFirst);
      return false;
    }
    const current = captureStamp(ctx.editor.doc, s.region);
    patch(ctx.settings.stamp, { current, currentName: '', rotation: 0, mode: 'paste' });
    ctx.status(ctx.t().editor.stamps.copied(Math.round(current.width), Math.round(current.depth)));
    return true;
  }

  private paste(at: MapPoint, ctx: ToolContext): void {
    const s = ctx.settings.stamp();
    if (!s.current) {
      ctx.status(ctx.t().editor.stamps.nothing);
      return;
    }
    const stroke = new LandscapeContext(ctx.editor.begin(ctx.t().editor.stamps.paste), 0, ctx.catalog);
    pasteStamp(stroke, s.current, at, { parts: s.parts, rotation: s.rotation, feather: s.feather });
    stroke.finish();
  }
}
