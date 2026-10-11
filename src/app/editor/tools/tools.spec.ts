import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../model/grid';
import type { EditorOverlay } from '../view/editor-overlay';
import { freeGroup, withGroups } from '../ops/object-ops';
import { MarkerTool } from './marker-tool';
import { ObjectTool, insidePolygon } from './object-tool';
import { paintCommands } from './paint-tool';
import { PathTool } from './path-tool';
import { TerrainTool } from './terrain-tool';
import { defaultSettings, type ToolContext, type ToolPointer } from './tool';
import { WaterTool, waterCommands } from './water-tool';

function context(editor: EditorDocument): ToolContext & { messages: string[] } {
  const messages: string[] = [];
  const overlay = { setDraft: () => undefined, setGizmo: () => undefined, setNodesVisible: () => undefined, transform: { hide: () => undefined, setKind: () => undefined, place: () => undefined, highlight: () => undefined } } as unknown as EditorOverlay;
  return {
    editor,
    settings: defaultSettings(),
    catalog: new CatalogIndex({ materials: [], objects: [] }),
    overlay,
    messages,
    heightAt: (x, y) => heightAt(editor.doc.terrain, x, y),
    pick: () => null,
    status: (m) => messages.push(m),
    settingsChanged: () => undefined,
    setBox: () => undefined,
    boxToMap: () => null,
    pickGizmo: () => null,
    metresPerPixel: () => 0.1,
    toScreen: () => null,
    setLasso: () => undefined,
    objectVisible: () => true,
  };
}

const at = (x: number, y: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({
  hit: { x, y, z: 0 },
  clientX: 0,
  clientY: 0,
  button: 0,
  shift: false,
  ctrl: false,
  alt: false,
  ...extra,
});

function fresh(): EditorDocument {
  return new EditorDocument(createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 4 }));
}

