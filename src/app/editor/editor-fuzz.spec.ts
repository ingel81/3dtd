/**
 * Undo and redo under random work: a seeded run of strokes, clicks, drags
 * and whole-map edits through the editor's tools and commands, then every
 * undo has to bring back the first map byte for byte and every redo the
 * last one (contentBytes, what the content hash digests). A failure names
 * the seed and the steps, so it can be played again.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../world/custom-map/map-create';
import { contentBytes } from '../world/custom-map/map-file';
import type { CustomMapDocument } from '../world/custom-map/map-document';
import { CatalogIndex, normalizeCatalog } from './catalog/asset-catalog';
import { EditorDocument, SnapshotCommand } from './model/editor-document';
import { heightAt } from './model/grid';
import { detailTarget, increaseDetail } from './ops/detail';
import type { BiomeId } from './ops/landscape/biomes';
import { resizeMap } from './ops/resize';
import type { SymmetryMode } from './ops/symmetry';
import { LandscapeTool } from './tools/landscape-tool';
import { MarkerTool } from './tools/marker-tool';
import { ObjectTool } from './tools/object-tool';
import { PaintTool, paintCommands } from './tools/paint-tool';
import { PathTool } from './tools/path-tool';
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
}

function fuzz(seed: number, count: number): Run {
  const r = rng(seed);
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
    ['restore', 1], ['environment', 1],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  for (let k = 0; k < count; k++) {
    let roll = r() * total;
    const [name] = weights.find(([, w]) => (roll -= w) < 0) ?? weights[0];
    ops[name]();
    editor.select(null);
  }
  return { editor, steps };
}

describe('undo and redo under random work', () => {
  for (const seed of [1, 7, 42]) {
    it(`seed ${seed}: all undos give the first map byte for byte, all redos the last`, () => {
      const start = contentBytes(createMapDocument({ id: 'fuzz', name: 'Fuzz', width: 256, depth: 256, cellSize: 4, seed, ground: 'noise', relief: 6, now: new Date(0) }));
      const { editor, steps } = fuzz(seed, 70);
      const where = `seed ${seed}, steps: ${steps.join(', ')}`;
      expect(editor.historySteps, where).toBeGreaterThan(20);
      const end = contentBytes(editor.doc);
      const recorded = editor.historySteps;
      let undos = 0;
      while (editor.undo()) undos++;
      expect(undos, where).toBe(recorded);
      expect(Buffer.from(contentBytes(editor.doc)).equals(Buffer.from(start)), `undo all, ${where}`).toBe(true);
      while (editor.redo());
      expect(Buffer.from(contentBytes(editor.doc)).equals(Buffer.from(end)), `redo all, ${where}`).toBe(true);
    });
  }
});
