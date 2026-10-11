import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex, BUILTIN_CATALOG } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../model/grid';
import type { EditorOverlay } from '../view/editor-overlay';
import { MarkerTool } from './marker-tool';
import { ObjectTool } from './object-tool';
import { PathTool } from './path-tool';
import { TerrainTool } from './terrain-tool';
import { defaultSettings, type ToolContext, type ToolPointer } from './tool';
import { WaterTool } from './water-tool';

function context(editor: EditorDocument): ToolContext & { messages: string[] } {
  const messages: string[] = [];
  const overlay = { setDraft: () => undefined, setGizmo: () => undefined, setNodesVisible: () => undefined } as unknown as EditorOverlay;
  return {
    editor,
    settings: defaultSettings(),
    catalog: new CatalogIndex(BUILTIN_CATALOG),
    overlay,
    messages,
    heightAt: (x, y) => heightAt(editor.doc.terrain, x, y),
    pick: () => null,
    status: (m) => messages.push(m),
    settingsChanged: () => undefined,
    setBox: () => undefined,
    boxToMap: () => null,
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
