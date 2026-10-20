/** Spawns and the HQ as undoable steps, and the names new spawns get */
import type { MapPoint, MapSpawn } from '../../world/custom-map/map-document';
import type { EditCommand } from '../model/doc-change';
import type { EditorDocument } from '../model/editor-document';
import { SnapshotCommand } from '../model/commands/snapshot';
import { newId } from '../../map-ops/path-graph';

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

export const markerCommands = {
  moveHq(editor: EditorDocument, p: MapPoint): EditCommand {
    return SnapshotCommand.record(editor.doc, editor.words().editor.markers.moveHq, ['hq'], (d) => (d.hq = { x: p.x, y: p.y }));
  },
  /** Spawns at the points (the first is the one clicked, the rest its symmetric images); returns the first id */
  addSpawn(editor: EditorDocument, points: readonly MapPoint[]): { command: EditCommand; id: string } {
    let first = '';
    const command = SnapshotCommand.record(editor.doc, editor.words().editor.markers.addSpawns(points.length), ['spawns'], (d) => {
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
    return SnapshotCommand.record(editor.doc, editor.words().editor.markers.deleteSpawns(ids.length), ['spawns'], (d) => (d.spawns = d.spawns.filter((s) => !gone.has(s.id))));
  },
  /** The player may close the lane before wave 1, or it is always open (TODO E130) */
  setSpawnOptional(editor: EditorDocument, id: string, optional: boolean): EditCommand {
    return SnapshotCommand.record(editor.doc, optional ? editor.words().editor.markers.laneOptional : editor.words().editor.markers.laneOpen, ['spawns'], (d) => {
      d.spawns = d.spawns.map((s) => {
        if (s.id !== id) return s;
        const { optional: _, ...rest } = s;
        return optional ? { ...rest, optional: true } : rest;
      });
    });
  },
  renameSpawn(editor: EditorDocument, id: string, name: string): EditCommand {
    return SnapshotCommand.record(editor.doc, editor.words().editor.markers.renameSpawn, ['spawns'], (d) => {
      d.spawns = d.spawns.map((s) => (s.id === id ? { ...s, name } : s));
    });
  },
};
