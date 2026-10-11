import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { medianMs, perfBudget } from '../../test/perf-budget';
import { createMapDocument } from '../world/custom-map/map-create';
import { CatalogIndex, normalizeCatalog } from './catalog/asset-catalog';
import { EditorDocument } from './model/editor-document';
import { heightAt } from './model/grid';
import { LandscapeTool } from './tools/landscape-tool';
import { PaintTool } from './tools/paint-tool';
import { TerrainTool } from './tools/terrain-tool';
import { defaultSettings, type EditorTool, type ToolContext, type ToolPointer } from './tools/tool';
import { WaterTool } from './tools/water-tool';
import type { EditorOverlay } from './view/editor-overlay';

/**
 * What one brush step costs on maps of 256, 512 and 1024 height samples a
 * side, the tool's frame as the viewport calls it (dab, patch recording,
 * change notice), a 32 m brush moving across the map. Goal: under 2 ms a
 * step so painting stays smooth at 144 frames a second (budgets in
 * `npm run test:perf`, ten times looser in the normal run).
 */

const catalog = new CatalogIndex(
  normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'),
);

const overlay = {
  setDraft: () => undefined,
  setGizmo: () => undefined,
  setNodesVisible: () => undefined,
  setPreview: () => undefined,
  transform: { hide: () => undefined, setKind: () => undefined, place: () => undefined, highlight: () => undefined },
} as unknown as EditorOverlay;

function context(editor: EditorDocument): ToolContext {
  const settings = defaultSettings();
  settings.brush = { radius: 32, strength: 0.8, falloff: 0.5 };
  return {
    editor,
    settings,
    catalog,
    overlay,
    heightAt: (x, y) => heightAt(editor.doc.terrain, x, y),
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
}

const pointer = (x: number, y: number): ToolPointer => ({
  hit: { x, y, z: 0 },
  clientX: 0,
  clientY: 0,
  button: 0,
  shift: false,
  ctrl: false,
  alt: false,
});

interface Case {
  name: string;
  /** Budget per step, ms */
  budget: number;
  make: (ctx: ToolContext) => EditorTool;
}

const CASES: Case[] = [
  { name: 'raise', budget: 2, make: (ctx) => ((ctx.settings.terrain.mode = 'raise'), new TerrainTool()) },
  { name: 'smooth', budget: 2, make: (ctx) => ((ctx.settings.terrain.mode = 'smooth'), new TerrainTool()) },
  { name: 'paint', budget: 2, make: () => new PaintTool() },
  { name: 'water paint', budget: 2, make: (ctx) => ((ctx.settings.water.mode = 'paint'), new WaterTool()) },
  {
    name: 'biome forest',
    budget: 2,
    make: (ctx) => {
      ctx.settings.landscape.mode = 'biome';
      ctx.settings.landscape.biome = 'forest';
      return new LandscapeTool();
    },
  },
  { name: 'mountain', budget: 2, make: (ctx) => ((ctx.settings.landscape.mode = 'mountain'), new LandscapeTool()) },
  ...(['swamp', 'hell', 'city'] as const).map((biome) => ({
    name: `biome ${biome}`,
    budget: 2,
    make: (ctx: ToolContext) => {
      ctx.settings.landscape.mode = 'biome';
      ctx.settings.landscape.biome = biome;
      return new LandscapeTool();
    },
  })),
  { name: 'erode', budget: 2, make: (ctx) => ((ctx.settings.landscape.mode = 'erode'), new LandscapeTool()) },
  { name: 'glow cracks', budget: 2, make: (ctx) => ((ctx.settings.landscape.mode = 'cracks'), new LandscapeTool()) },
  { name: 'crater', budget: 2, make: (ctx) => ((ctx.settings.landscape.mode = 'crater'), new LandscapeTool()) },
];

describe('brush steps', () => {
  for (const columns of [256, 512, 1024]) {
    for (const c of CASES) {
      it(`${c.name} on ${columns} samples`, () => {
        const cell = 2;
        const editor = new EditorDocument(
          createMapDocument({ id: 'p', name: 'P', width: columns * cell, depth: columns * cell, cellSize: cell, now: new Date(0) }),
        );
        const ctx = context(editor);
        const tool = c.make(ctx);
        const half = (columns * cell) / 2;
        let x = -half * 0.6;
        const y = half * 0.4;
        tool.pointerDown?.(pointer(x, y), ctx);
        // Warm up the code paths, then step across the map like a drag
        for (let k = 0; k < 10; k++) tool.frame?.(1 / 144, pointer((x += 1), y), ctx);
        const ms = medianMs(() => tool.frame?.(1 / 144, pointer((x += 1.5), y), ctx), 60);
        tool.pointerUp?.(pointer(x, y), ctx);
        console.log(`[brush] ${c.name} ${columns}: ${ms.toFixed(2)} ms`);
        expect(ms).toBeLessThan(perfBudget(c.budget));
      });
    }
  }
});