describe('editor tools', () => {
  it('a held terrain brush is one undo step', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new TerrainTool();
    tool.pointerDown(at(0, 0), ctx);
    for (let k = 0; k < 10; k++) tool.frame(1 / 30, at(k, 0), ctx);
    tool.pointerUp();
    expect(heightAt(ed.doc.terrain, 4, 0)).toBeGreaterThan(1);
    expect(ed.historySteps).toBe(1);
    ed.undo();
    expect(heightAt(ed.doc.terrain, 4, 0)).toBe(0);
  });

  it('a ramp takes two clicks', () => {
    const ed = fresh();
    const ctx = context(ed);
    ctx.settings.terrain.mode = 'ramp';
    const tool = new TerrainTool();
    tool.pointerDown(at(-50, 0, { hit: { x: -50, y: 0, z: 0 } }), ctx);
    tool.pointerDown(at(50, 0, { hit: { x: 50, y: 0, z: 10 } }), ctx);
    expect(heightAt(ed.doc.terrain, 0, 0)).toBeCloseTo(5, 0);
    expect(ed.historySteps).toBe(1);
  });

  it('places, scatters and deletes objects', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new ObjectTool();
    ctx.settings.objects.asset = 'tree-oak';
    tool.pointerDown(at(10, 10), ctx);
    expect(ed.doc.objects).toHaveLength(1);
    ctx.settings.objects.mode = 'scatter';
    tool.pointerDown(at(-60, -60), ctx);
    for (let k = 0; k < 30; k++) tool.frame?.(0.1, at(-60, -60), ctx);
    tool.pointerUp(at(-60, -60), ctx);
    const scattered = ed.doc.objects.length - 1;
    expect(scattered).toBeGreaterThan(0);
    ed.undo();
    expect(ed.doc.objects).toHaveLength(1);
    ed.select({ kind: 'objects', ids: [ed.doc.objects[0].id] });
    tool.key(new KeyboardEvent('keydown', { key: 'Delete' }), ctx);
    expect(ed.doc.objects).toHaveLength(0);
  });

  it('selects by lasso on the screen, moves along an arrow and lifts with the blue one', () => {
    const ed = fresh();
    const ctx = context(ed);
    // The screen is the map seen from above, 1 px = 1 m
    ctx.toScreen = (x, y) => ({ x, y });
    const tool = new ObjectTool();
    ctx.settings.objects.asset = 'tree-oak';
    ctx.settings.objects.randomRotation = false;
    for (const [x, y] of [[10, 10], [20, 12], [80, 80]]) tool.pointerDown(at(x, y), ctx);
    ctx.settings.objects.mode = 'select';
    // A lasso around the first two
    tool.pointerDown(at(0, 0, { alt: true, clientX: 0, clientY: 0 }), ctx);
    for (const [x, y] of [[40, 0], [40, 30], [0, 30]]) tool.pointerMove!(at(x, y, { clientX: x, clientY: y }), ctx);
    tool.pointerUp(at(0, 30, { clientX: 0, clientY: 30 }), ctx);
    const sel = ed.selection;
    expect(sel?.kind === 'objects' && sel.ids.length).toBe(2);
    // The x arrow: a diagonal drag moves only along x
    ctx.pickGizmo = () => 'x';
    tool.pointerDown(at(15, 11, { clientY: 100 }), ctx);
    tool.pointerMove!(at(25, 31, { clientY: 100 }), ctx);
    tool.pointerUp(at(25, 31, { clientY: 100 }), ctx);
    expect(ed.doc.objects.slice(0, 2).map((o) => [o.x, o.y])).toEqual([[20, 10], [30, 12]]);
    // The blue arrow lifts by the pointer's rise on screen (0.1 m per pixel here)
    ctx.pickGizmo = () => 'z';
    tool.pointerDown(at(15, 11, { clientY: 100 }), ctx);
    tool.pointerMove!({ ...at(0, 0, { clientY: 60 }), hit: null }, ctx);
    tool.pointerUp({ ...at(0, 0, { clientY: 60 }), hit: null }, ctx);
    expect(ed.doc.objects[0].z).toBeCloseTo(4);
    // End drops the selection back onto the ground
    tool.key(new KeyboardEvent('keydown', { key: 'End' }), ctx);
    expect(ed.doc.objects[0].z).toBe(0);
    expect(insidePolygon({ x: 3, y: 3 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(true);
    expect(insidePolygon({ x: 9, y: 9 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
  });

  it('groups objects so a click takes them all, Ctrl click one alone', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new ObjectTool();
    ctx.settings.objects.asset = 'tree-oak';
    for (const [x, y] of [[10, 10], [20, 12], [80, 80]]) tool.pointerDown(at(x, y), ctx);
    const [a, b, c] = ed.doc.objects.map((o) => o.id);
    ctx.settings.objects.mode = 'select';
    ed.select({ kind: 'objects', ids: [a, b] });
    tool.key(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true }), ctx);
    expect(ed.doc.objects.map((o) => o.group)).toEqual(['g1', 'g1', undefined]);
    ed.select(null);
    ctx.pick = () => ({ kind: 'object', id: b });
    tool.pointerDown(at(20, 12), ctx);
    tool.pointerUp(at(20, 12), ctx);
    expect(ed.selection).toEqual({ kind: 'objects', ids: [b, a] });
    ed.select(null);
    tool.pointerDown(at(20, 12, { ctrl: true }), ctx);
    tool.pointerUp(at(20, 12, { ctrl: true }), ctx);
    expect(ed.selection).toEqual({ kind: 'objects', ids: [b] });
    ed.select({ kind: 'objects', ids: [a, b] });
    tool.key(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true }), ctx);
    expect(ed.doc.objects.some((o) => o.group)).toBe(false);
    expect(freeGroup([{ ...ed.doc.objects[0], group: 'g7' }])).toBe('g8');
    expect(withGroups(ed.doc.objects, [c])).toEqual([c]);
  });

  it('draws a road off the starter road with a junction', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new PathTool();
    const edges = ed.doc.paths.edges.length;
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    tool.pointerDown(at(0, 2), ctx);
    tool.pointerDown(at(0, 80), ctx);
    tool.pointerDown(at(60, 140), ctx);
    tool.key(new KeyboardEvent('keydown', { key: 'Enter' }), ctx);
    // The starter road split in two, plus two new edges
    expect(ed.doc.paths.edges.length).toBe(edges + 3);
    expect(ed.doc.paths.nodes.some((n) => ed.doc.paths.edges.filter((e) => e.a === n.id || e.b === n.id).length === 3)).toBe(true);
  });

  it('a lone first road click is taken back on Esc', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new PathTool();
    const nodes = ed.doc.paths.nodes.length;
    tool.pointerDown(at(0, 150), ctx);
    expect(ed.doc.paths.nodes.length).toBe(nodes + 1);
    tool.cancel(ctx);
    expect(ed.doc.paths.nodes.length).toBe(nodes);
  });

  it('adds a spawn snapped onto the road and moves the HQ', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new MarkerTool();
    tool.pointerDown(at(-20, 6), ctx);
    expect(ed.doc.spawns.at(-1)).toMatchObject({ x: -20, y: 0 });
    ctx.settings.markers.mode = 'hq';
    tool.pointerDown(at(30, 3, { alt: true }), ctx);
    expect(ed.doc.hq).toEqual({ x: 30, y: 3 });
  });

  it('fills a hollow to its rim as one step', () => {
    const ed = fresh();
    const ctx = context(ed);
    const terrain = new TerrainTool();
    ctx.settings.terrain.mode = 'lower';
    ctx.settings.brush = { radius: 30, strength: 1, falloff: 0.3 };
    terrain.pointerDown(at(0, 100), ctx);
    for (let k = 0; k < 10; k++) terrain.frame(0.1, at(0, 100), ctx);
    terrain.pointerUp();
    const water = new WaterTool();
    water.pointerDown(at(0, 100), ctx);
    expect(ed.doc.terrain.water).not.toBeNull();
    expect(ed.doc.terrain.water!.level).toBeLessThan(0);
    expect(ed.doc.terrain.water!.mask.some((v) => v > 0)).toBe(true);
    ed.undo();
    expect(ed.doc.terrain.water).toBeNull();
  });
});

