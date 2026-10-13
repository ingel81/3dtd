/**
 * Spawns and HQ: in Spawn mode a click on empty ground adds a spawn, in HQ
 * mode it moves the HQ there. A drag on a spawn or the HQ moves it, a click
 * selects it; Shift+click adds spawns to the selection and a drag on one of
 * several selected moves them all; Delete removes the selected spawns.
 * Positions snap onto the nearest road within the path snap radius (Alt
 * places freely; several dragged together keep their places to each other).
 */
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import type { MapPoint, MapSpawn } from '../../world/custom-map/map-document';
import { SnapshotCommand, selectedSpawns, spawnSelection, type DocParts, type EditCommand, type EditorDocument } from '../model/editor-document';
import { insideMap } from '../model/grid';
import { nearestOnEdges, newId } from '../ops/path-graph';
import { symmetryImages } from '../ops/symmetry';
import type { EditorTool, ToolContext, ToolPointer } from './tool';

/** Names for new spawns by compass side */
export function spawnName(doc: { terrain: { width: number; depth: number } }, p: MapPoint, taken: readonly MapSpawn[]): string {
  const ax = p.x / (doc.terrain.width / 2);
  const ay = p.y / (doc.terrain.depth / 2);
  const ns = ay > 0.33 ? 'North' : ay < -0.33 ? 'South' : '';
  const ew = ax > 0.33 ? 'east' : ax < -0.33 ? 'west' : '';
  let base = ns && ew ? `${ns}${ew}` : ns || (ew ? ew[0].toUpperCase() + ew.slice(1) : 'Centre');
  if (taken.some((s) => s.name === base)) {
    let n = 2;
    while (taken.some((s) => s.name === `${base} ${n}`)) n++;
    base = `${base} ${n}`;
  }
  return base;
}

export class MarkerTool implements EditorTool {
  readonly id = 'markers' as const;
  private drag: { kind: 'spawn' | 'hq'; id?: string; group?: { ids: string[]; from: MapPoint; start: MapPoint[] }; before: Partial<DocParts>; moved: boolean } | null = null;

  brushVisible(): boolean {
    return false;
  }


  deactivate(ctx: ToolContext): void {
    this.cancel(ctx);
  }

  pointerDown(p: ToolPointer, ctx: ToolContext): boolean {
    if (p.button !== 0 || !p.hit) return false;
    const editor = ctx.editor;
    const picked = ctx.pick(p);
    if (picked?.kind === 'spawn' && p.shift) {
      const ids = selectedSpawns(editor.selection);
      editor.select(spawnSelection(ids.includes(picked.id) ? ids.filter((id) => id !== picked.id) : [...ids, picked.id]));
      return true;
    }
    if (picked?.kind === 'spawn' || picked?.kind === 'hq') {
      const chosen = selectedSpawns(editor.selection);
      // One of several selected spawns drags them all
      const group = picked.kind === 'spawn' && chosen.length > 1 && chosen.includes(picked.id);
      if (!group) editor.select(picked.kind === 'spawn' ? { kind: 'spawn', id: picked.id } : { kind: 'hq' });
      this.drag = {
        kind: picked.kind,
        id: picked.kind === 'spawn' ? picked.id : undefined,
        group: group
          ? { ids: chosen, from: { x: p.hit.x, y: p.hit.y }, start: chosen.map((id) => { const sp = editor.doc.spawns.find((x) => x.id === id)!; return { x: sp.x, y: sp.y }; }) }
          : undefined,
        before: { spawns: structuredClone(editor.doc.spawns), hq: { ...editor.doc.hq } },
        moved: false,
      };
      return true;
    }
    const point = this.snap(p, ctx);
    if (!insideMap(editor.doc.terrain, point)) return true;
    if (ctx.settings.markers.mode === 'hq') {
      editor.execute(markerCommands.moveHq(editor, point));
      editor.select({ kind: 'hq' });
    } else {
      const t = editor.doc.terrain;
      const points = symmetryImages(ctx.settings.symmetry, t.grid.columns === t.grid.rows)
        .map((img) => img.point(point))
        .filter((q, k, all) => all.findIndex((o) => Math.hypot(o.x - q.x, o.y - q.y) < 1) === k);
      if (editor.doc.spawns.length + points.length > MAX_SPAWN_PORTALS) {
        ctx.status(`A map holds at most ${MAX_SPAWN_PORTALS} spawns; the game would leave the rest unused.`);
        return true;
      }
      const command = markerCommands.addSpawn(editor, points);
      editor.execute(command.command);
      editor.select({ kind: 'spawn', id: command.id });
    }
    return true;
  }

