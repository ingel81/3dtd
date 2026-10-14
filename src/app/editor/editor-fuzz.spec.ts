/**
 * Undo and redo under random work: a seeded run of strokes, clicks, drags
 * and whole-map edits through the editor's tools and commands, then every
 * undo has to bring back the first map byte for byte and every redo the
 * last one (contentBytes, what the content hash digests), and every state
 * passed on the way, by undo, redo or a jump through the history, has to be
 * the map as it was when that step was done. A failure names the seed and
 * the steps, so it can be played again.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../world/custom-map/map-create';
import { contentBytes } from '../world/custom-map/map-file';
import type { CustomMapDocument } from '../world/custom-map/map-document';
import { CatalogIndex, normalizeCatalog } from './catalog/asset-catalog';
import { EditorDocument, ObjectsCommand, SnapshotCommand } from './model/editor-document';
import { alignedToSlope, variedTint } from './ops/object-ops';
import { mirrorMap } from './ops/mirror-map';
import { decodePng, encodePng16, gridToImage, imageToHeights } from './ops/heightmap';
import { LandscapeStroke } from './ops/landscape/landscape-stroke';
import { heightAt } from './model/grid';
import { detailTarget, increaseDetail } from './ops/detail';
import type { BiomeId } from './ops/landscape/biomes';
import { resizeMap } from './ops/resize';
import type { SymmetryMode } from './ops/symmetry';
import { LandscapeTool } from './tools/landscape-tool';
import { MarkerTool } from './tools/marker-tool';
import { ObjectTool } from './tools/object-tool';
import { PaintTool, paintCommands } from './tools/paint-tool';
import { PathTool, editRoads, setRoads } from './tools/path-tool';
import { smoothEdge } from './ops/path-graph';
import { StampTool } from './tools/stamp-tool';
import { TerrainTool } from './tools/terrain-tool';
import { defaultSettings, type EditorTool, type LandscapeMode, type TerrainMode, type ToolContext, type ToolPointer } from './tools/tool';
import { WaterTool } from './tools/water-tool';
import type { EditorOverlay } from './view/editor-overlay';
import type { GizmoHandle } from './view/transform-gizmo';

/** A building of the catalogue, blocks building and sight */
const HOUSE = 'house';

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

/** mulberry32: the same seed, the same run */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An overlay that takes every call and draws nothing */
const overlay: EditorOverlay = new Proxy({} as EditorOverlay, {
  get: (_t, key) => (key === 'transform' ? overlay : () => undefined),
});

function context(editor: EditorDocument): ToolContext & { gizmo: GizmoHandle | null } {
  const ctx = {
    editor,
    settings: defaultSettings(),
    catalog,
    overlay,
    gizmo: null as GizmoHandle | null,
    heightAt: (x: number, y: number) => heightAt(editor.doc.terrain, x, y),
    pick: () => null,
    status: () => undefined,
    settingsChanged: () => undefined,
    setBox: () => undefined,
    boxToMap: () => null,
    pickGizmo: () => ctx.gizmo,
    metresPerPixel: () => 0.1,
    // The screen is the map from above, 1 px = 1 m
    toScreen: (x: number, y: number) => ({ x, y }),
    setLasso: () => undefined,
    objectVisible: () => true,
  };
  return ctx;
}

const at = (x: number, y: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({
  hit: { x, y, z: 0 },
  clientX: x,
  clientY: -y,
  button: 0,
  shift: false,
  ctrl: false,
  alt: false,
  ...extra,
});

const key = (k: string, mods: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, ...mods });

/** A held stroke along points: down, a frame and a move at each, up */
function drag(tool: EditorTool, ctx: ToolContext, points: readonly [number, number][], extra: Partial<ToolPointer> = {}): void {
  const [x0, y0] = points[0];
  tool.pointerDown?.(at(x0, y0, extra), ctx);
  for (const [x, y] of points) {
    tool.pointerMove?.(at(x, y, extra), ctx);
    tool.frame?.(1 / 20, at(x, y, extra), ctx);
  }
  const [x1, y1] = points[points.length - 1];
  tool.pointerUp?.(at(x1, y1, extra), ctx);
}

interface Run {
  editor: EditorDocument;
  steps: string[];
  states: Map<number, { bytes: Uint8Array; step: string }>;
}

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

