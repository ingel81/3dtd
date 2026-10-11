/**
 * Copy and stamps: in Select, drag a rectangle on the ground and copy it
 * (Ctrl+C); in Paste, the piece follows the pointer as an outline and a
 * click puts it down (Ctrl+V switches to Paste). R and Shift+R turn by 90
 * degrees, comma and period by 15. Every paste is one undo step.
 */
import type { MapPoint } from '../../world/custom-map/map-document';
import { LandscapeStroke } from '../ops/landscape/landscape-stroke';
import { captureStamp, pasteStamp, stampOutline } from '../ops/stamp';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

const QUARTER = Math.PI / 2;
const STEP = Math.PI / 12;

export class StampTool implements EditorTool {
  readonly id = 'stamp' as const;
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
    const s = ctx.settings.stamp;
    if (s.mode === 'paste') {
      this.paste(p.hit, ctx);
      return true;
    }
    this.dragFrom = { x: p.hit.x, y: p.hit.y };
    s.region = null;
    ctx.settingsChanged();
    return true;
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.dragFrom || !p.hit) return;
    ctx.settings.stamp.region = { x0: this.dragFrom.x, y0: this.dragFrom.y, x1: p.hit.x, y1: p.hit.y };
  }

  pointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.dragFrom) return;
    this.dragFrom = null;
    const r = ctx.settings.stamp.region;
    if (r && (Math.abs(r.x1 - r.x0) < 4 || Math.abs(r.y1 - r.y0) < 4)) ctx.settings.stamp.region = null;
    ctx.settingsChanged();
  }

  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    const s = ctx.settings.stamp;
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
    const s = ctx.settings.stamp;
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
      s.mode = 'paste';
      ctx.settingsChanged();
      return true;
    }
    if (ctrl || s.mode !== 'paste') return false;
    if (k === 'r') {
      s.rotation += e.shiftKey ? -QUARTER : QUARTER;
      ctx.settingsChanged();
      return true;
    }
    if (e.key === ',' || e.key === '.') {
      s.rotation += e.key === '.' ? -STEP : STEP;
      ctx.settingsChanged();
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    const s = ctx.settings.stamp;
    this.dragFrom = null;
    if (s.mode === 'paste') s.mode = 'select';
    else s.region = null;
    ctx.overlay.setDraft(null);
    ctx.settingsChanged();
  }

  hint(ctx: ToolContext): string {
    const s = ctx.settings.stamp;
    if (s.mode === 'paste') {
      return s.current
        ? `Click to place ${s.currentName || 'the copy'} | R turn 90 | , . turn 15 | Esc back to selecting`
        : 'Nothing to place: copy a piece or pick a stamp';
    }
    return s.region ? 'Ctrl+C copies the rectangle | drag again for another' : 'Drag a rectangle on the map to copy';
  }

  /** Copies the chosen rectangle and switches to placing it */
  copy(ctx: ToolContext): boolean {
    const s = ctx.settings.stamp;
    if (!s.region) {
      ctx.status('Drag a rectangle first');
      return false;
    }
    s.current = captureStamp(ctx.editor.doc, s.region);
    s.currentName = 'the copy';
    s.rotation = 0;
    s.mode = 'paste';
    ctx.settingsChanged();
    ctx.status(`Copied ${Math.round(s.current.width)} x ${Math.round(s.current.depth)} m: click to place`);
    return true;
  }

  private paste(at: MapPoint, ctx: ToolContext): void {
    const s = ctx.settings.stamp;
    if (!s.current) {
      ctx.status('Nothing to place');
      return;
    }
    const stroke = new LandscapeStroke(ctx.editor, 'Paste', 0, ctx.catalog);
    pasteStamp(stroke, s.current, at, { parts: s.parts, rotation: s.rotation, feather: s.feather });
    stroke.finish();
  }
}
