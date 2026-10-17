/**
 * Look: the tool in hand when none is. A click selects what stands under
 * the pointer (an object with its group, a spawn, the HQ, a road) and says
 * what it is; nothing on the map moves, grows or gets painted. The editor
 * opens with it, and Esc comes back to it once nothing is half done.
 */
import { withGroups } from '../../map-ops/object-ops';
import { describeGround, describePick } from '../ops/describe';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

export class LookTool implements EditorTool {
  readonly id = 'look' as const;
  private hoverAt: { x: number; y: number } | null = null;

  brushVisible(): boolean {
    return false;
  }

  deactivate(): void {
    this.hoverAt = null;
  }

  /** A click selects and names; never a drag of its own, so nothing on the map can move */
  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0) return false;
    const picked = ctx.pick(p);
    const editor = ctx.editor;
    // Bare ground: the panel describes the spot (its ground, height, slope, water)
    ctx.settings.look.set({ at: !picked && p.hit ? { x: p.hit.x, y: p.hit.y } : null });
    if (!picked) {
      editor.select(null);
      if (p.hit) ctx.status(describeGround(editor.doc.terrain, p.hit.x, p.hit.y, ctx.catalog).what);
      return false;
    }
    switch (picked.kind) {
      case 'object':
        editor.select({ kind: 'objects', ids: p.ctrl ? [picked.id] : withGroups(editor.doc.objects, [picked.id]) });
        break;
      case 'spawn':
        editor.select({ kind: 'spawn', id: picked.id });
        break;
      case 'hq':
        editor.select({ kind: 'hq' });
        break;
      case 'node':
        editor.select({ kind: 'node', id: picked.id });
        break;
      case 'edge':
        editor.select({ kind: 'edge', id: picked.id });
        break;
    }
    ctx.status(describePick(picked, ctx.editor.doc, ctx.catalog));
    return false;
  }

  /** A faint ring on the object a click would take, as in Select of the object tool */
  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    if (!p?.hit) {
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

  hint(): string {
    return 'Look around: click a thing to see what it is | nothing changes the map here | pick a tool to edit';
  }
}