describe('ground layer commands', () => {
  it('change layers in place and undo them', () => {
    const ed = fresh();
    const terrain = ed.doc.terrain;
    const maps = terrain.splat.maps[0];
    ed.execute(paintCommands.addLayer(ed, 'dirt'));
    ed.execute(paintCommands.autoPaint(ed));
    ed.execute(paintCommands.moveLayer(ed, 1, 0));
    expect(ed.doc.terrain).toBe(terrain);
    expect(ed.doc.terrain.splat.maps[0]).toBe(maps);
    expect(terrain.layers.map((l) => l.material)).toEqual(['dirt', 'grass']);
    ed.undo();
    ed.undo();
    ed.undo();
    expect(terrain.layers.map((l) => l.material)).toEqual(['grass']);
    expect(maps[0]).toBe(255);
  });
});

describe('water and lava bodies', () => {
  it('adds a lava body, fills a hollow with it at its rim, digs a lake into it, undoes', () => {
    const ed = fresh();
    const ctx = context(ed);
    const t = ed.doc.terrain;
    // A hollow at (0, 100)
    const terrain = new TerrainTool();
    ctx.settings.terrain.mode = 'lower';
    ctx.settings.brush = { radius: 30, strength: 1, falloff: 0.3 };
    terrain.pointerDown(at(0, 100), ctx);
    for (let k = 0; k < 10; k++) terrain.frame(0.1, at(0, 100), ctx);
    terrain.pointerUp();
    ed.execute(waterCommands.addBody(ed, 'lava', 0));
    expect(t.waterBodies?.[0].kind).toBe('lava');
    ctx.settings.water = { mode: 'fill', body: 0, depth: 3 };
    const water = new WaterTool();
    water.pointerDown(at(0, 100), ctx);
    const lava = ed.doc.terrain.waterBodies![0];
    expect(lava.level).toBeLessThan(0);
    expect(lava.mask.some((v) => v > 0)).toBe(true);
    expect(ed.doc.terrain.water).toBeNull();
    // Dig a lake somewhere else into the same body
    ctx.settings.water.mode = 'lake';
    water.pointerDown(at(-100, -100), ctx);
    for (let k = 0; k < 20; k++) water.frame!(0.1, at(-100, -100), ctx);
    water.pointerUp();
    expect(heightAt(ed.doc.terrain, -100, -100)).toBeLessThan(lava.level - 1);
    const steps = ed.historySteps;
    ed.undo();
    expect(heightAt(ed.doc.terrain, -100, -100)).toBe(0);
    expect(ed.historySteps).toBe(steps - 1);
  });

  it('floods a sea in from the edge below the level', () => {
    const ed = fresh();
    ed.doc.terrain.grid.heights.fill(-1);
    ed.doc.terrain.grid.heights[(ed.doc.terrain.grid.rows >> 1) * ed.doc.terrain.grid.columns + (ed.doc.terrain.grid.columns >> 1)] = 5;
    ed.execute(waterCommands.enable(ed, 0));
    ed.execute(waterCommands.sea(ed, -1));
    const mask = ed.doc.terrain.water!.mask;
    expect(mask.filter((v) => v > 0).length).toBe(mask.length - 1);
  });
});
