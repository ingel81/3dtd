import { createMapDocument } from '../../world/custom-map/map-create';
import { EMPTY_CATALOG } from '../../map-ops/asset-catalog';
import { addNode, connect } from '../../map-ops/path-graph';
import { SnapshotCommand } from '../model/commands/snapshot';
import { EditorDocument } from '../model/editor-document';
import { drawMinimapMarks, minimapBox, MINIMAP_SIZE } from '../workers/minimap-job';
import { EditorCore } from './editor-core';
import { EditorMinimap } from './editor-minimap';

/** The jobs asked for so far have answered */
const settled = () => new Promise((r) => setTimeout(r, 0));

function sample() {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 128, cellSize: 4, starter: false, now: new Date(0) });
  const a = addNode(doc.paths, { x: -80, y: 0 });
  const b = addNode(doc.paths, { x: 80, y: 20 });
  connect(doc.paths, a.id, b.id, 8, 'road');
  doc.paths.edges[0].via = [{ x: 0, y: 10 }];
  doc.spawns = [{ id: 's1', name: 'West', x: -80, y: 0 }];
  doc.hq = { x: 80, y: 20 };
  return doc;
}

describe('EditorMinimap', () => {
  it('draws the marks in the worker when the roads, the markers or the size change, not on other changes', async () => {
    const doc = sample();
    const editor = new EditorDocument(doc);
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    const minimap = new EditorMinimap(core, () => doc);
    const run = vi.spyOn(core, 'run');
    minimap.opened();
    await settled();
    expect(run).toHaveBeenCalledWith('minimap', {});
    editor.execute(SnapshotCommand.record(doc, 'Environment', ['environment'], (d) => (d.environment = { ...d.environment, fogDensity: 0.001 })));
    minimap.changed();
    expect(run).toHaveBeenCalledTimes(1);
    editor.execute(SnapshotCommand.record(doc, 'Spawn', ['spawns'], (d) => (d.spawns = [...d.spawns, { id: 's2', name: 'Mid', x: 0, y: 4 }]), { markers: true }));
    minimap.changed();
    minimap.changed();
    expect(run).toHaveBeenCalledTimes(2);
    doc.terrain.width = 512;
    minimap.changed();
    expect(run).toHaveBeenCalledTimes(3);
    await settled();
    // No OffscreenCanvas in the tests' worker stand-in: no marks, nothing drawn
    expect(minimap.marks()).toBeNull();
    minimap.dispose();
    core.dispose();
  });

  it('lets each bitmap go once a newer one shows, and drops one of the map before', async () => {
    const doc = sample();
    const core = new EditorCore();
    core.open(new EditorDocument(doc), EMPTY_CATALOG);
    const bitmaps = [0, 1, 2, 3].map(() => ({ close: vi.fn() }) as unknown as ImageBitmap);
    let next = 0;
    let release: () => void = () => undefined;
    vi.spyOn(core, 'run').mockImplementation(() => {
      const value = bitmaps[next++];
      return new Promise((resolve) => (release = () => resolve({ value, state: 0, versions: core.versions! } as never)));
    });
    const minimap = new EditorMinimap(core, () => doc);
    minimap.opened();
    release();
    await settled();
    expect(minimap.marks()).toBe(bitmaps[0]);
    doc.terrain.width = 512;
    minimap.changed();
    release();
    await settled();
    expect(minimap.marks()).toBe(bitmaps[1]);
    expect(bitmaps[0].close).toHaveBeenCalled();
    // Another map opens before the job came back: its bitmap is let go unseen
    doc.terrain.width = 256;
    minimap.changed();
    const late = release;
    minimap.opened();
    expect(minimap.marks()).toBeNull();
    expect(bitmaps[1].close).toHaveBeenCalled();
    late();
    await settled();
    expect(bitmaps[2].close).toHaveBeenCalled();
    expect(minimap.marks()).toBeNull();
    minimap.dispose();
    core.dispose();
  });
});

describe('drawMinimapMarks', () => {
  it('draws every road as one path, a dot per spawn and the HQ, inside the map\'s rectangle', () => {
    const doc = sample();
    const calls: [string, number[]][] = [];
    const record = (name: string) => (...args: number[]) => void calls.push([name, args]);
    const c = { beginPath: record('beginPath'), moveTo: record('moveTo'), lineTo: record('lineTo'), stroke: record('stroke'), arc: record('arc'), fill: record('fill'), fillRect: record('fillRect') };
    drawMinimapMarks(c as unknown as CanvasRenderingContext2D, doc);
    const box = minimapBox(256, 128);
    expect(box).toEqual({ x: 0, y: 50, w: MINIMAP_SIZE, h: 100 });
    expect(calls.filter(([n]) => n === 'moveTo').map(([, a]) => a)).toEqual([[box.x + (-80 / 256 + 0.5) * box.w, box.y + 0.5 * box.h]]);
    expect(calls.filter(([n]) => n === 'lineTo')).toHaveLength(2);
    expect(calls.filter(([n]) => n === 'stroke')).toHaveLength(1);
    expect(calls.filter(([n]) => n === 'arc')).toHaveLength(1);
    expect(calls.find(([n]) => n === 'fillRect')![1]).toEqual([box.x + (80 / 256 + 0.5) * box.w - 4, box.y + (0.5 - 20 / 128) * box.h - 4, 8, 8]);
  });
});