function fuzz(seed: number, count: number): Run {
  const r = rng(seed);
  /** The map's bytes at each state the run reached, to hold every undo and redo against */
  const states = new Map<number, { bytes: Uint8Array; step: string }>();
  const doc = createMapDocument({ id: 'fuzz', name: 'Fuzz', width: 256, depth: 256, cellSize: 4, seed, ground: 'noise', relief: 6, now: new Date(0) });
  const editor = new EditorDocument(doc);
  const ctx = context(editor);
  const tools = {
    terrain: new TerrainTool(),
    paint: new PaintTool(),
    water: new WaterTool(),
    objects: new ObjectTool(),
    paths: new PathTool(),
    markers: new MarkerTool(),
    landscape: new LandscapeTool(),
    stamp: new StampTool(),
  };
  const steps: string[] = [];
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const span = () => editor.doc.terrain.width / 2 - 8;
  const point = (): [number, number] => [Math.round((r() * 2 - 1) * span()), Math.round((r() * 2 - 1) * span())];
  const path = (n = 4): [number, number][] => {
    const out: [number, number][] = [point()];
    for (let k = 1; k < n; k++) {
      const [x, y] = out[k - 1];
      out.push([Math.max(-span(), Math.min(span(), x + Math.round((r() - 0.5) * 40))), Math.max(-span(), Math.min(span(), y + Math.round((r() - 0.5) * 40)))]);
    }
    return out;
  };
  const objectIds = () => editor.doc.objects.map((o) => o.id);
  const someObjects = () => {
    const ids = objectIds();
    return ids.filter(() => r() < 0.3).slice(0, 12);
  };
  /** A saved state to put back, as Restore does */
  const kept: CustomMapDocument[] = [];

  const ops: Record<string, () => void> = {
    terrain: () => {
      ctx.settings.terrain.mode = pick<TerrainMode>(['raise', 'lower', 'smooth', 'flatten', 'level', 'noise', 'erode', 'terrace', 'plateau']);
      ctx.settings.brush.radius = 6 + Math.round(r() * 20);
      drag(tools.terrain, ctx, path(), { shift: r() < 0.2 });
      steps.push(`terrain ${ctx.settings.terrain.mode}`);
    },
    paint: () => {
      if (editor.doc.terrain.layers.length < 3 && r() < 0.5) {
        editor.execute(paintCommands.addLayer(editor, pick(['dirt', 'rock', 'sand', 'gravel'])));
        steps.push('add layer');
        return;
      }
      ctx.settings.paint.layer = Math.floor(r() * editor.doc.terrain.layers.length);
      ctx.settings.paint.erase = r() < 0.2;
      drag(tools.paint, ctx, path());
      steps.push(`paint ${ctx.settings.paint.layer}`);
    },
    water: () => {
      ctx.settings.water.mode = pick(['fill', 'lake', 'paint', 'erase'] as const);
      if (ctx.settings.water.mode === 'fill') {
        const [x, y] = point();
        tools.water.pointerDown(at(x, y, { ctrl: r() < 0.5 }), ctx);
        tools.water.pointerUp(at(x, y), ctx);
      } else drag(tools.water, ctx, path());
      steps.push(`water ${ctx.settings.water.mode}`);
    },
    place: () => {
      const o = ctx.settings.objects;
      o.mode = 'place';
      o.asset = pick(['tree-oak', 'rock-large', 'bush', HOUSE, 'mushrooms-red']);
      const [x, y] = point();
      tools.objects.pointerDown(at(x, y), ctx);
      tools.objects.pointerUp(at(x, y), ctx);
      steps.push(`place ${o.asset}`);
    },
    scatter: () => {
      const o = ctx.settings.objects;
      o.mode = 'scatter';
      o.scatter.assets = ['tree-oak', 'bush', 'rock-large'].filter(() => r() < 0.7);
      if (!o.scatter.assets.length) o.scatter.assets = ['bush'];
      ctx.settings.brush.radius = 10 + Math.round(r() * 15);
      const thin = r() < 0.3;
      drag(tools.objects, ctx, path(6), { shift: thin });
      steps.push(thin ? 'scatter thin out' : 'scatter');
    },
    eraseObjects: () => {
      ctx.settings.objects.mode = 'erase';
      drag(tools.objects, ctx, path(3));
      steps.push('erase objects');
    },
    gizmo: () => {
      const ids = someObjects();
      if (!ids.length) return;
      ctx.settings.objects.mode = 'select';
      editor.select({ kind: 'objects', ids });
      const handle = pick<GizmoHandle>(['x', 'y', 'z', 'free', 'ring', 'scale']);
      ctx.gizmo = handle;
      ctx.settings.objects.gizmo = handle === 'ring' ? 'rotate' : handle === 'scale' ? 'scale' : 'move';
      const o = editor.doc.objects.find((q) => q.id === ids[0])!;
      const [dx, dy] = [Math.round((r() - 0.5) * 30), Math.round((r() - 0.5) * 30)];
      drag(tools.objects, ctx, [[o.x, o.y], [o.x + dx / 2, o.y + dy / 2], [o.x + dx, o.y + dy]], { ctrl: r() < 0.3 });
      ctx.gizmo = null;
      steps.push(`gizmo ${handle} on ${ids.length}`);
    },
    objectKeys: () => {
      const ids = someObjects();
      if (!ids.length) return;
      ctx.settings.objects.mode = 'select';
      editor.select({ kind: 'objects', ids });
      const k = pick(['Delete', 'd', 'g', 'G', 'End']);
      tools.objects.key(key(k, { ctrlKey: k !== 'Delete' && k !== 'End', shiftKey: k === 'G' }), ctx);
      steps.push(`key ${k} on ${ids.length}`);
    },
    road: () => {
      ctx.settings.paths.mode = 'draw';
      const pts = path(3);
      for (const [x, y] of pts) {
        tools.paths.pointerDown(at(x, y), ctx);
        tools.paths.pointerUp(at(x, y), ctx);
      }
      tools.paths.key(key('Enter'), ctx);
      steps.push('road');
    },
    marker: () => {
      ctx.settings.markers.mode = r() < 0.7 ? 'spawn' : 'hq';
      const [x, y] = point();
      tools.markers.pointerDown(at(x, y, { alt: r() < 0.5 }), ctx);
      tools.markers.pointerUp(at(x, y), ctx);
      steps.push(`marker ${ctx.settings.markers.mode}`);
    },
    landscape: () => {
      const s = ctx.settings.landscape;
      s.mode = pick<LandscapeMode>(['biome', 'biome', 'mountain', 'valley', 'crater', 'erode', 'river', 'road', 'cliff']);
      s.biome = pick<BiomeId>(['forest', 'meadow', 'swamp', 'desert', 'city', 'hell']);
      s.seed = Math.floor(r() * 1e6);
      ctx.settings.brush.radius = 15 + Math.round(r() * 25);
      drag(tools.landscape, ctx, path(s.mode === 'river' || s.mode === 'road' || s.mode === 'cliff' ? 6 : 3));
      steps.push(`landscape ${s.mode}${s.mode === 'biome' ? ` ${s.biome}` : ''}`);
    },
    stamp: () => {
      const s = ctx.settings.stamp;
      s.mode = 'select';
      const [x, y] = point();
      drag(tools.stamp, ctx, [[x, y], [x + 30, y + 24]]);
      tools.stamp.key(key('c', { ctrlKey: true }), ctx);
      if (!s.current) return;
      s.mode = 'paste';
      s.rotation = pick([0, Math.PI / 2, Math.PI, Math.PI / 12]);
      const [px, py] = point();
      tools.stamp.pointerDown(at(px, py), ctx);
      tools.stamp.pointerUp(at(px, py), ctx);
      s.mode = 'select';
      steps.push('stamp');
    },
    symmetry: () => {
      ctx.settings.symmetry = pick<SymmetryMode>(['none', 'none', 'x', 'y', 'xy', 'rot2', 'rot4']);
      steps.push(`symmetry ${ctx.settings.symmetry}`);
    },
    resize: () => {
      const t = editor.doc.terrain;
      const w = pick([192, 256, 320]);
      const d = pick([192, 256, 320]);
      if (w === t.width && d === t.depth) return;
      editor.execute(SnapshotCommand.record(editor.doc, 'Resize map', ['terrain', 'objects', 'paths', 'spawns', 'hq'], (m) => void resizeMap(m, w, d)));
      steps.push(`resize ${w} x ${d}`);
    },
    detail: () => {
      const target = detailTarget(editor.doc.terrain);
      if (!target) return;
      editor.execute(SnapshotCommand.record(editor.doc, 'Increase detail', ['terrain'], (m) => (m.terrain = increaseDetail(m.terrain, target))));
      steps.push('increase detail');
    },
    keep: () => {
      kept.push(structuredClone(editor.doc));
      steps.push('keep a version');
    },
    restore: () => {
      if (!kept.length) return;
      const from = pick(kept);
      const parts = ['terrain', 'objects', 'paths', 'spawns', 'hq', 'environment', 'gameplay'] as const;
      editor.execute(
        SnapshotCommand.record(editor.doc, 'Restore version', parts, (m) => {
          for (const k of parts) (m as unknown as Record<string, unknown>)[k] = structuredClone(from[k]);
        }),
      );
      steps.push('restore a version');
    },
    tint: () => {
      const ids = someObjects();
      if (!ids.length) return;
      const base = r() < 0.5 ? null : pick(['#a08060', '#6080a0', '#ffffff']);
      editor.execute(ObjectsCommand.change('Random tint', editor.doc, ids, (o) => ({ ...o, tint: variedTint(base, 0.6, r) ?? '#ffffff' })));
      steps.push(`tint ${ids.length}`);
    },
    align: () => {
      const ids = someObjects();
      if (!ids.length) return;
      const t = editor.doc.terrain;
      editor.execute(ObjectsCommand.change('Align to slope', editor.doc, ids, (o) => alignedToSlope(t, o, 2)));
      steps.push(`align ${ids.length}`);
    },
    placeAligned: () => {
      const o = ctx.settings.objects;
      o.mode = 'place';
      o.asset = pick(['rock-large', HOUSE]);
      o.alignToSlope = true;
      const [x, y] = point();
      tools.objects.pointerDown(at(x, y), ctx);
      tools.objects.pointerUp(at(x, y), ctx);
      o.alignToSlope = false;
      steps.push('place aligned');
    },
    line: () => {
      const o = ctx.settings.objects;
      o.mode = 'line';
      o.asset = pick(['fence-wood', 'torch', 'tree-oak']);
      o.line = { spacing: 3 + Math.round(r() * 6), offset: Math.round((r() - 0.5) * 16), bothSides: r() < 0.5, turn: pick(['along', 'across', 'random'] as const), follow: r() < 0.5 ? 'free' : 'roads' };
      if (o.line.follow === 'roads') {
        const [x, y] = point();
        tools.objects.pointerDown(at(x, y), ctx);
        tools.objects.pointerUp(at(x, y), ctx);
      } else drag(tools.objects, ctx, path(5));
      steps.push(`line ${o.line.follow}`);
    },
    cliffRocks: () => {
      ctx.settings.landscape.mode = 'cliffRocks';
      ctx.settings.landscape.seed = Math.floor(r() * 1e6);
      ctx.settings.brush.radius = 20 + Math.round(r() * 20);
      drag(tools.landscape, ctx, path(3));
      steps.push('cliff rocks');
    },
    mirror: () => {
      const mode = pick<SymmetryMode>(['x', 'y', 'xy', 'rot2']);
      const from = { x: (r() - 0.5) * 100, y: (r() - 0.5) * 100 };
      editor.execute(SnapshotCommand.record(editor.doc, 'Mirror the map', ['terrain', 'objects', 'paths', 'spawns'], (d) => void mirrorMap(d, mode, from)));
      steps.push(`mirror ${mode}`);
    },
    heightmap: () => {
      const t = editor.doc.terrain;
      const { image, low, high } = gridToImage(t.grid);
      const back = decodePng(encodePng16({ ...image, values: image.values.map((v, k) => Math.min(1, v * 0.8 + 0.1 * Math.sin(k))) }));
      const stroke = new LandscapeStroke(editor, 'Import heightmap', 1, catalog);
      const all = { i0: 0, j0: 0, i1: t.grid.columns - 1, j1: t.grid.rows - 1 };
      stroke.touchHeights(all);
      t.grid.heights.set(imageToHeights(back, t.grid.columns, t.grid.rows, low, high + 5));
      stroke.changed({ heights: all });
      stroke.finish();
      steps.push('heightmap');
    },
    roadEdit: () => {
      const paths = editor.doc.paths;
      if (!paths.nodes.length) return;
      ctx.settings.paths.mode = 'edit';
      const n = pick(paths.nodes);
      const [dx, dy] = [Math.round((r() - 0.5) * 40), Math.round((r() - 0.5) * 40)];
      const kind = r();
      if (kind < 0.5) {
        ctx.pick = () => ({ kind: 'node', id: n.id });
        drag(tools.paths, ctx, [[n.x, n.y], [n.x + dx / 2, n.y + dy / 2], [n.x + dx, n.y + dy]]);
        ctx.pick = () => null;
        steps.push('drag node');
      } else if (kind < 0.75 && paths.edges.length) {
        const e = pick(paths.edges);
        editRoads(editor, catalog, 'Smooth road', (p) => smoothEdge(p, e.id));
        steps.push('smooth road');
      } else if (paths.edges.length) {
        setRoads(editor, catalog, [pick(paths.edges).id], { width: 4 + Math.round(r() * 12) });
        steps.push('road width');
      }
    },
    roadBox: () => {
      ctx.settings.paths.mode = 'edit';
      const [x, y] = point();
      tools.paths.pointerDown(at(x, y, { clientX: x, clientY: y }), ctx);
      tools.paths.pointerMove!(at(x + 60, y - 60, { clientX: x + 60, clientY: y - 60 }), ctx);
      tools.paths.pointerUp(at(x + 60, y - 60, { clientX: x + 60, clientY: y - 60 }), ctx);
      const sel = editor.selection;
      if (sel?.kind === 'paths' && sel.nodes.length) {
        const n = editor.doc.paths.nodes.find((q) => q.id === sel.nodes[0])!;
        ctx.pick = () => ({ kind: 'node', id: n.id });
        drag(tools.paths, ctx, [[n.x, n.y], [n.x + 10, n.y + 5]]);
        ctx.pick = () => null;
        steps.push(`move ${sel.nodes.length} nodes`);
      } else steps.push('box nothing');
    },
    river: () => {
      const rivers = editor.doc.terrain.rivers ?? [];
      if (!rivers.length) return;
      const k = Math.floor(r() * rivers.length);
      const river = rivers[k];
      const q = Math.floor(r() * river.points.length);
      ctx.settings.water.mode = 'river';
      const p = river.points[q];
      drag(tools.water, ctx, [[p.x, p.y], [p.x + (r() - 0.5) * 20, p.y + (r() - 0.5) * 20]]);
      steps.push('move river point');
    },
    jump: () => {
      const n = editor.historySteps;
      if (n < 3) return;
      const to = Math.floor(r() * n);
      // Every undo on the way has to give the map as it was then
      while (editor.historySteps > to) {
        const label = editor.undoLabel;
        editor.undo();
        const want = states.get(editor.stateId);
        if (want && !same(contentBytes(editor.doc), want.bytes)) throw new Error(`seed ${seed}: undo of ${label} does not give the map of step ${want.step}`);
      }
      steps.push(`jump to ${to}`);
    },
    environment: () => {
      editor.execute(
        SnapshotCommand.record(editor.doc, 'Environment', ['environment'], (m) => {
          m.environment = { ...m.environment, sunAzimuth: Math.round(r() * 360), fogDensity: r() * 0.002, weather: pick(['clear', 'rain', 'snow', 'fog'] as const) };
        }),
      );
      steps.push('environment');
    },
  };
  const weights: [string, number][] = [
    ['terrain', 5], ['paint', 3], ['water', 3], ['place', 4], ['scatter', 3], ['eraseObjects', 2], ['gizmo', 4], ['objectKeys', 3],
    ['road', 2], ['marker', 2], ['landscape', 4], ['stamp', 2], ['symmetry', 1], ['resize', 1], ['detail', 1], ['keep', 1],
    ['restore', 1], ['environment', 1], ['tint', 2], ['align', 1], ['placeAligned', 1], ['line', 2], ['cliffRocks', 2], ['mirror', 1],
    ['heightmap', 1], ['roadEdit', 3], ['roadBox', 1], ['river', 2], ['jump', 1],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  for (let k = 0; k < count; k++) {
    let roll = r() * total;
    const [name] = weights.find(([, w]) => (roll -= w) < 0) ?? weights[0];
    ops[name]();
    editor.select(null);
    states.set(editor.stateId, { bytes: contentBytes(editor.doc), step: `${k} ${steps.at(-1)}` });
  }
  return { editor, steps, states };
}

describe('undo and redo under random work', () => {
  for (const seed of [1, 7, 42, 99, 2026]) {
    it(`seed ${seed}: all undos give the first map byte for byte, all redos the last`, () => {
      const start = contentBytes(createMapDocument({ id: 'fuzz', name: 'Fuzz', width: 256, depth: 256, cellSize: 4, seed, ground: 'noise', relief: 6, now: new Date(0) }));
      const { editor, steps, states } = fuzz(seed, 90);
      const where = `seed ${seed}, steps: ${steps.join(', ')}`;
      expect(editor.historySteps, where).toBeGreaterThan(20);
      const end = contentBytes(editor.doc);
      const recorded = editor.historySteps;
      let undos = 0;
      while (editor.undo()) {
        undos++;
        const want = states.get(editor.stateId);
        if (want) expect(same(contentBytes(editor.doc), want.bytes), `undo to step ${want.step}, ${where}`).toBe(true);
      }
      expect(undos, where).toBe(recorded);
      expect(same(contentBytes(editor.doc), start), `undo all, ${where}`).toBe(true);
      // Every redo on the way gives the map as it was when the step was done
      while (editor.redo()) {
        const want = states.get(editor.stateId);
        if (want) expect(same(contentBytes(editor.doc), want.bytes), `redo to step ${want.step}, ${where}`).toBe(true);
      }
      expect(same(contentBytes(editor.doc), end), `redo all, ${where}`).toBe(true);
    });
  }
});
