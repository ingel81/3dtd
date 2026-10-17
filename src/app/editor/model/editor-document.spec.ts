import { createMapDocument } from '../../world/custom-map/map-create';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { raiseDab } from '../../map-ops/terrain-ops';
import {
  CompoundCommand,
  EditorDocument,
  EditorHeldError,
  ObjectsCommand,
  PatchCommand,
  SnapshotCommand,
  mergeChanges,
  type DocChange,
} from './editor-document';
import { sampleRectAround } from '../../map-ops/grid';
import { PATCH_TILE, RegionRecorder } from './region-patch';

function map(size = 400): CustomMapDocument {
  return createMapDocument({ id: 'm', name: 'M', width: size, depth: size, cellSize: 2 });
}

/** One brush stroke of raise dabs along a line, as the terrain tool does it */
function stroke(ed: EditorDocument, from: number, to: number): PatchCommand {
  const doc = ed.doc;
  const g = doc.terrain.grid;
  const rec = new RegionRecorder(g.heights, { columns: g.columns, rows: g.rows, channels: 1 });
  const brush = { radius: 10, strength: 1, falloff: 0.5 };
  for (let x = from; x <= to; x += 4) {
    rec.touch(sampleRectAround(doc.terrain, x, 0, brush.radius));
    raiseDab(doc.terrain, x, 0, brush, 2);
  }
  const cmd = new PatchCommand('Raise', [{ target: 'heights', patches: rec.finish() }]);
  ed.push(cmd, { heights: rec.rect! });
  return cmd;
}

