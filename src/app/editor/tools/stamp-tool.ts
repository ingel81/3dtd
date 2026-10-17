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
  readonly fixedKeys = [{ key: 'r', what: 'turn the copy by 90 degrees' }] as const;
  private dragFrom: MapPoint | null = null;

  brushVisible(): boolean {
    return false;
  }

  deactivate(ctx: ToolContext): void {
    this.dragFrom = null;
    ctx.overlay.setDraft(null);
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
      ctx.overlay.setDraft(stampOutline(s.current, p.hit, s.rotation));
      return;
    }
    const r = s.region;
    ctx.overlay.setDraft(
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
        ctx.status('Copy a piece first (drag a rectangle, Ctrl+C) or pick a stamp');
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
    ctx.overlay.setDraft(null);
    return busy;
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.stamp();
    if (s.mode === 'paste') {
      return s.current
        ? `Click to place ${s.currentName || 'the copy'} | R turn 90 | , . turn 15 | Esc back to selecting`
        : 'Nothing to place: copy a piece or pick a stamp';
    }
    return s.region ? 'Ctrl+C copies the rectangle | drag again for another' : 'Drag a rectangle on the map to copy';
  }

  /** Copies the chosen rectangle and switches to placing it */
  copy(ctx: ToolContext): boolean {
    const s = ctx.settings.stamp();
    if (!s.region) {
      ctx.status('Drag a rectangle first');
      return false;
    }
    const current = captureStamp(ctx.editor.doc, s.region);
    patch(ctx.settings.stamp, { current, currentName: 'the copy', rotation: 0, mode: 'paste' });
    ctx.status(`Copied ${Math.round(current.width)} x ${Math.round(current.depth)} m: click to place`);
    return true;
  }

  private paste(at: MapPoint, ctx: ToolContext): void {
    const s = ctx.settings.stamp();
    if (!s.current) {
      ctx.status('Nothing to place');
      return;
    }
    const stroke = new LandscapeContext(ctx.editor.begin('Paste'), 0, ctx.catalog);
    pasteStamp(stroke, s.current, at, { parts: s.parts, rotation: s.rotation, feather: s.feather });
    stroke.finish();
  }
}
