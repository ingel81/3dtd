/**
 * Look: the tool in hand when none is. A click selects what stands under
 * the pointer (an object with its group, a spawn, the HQ, a road) and says
 * what it is; nothing on the map moves, grows or gets painted. The editor
 * opens with it, and Esc comes back to it once nothing is half done.
 */
import { withGroups } from '../ops/object-ops';
import type { EditorTool, PickResult, ToolContext, ToolPointer } from './tool';

/** What a picked thing is, in a few words for the status line and the panel */
export function describePick(picked: PickResult, ctx: Pick<ToolContext, 'editor' | 'catalog'>): string {
  const doc = ctx.editor.doc;
  switch (picked.kind) {
    case 'object': {
      const o = doc.objects.find((x) => x.id === picked.id);
      if (!o) return 'Object';
      const entry = ctx.catalog.object(o.asset);
      return `${entry.name} (${entry.category.toLowerCase()})`;
    }
    case 'spawn':
      return `Spawn ${doc.spawns.find((s) => s.id === picked.id)?.name ?? ''}`.trim();
    case 'hq':
      return 'HQ';
    case 'node':
      return 'Road node';
    case 'edge': {
      const e = doc.paths.edges.find((x) => x.id === picked.id);
      return e ? `${e.kind === 'path' ? 'Path' : e.kind === 'bridge' ? 'Bridge' : 'Road'}, ${Math.round(e.width)} m wide` : 'Road';
    }
  }
}

export class LookTool implements EditorTool {
  readonly id = 'look' as const;
  private hoverAt: { x: number; y: number } | null = null;

  brushVisible(): boolean {
    return false;
  }

  deactivate(ctx: ToolContext): void {
    ctx.overlay.setHover(null);
    this.hoverAt = null;
  }

  /** A click selects and names; never a drag of its own, so nothing on the map can move */
  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0) return false;
    const picked = ctx.pick(p);
    const editor = ctx.editor;
    if (!picked) {
      editor.select(null);
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
    ctx.status(describePick(picked, ctx));
    return false;
  }

  /** A faint ring on the object a click would take, as in Select of the object tool */
  frame(_dt: number, p: ToolPointer | null, ctx: ToolContext): void {
    if (!p?.hit) {
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

  hint(): string {
    return 'Look around: click a thing to see what it is | nothing changes the map here | pick a tool to edit';
  }
}