describe('EditorDocument', () => {
  it('undoes and redoes a brush stroke exactly', () => {
    const ed = new EditorDocument(map());
    const original = ed.doc.terrain.grid.heights.slice();
    stroke(ed, -40, 40);
    const raised = ed.doc.terrain.grid.heights.slice();
    expect(raised).not.toEqual(original);
    expect(ed.dirty).toBe(true);
    ed.undo();
    expect(ed.doc.terrain.grid.heights).toEqual(original);
    expect(ed.dirty).toBe(false);
    ed.redo();
    expect(ed.doc.terrain.grid.heights).toEqual(raised);
  });

  it('stores only the touched tiles of a stroke', () => {
    const ed = new EditorDocument(map(800));
    const cmd = stroke(ed, -20, 20);
    const full = ed.doc.terrain.grid.heights.byteLength;
    expect(cmd.bytes).toBeLessThan(full / 10);
    // Each patch is at most one tile
    expect(cmd.bytes).toBeLessThanOrEqual(2 * 4 * PATCH_TILE * PATCH_TILE * 9);
  });

  it('tracks dirty across save, undo and new edits', () => {
    const ed = new EditorDocument(map());
    stroke(ed, 0, 0);
    ed.markSaved();
    expect(ed.dirty).toBe(false);
    ed.undo();
    expect(ed.dirty).toBe(true);
    ed.redo();
    expect(ed.dirty).toBe(false);
    ed.undo();
    stroke(ed, 10, 10);
    expect(ed.dirty).toBe(true);
    expect(ed.canRedo).toBe(false);
  });

  it('lists its steps and jumps back and forward to one', () => {
    const ed = new EditorDocument(map());
    const h0 = ed.doc.terrain.grid.heights.slice();
    stroke(ed, 0, 0);
    ed.execute(SnapshotCommand.record(ed.doc, 'Rename', ['meta'], (d) => (d.meta = { ...d.meta, name: 'N' })));
    stroke(ed, 40, 40);
    expect(ed.history).toEqual({ done: ['Raise', 'Rename', 'Raise'], undone: [] });
    expect(ed.jumpTo(1)).toBe(true);
    expect(ed.history).toEqual({ done: ['Raise'], undone: ['Rename', 'Raise'] });
    expect(ed.doc.meta.name).toBe('M');
    expect(ed.jumpTo(3)).toBe(true);
    expect(ed.doc.meta.name).toBe('N');
    ed.jumpTo(0);
    expect(ed.doc.terrain.grid.heights).toEqual(h0);
    expect(ed.jumpTo(4)).toBe(false);
  });

  it('tells listeners what changed', () => {
    const ed = new EditorDocument(map());
    const seen: DocChange[] = [];
    ed.onChange((c) => seen.push(c));
    ed.execute(SnapshotCommand.record(ed.doc, 'Move HQ', ['hq'], (d) => (d.hq = { x: 5, y: 5 })));
    expect(seen.at(-1)).toMatchObject({ markers: true });
    ed.undo();
    expect(ed.doc.hq).not.toEqual({ x: 5, y: 5 });
    expect(seen.at(-1)).toMatchObject({ markers: true });
  });

  it('tells listeners of a finished stroke whose dabs were told already', () => {
    const ed = new EditorDocument(map());
    const seen: DocChange[] = [];
    ed.onChange((c) => seen.push(c));
    const before = ed.stateId;
    ed.push(new PatchCommand('Raise', []));
    expect(seen).toEqual([{}]);
    expect(ed.stateId).not.toBe(before);
  });

  it('adds, changes and removes objects in place', () => {
    const ed = new EditorDocument(map());
    const a = { id: 'o1', asset: 'tree', x: 1, y: 1, z: 0, rotation: 0, scale: 1 };
    const b = { id: 'o2', asset: 'rock', x: 2, y: 2, z: 0, rotation: 0, scale: 1 };
    const c = { id: 'o3', asset: 'rock', x: 3, y: 3, z: 0, rotation: 0, scale: 1 };
    ed.execute(ObjectsCommand.add('Place', ed.doc, [a, b, c]));
    ed.execute(ObjectsCommand.change('Move', ed.doc, ['o2'], (o) => ({ ...o, x: 20 })));
    ed.execute(ObjectsCommand.remove('Delete', ed.doc, ['o1', 'o3']));
    expect(ed.doc.objects.map((o) => o.id)).toEqual(['o2']);
    ed.undo();
    expect(ed.doc.objects.map((o) => [o.id, o.x])).toEqual([['o1', 1], ['o2', 20], ['o3', 3]]);
    ed.undo();
    expect(ed.doc.objects[1].x).toBe(2);
    ed.undo();
    expect(ed.doc.objects).toEqual([]);
    ed.redo();
    ed.redo();
    ed.redo();
    expect(ed.doc.objects.map((o) => o.id)).toEqual(['o2']);
  });

  it('drops a selection whose object an undo took away', () => {
    const ed = new EditorDocument(map());
    ed.execute(ObjectsCommand.add('Place', ed.doc, [{ id: 'o1', asset: 't', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }]));
    ed.select({ kind: 'objects', ids: ['o1'] });
    ed.undo();
    expect(ed.selection).toBeNull();
  });

  it('keeps the history within its limits', () => {
    const ed = new EditorDocument(map(), { steps: 3, bytes: Infinity });
    for (let k = 0; k < 6; k++) ed.execute(SnapshotCommand.record(ed.doc, 'HQ', ['hq'], (d) => (d.hq = { x: k, y: 0 })));
    expect(ed.historySteps).toBe(3);
    while (ed.undo());
    expect(ed.doc.hq.x).toBe(2);
  });

  it('refuses every step while held and leaves the map and the history as they were', () => {
    const ed = new EditorDocument(map());
    stroke(ed, -20, 20);
    const heights = ed.doc.terrain.grid.heights.slice();
    const steps = ed.historySteps;
    const refused: string[] = [];
    ed.onRefused((e) => refused.push(e.message));
    const release = ed.hold('a job runs');
    expect(ed.heldReason).toBe('a job runs');
    // A stroke already written (push) is taken back
    expect(() => stroke(ed, 40, 80)).toThrow(EditorHeldError);
    expect(ed.doc.terrain.grid.heights).toEqual(heights);
    // A step whose edit already ran (record) is taken back, a plain one never lands
    expect(() => ed.execute(SnapshotCommand.record(ed.doc, 'Rename', ['meta'], (d) => (d.meta = { ...d.meta, name: 'X' })))).toThrow(EditorHeldError);
    expect(ed.doc.meta.name).toBe('M');
    expect(() => ed.execute(ObjectsCommand.add('Add', ed.doc, [{ id: 'o', asset: 'tree', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }]))).toThrow(/Add waits: a job runs/);
    expect(ed.doc.objects).toEqual([]);
    expect(ed.undo()).toBe(false);
    expect(ed.jumpTo(0)).toBe(false);
    expect(ed.historySteps).toBe(steps);
    expect(refused).toEqual(['Raise waits: a job runs', 'Rename waits: a job runs', 'Add waits: a job runs']);
    release();
    expect(ed.heldReason).toBeNull();
    expect(ed.undo()).toBe(true);
  });

  it('counts the masks of every water body in a ground snapshot, for the history budget', () => {
    const doc = map(100);
    const plain = SnapshotCommand.record(doc, 'Ground', ['terrain'], () => undefined).bytes;
    const g = doc.terrain.grid;
    doc.terrain.waterBodies = [0, 1, 2].map(() => ({ level: 0, color: '#3070a0', mask: new Uint8Array(g.columns * g.rows) }));
    const withBodies = SnapshotCommand.record(doc, 'Ground', ['terrain'], () => undefined).bytes;
    // Before and after, three masks each
    expect(withBodies - plain).toBe(2 * 3 * g.columns * g.rows);
  });

  it('runs compound commands in order and back', () => {
    const ed = new EditorDocument(map());
    const doc = ed.doc;
    const start = doc.hq.x;
    const first = SnapshotCommand.record(doc, 'a', ['hq'], (d) => (d.hq = { x: 1, y: 0 }));
    const second = SnapshotCommand.record(doc, 'b', ['hq'], (d) => (d.hq = { x: 2, y: 0 }));
    ed.execute(new CompoundCommand('both', [first, second]));
    expect(doc.hq.x).toBe(2);
    ed.undo();
    expect(ed.doc.hq.x).toBe(start);
  });

  it('merges change rects and flags', () => {
    expect(mergeChanges({ heights: { i0: 0, j0: 0, i1: 1, j1: 1 }, objects: ['a'] }, { heights: { i0: 5, j0: -1, i1: 6, j1: 0 }, objects: ['b'] })).toEqual({
      heights: { i0: 0, j0: -1, i1: 6, j1: 1 },
      objects: ['a', 'b'],
    });
  });
});