  pointerMove(p: ToolPointer, ctx: ToolContext): void {
    const d = this.drag;
    if (!d || !p.hit) return;
    const doc = ctx.editor.doc;
    if (d.group) {
      const g = d.group;
      const dx = p.hit.x - g.from.x;
      const dy = p.hit.y - g.from.y;
      const moved = g.start.map((s) => ({ x: Math.round((s.x + dx) * 10) / 10, y: Math.round((s.y + dy) * 10) / 10 }));
      if (!moved.every((q) => insideMap(doc.terrain, q))) return;
      d.moved = true;
      doc.spawns = doc.spawns.map((s) => {
        const k = g.ids.indexOf(s.id);
        return k < 0 ? s : { ...s, ...moved[k] };
      });
      ctx.editor.emit({ markers: true });
      return;
    }
    const point = this.snap(p, ctx);
    if (!insideMap(doc.terrain, point)) return;
    d.moved = true;
    if (d.kind === 'hq') doc.hq = point;
    else doc.spawns = doc.spawns.map((s) => (s.id === d.id ? { ...s, ...point } : s));
    ctx.editor.emit({ markers: true });
  }

  pointerUp(_p: ToolPointer, ctx: ToolContext): void {
    const d = this.drag;
    this.drag = null;
    if (!d?.moved) return;
    const doc = ctx.editor.doc;
    ctx.editor.push(
      new SnapshotCommand(d.kind === 'hq' ? 'Move HQ' : d.group ? 'Move spawns' : 'Move spawn', d.before, { spawns: structuredClone(doc.spawns), hq: { ...doc.hq } }),
      { markers: true },
    );
  }


  key(e: KeyboardEvent, ctx: ToolContext): boolean {
    const ids = selectedSpawns(ctx.editor.selection);
    if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length) {
      ctx.editor.execute(markerCommands.removeSpawns(ctx.editor, ids));
      ctx.editor.select(null);
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      ctx.editor.select(spawnSelection(ctx.editor.doc.spawns.map((s) => s.id)));
      return true;
    }
    const k = e.key.toLowerCase();
    if (!e.ctrlKey && !e.metaKey && (k === 'q' || k === 'h')) {
      ctx.settings.markers.mode = k === 'h' ? 'hq' : 'spawn';
      ctx.settingsChanged();
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    const d = this.drag;
    this.drag = null;
    if (d?.moved) {
      ctx.editor.doc.spawns = d.before.spawns!;
      ctx.editor.doc.hq = d.before.hq!;
      ctx.editor.emit({ markers: true });
    }
  }

  hint(ctx: ToolContext): string {
    return ctx.settings.markers.mode === 'hq'
      ? 'Click to move the HQ | drag spawns and HQ | Q spawn mode | snaps onto roads, Alt places freely'
      : 'Click to add a spawn | drag spawns and HQ, Shift+click selects several | Del removes | H HQ mode | snaps onto roads, Alt places freely';
  }

  private snap(p: ToolPointer, ctx: ToolContext): MapPoint {
    const hit = { x: Math.round(p.hit!.x * 10) / 10, y: Math.round(p.hit!.y * 10) / 10 };
    if (p.alt) return hit;
    const on = nearestOnEdges(ctx.editor.doc.paths, hit, ctx.settings.paths.snap);
    return on ? { x: Math.round(on.point.x * 10) / 10, y: Math.round(on.point.y * 10) / 10 } : hit;
  }
}

export const markerCommands = {
  moveHq(editor: EditorDocument, p: MapPoint): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Move HQ', ['hq'], (d) => (d.hq = { x: p.x, y: p.y }));
  },
  /** Spawns at the points (the first is the one clicked, the rest its symmetric images); returns the first id */
  addSpawn(editor: EditorDocument, points: readonly MapPoint[]): { command: EditCommand; id: string } {
    let first = '';
    const command = SnapshotCommand.record(editor.doc, points.length > 1 ? 'Add spawns' : 'Add spawn', ['spawns'], (d) => {
      for (const p of points) {
        const id = newId('s', d.spawns);
        first ||= id;
        d.spawns.push({ id, name: spawnName(d, p, d.spawns), x: p.x, y: p.y });
      }
    });
    return { command, id: first };
  },
  removeSpawn(editor: EditorDocument, id: string): EditCommand {
    return markerCommands.removeSpawns(editor, [id]);
  },
  removeSpawns(editor: EditorDocument, ids: readonly string[]): EditCommand {
    const gone = new Set(ids);
    return SnapshotCommand.record(editor.doc, ids.length > 1 ? 'Delete spawns' : 'Delete spawn', ['spawns'], (d) => (d.spawns = d.spawns.filter((s) => !gone.has(s.id))));
  },
  /** The player may close the lane before wave 1, or it is always open (TODO E130) */
  setSpawnOptional(editor: EditorDocument, id: string, optional: boolean): EditCommand {
    return SnapshotCommand.record(editor.doc, optional ? 'Lane optional' : 'Lane always open', ['spawns'], (d) => {
      d.spawns = d.spawns.map((s) => {
        if (s.id !== id) return s;
        const { optional: _, ...rest } = s;
        return optional ? { ...rest, optional: true } : rest;
      });
    });
  },
  renameSpawn(editor: EditorDocument, id: string, name: string): EditCommand {
    return SnapshotCommand.record(editor.doc, 'Rename spawn', ['spawns'], (d) => {
      d.spawns = d.spawns.map((s) => (s.id === id ? { ...s, name } : s));
    });
  },
};
