import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../model/grid';
import type { EditorOverlay } from '../view/editor-overlay';
import { LandscapeTool } from '../tools/landscape-tool';
import { MarkerTool } from '../tools/marker-tool';
import { ObjectTool } from '../tools/object-tool';
import { PathTool } from '../tools/path-tool';
import { TerrainTool } from '../tools/terrain-tool';
import { defaultSettings, type ToolContext, type ToolPointer } from '../tools/tool';
import { sameSector, symmetryImages, type SymmetryMode } from './symmetry';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

function setup(mode: SymmetryMode): { ed: EditorDocument; ctx: ToolContext } {
  const ed = new EditorDocument(createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 4, now: new Date(0) }));
  const overlay = { setDraft: () => undefined, setGizmo: () => undefined, setNodesVisible: () => undefined, setRiverHandles: () => undefined, setPreview: () => undefined, transform: { hide: () => undefined, setKind: () => undefined, place: () => undefined, highlight: () => undefined } } as unknown as EditorOverlay;
  const settings = defaultSettings();
  settings.symmetry = mode;
  const ctx: ToolContext = {
    editor: ed,
    settings,
    catalog,
    overlay,
    heightAt: (x, y) => heightAt(ed.doc.terrain, x, y),
    pick: () => null,
    status: () => undefined,
    settingsChanged: () => undefined,
    setBox: () => undefined,
    boxToMap: () => null,
    pickGizmo: () => null,
    metresPerPixel: () => 0.1,
    toScreen: () => null,
    setLasso: () => undefined,
    objectVisible: () => true,
  };
  return { ed, ctx };
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

function raise(ctx: ToolContext, x: number, y: number): void {
  const tool = new TerrainTool();
  tool.pointerDown(at(x, y), ctx);
  for (let k = 0; k < 8; k++) tool.frame(0.1, at(x + k, y), ctx);
  tool.pointerUp();
}

describe('symmetry', () => {
  it('maps points, cells and turns for each mode', () => {
    for (const mode of ['x', 'y', 'xy', 'rot2', 'rot4'] as SymmetryMode[]) {
      for (const img of symmetryImages(mode)) {
        // Cell (53, 40) of a 101 x 101 grid of 4 m cells sits at (12, -40)
        const p = img.point({ x: 12, y: -40 });
        const [i, j] = img.cell(53, 40, 101, 101);
        expect([(i - 50) * 4, (j - 50) * 4]).toEqual([p.x + 0, p.y + 0]);
      }
    }
    expect(symmetryImages('rot4', false)).toHaveLength(2);
    expect(sameSector('x', { x: -5, y: 3 }, { x: -1, y: 0 })).toBe(true);
    expect(sameSector('x', { x: 5, y: 3 }, { x: -1, y: 0 })).toBe(false);
  });

  it('copies a terrain stroke to its mirror image exactly, as one undo step', () => {
    const { ed, ctx } = setup('x');
    raise(ctx, -60, 30);
    const t = ed.doc.terrain;
    expect(heightAt(t, -60, 30)).toBeGreaterThan(1);
    for (const [x, y] of [[-60, 30], [-50, 40], [-70, 22]]) expect(heightAt(t, -x, y)).toBeCloseTo(heightAt(t, x, y), 6);
    expect(ed.historySteps).toBe(1);
    ed.undo();
    expect(heightAt(t, 60, 30)).toBe(0);
  });

  it('turns a stroke four ways on a square map', () => {
    const { ed, ctx } = setup('rot4');
    raise(ctx, 80, 20);
    const t = ed.doc.terrain;
    const h = heightAt(t, 80, 20);
    expect(h).toBeGreaterThan(1);
    expect(heightAt(t, -20, 80)).toBeCloseTo(h, 6);
    expect(heightAt(t, -80, -20)).toBeCloseTo(h, 6);
    expect(heightAt(t, 20, -80)).toBeCloseTo(h, 6);
  });

  it('places objects, spawns and roads at every image', () => {
    const { ed, ctx } = setup('xy');
    const objects = new ObjectTool();
    ctx.settings.objects.asset = 'tree-oak';
    ctx.settings.objects.randomRotation = false;
    objects.pointerDown(at(50, 60), ctx);
    const placed = ed.doc.objects.map((o) => [o.x, o.y].join()).sort();
    expect(placed).toEqual(['-50,-60', '-50,60', '50,-60', '50,60']);
    const markers = new MarkerTool();
    const spawns = ed.doc.spawns.length;
    markers.pointerDown(at(120, 150, { alt: true }), ctx);
    expect(ed.doc.spawns.length).toBe(spawns + 4);
    const paths = new PathTool();
    const edges = ed.doc.paths.edges.length;
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1000);
    paths.pointerDown(at(100, 100, { alt: true }), ctx);
    paths.pointerDown(at(150, 120, { alt: true }), ctx);
    expect(ed.doc.paths.edges.length).toBe(edges + 4);
  });

  it('paints a symmetric biome with mirrored plants', () => {
    const { ed, ctx } = setup('x');
    const tool = new LandscapeTool();
    ctx.settings.landscape.biome = 'forest';
    ctx.settings.landscape.reroll = false;
    ctx.settings.brush = { radius: 30, strength: 1, falloff: 0.5 };
    tool.pointerDown(at(-80, 100), ctx);
    for (let k = 0; k < 20; k++) tool.frame(0.1, at(-80 + k, 100), ctx);
    tool.pointerUp(at(-61, 100), ctx);
    const objs = ed.doc.objects;
    expect(objs.length).toBeGreaterThan(10);
    const keys = new Set(objs.map((o) => `${o.asset}:${o.x.toFixed(2)}:${o.y.toFixed(2)}`));
    for (const o of objs) expect(keys.has(`${o.asset}:${(-o.x).toFixed(2)}:${o.y.toFixed(2)}`)).toBe(true);
    const t = ed.doc.terrain;
    expect(heightAt(t, 70, 104)).toBeCloseTo(heightAt(t, -70, 104), 6);
    expect(ed.historySteps).toBe(1);
  });
});
