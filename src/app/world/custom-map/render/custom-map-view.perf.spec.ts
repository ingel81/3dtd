import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { medianMs, perfBudget } from '../../../../test/perf-budget';
import { createPerfMap } from '../perf-map';
import { CustomMapView } from './custom-map-view';
import { MapAssetLibrary } from './map-asset-library';
import { mapToScene } from './map-coords';

/**
 * CPU budgets of the custom map view on maps of 256, 512 and 1024 samples a
 * side (2 m cells): building the view, one frame's update() while the
 * camera moves, and an editor brush (32 m) on heights and splat. The GPU is
 * not part of this (jsdom); what is measured is what blocks the main thread.
 * Numbers go to the console; `npm run test:perf` holds the budgets as
 * written, the normal run ten times looser.
 */

const catalog = JSON.parse(readFileSync('public/maps/assets/catalog.json', 'utf8')) as { objects: { id: string }[] };

function offlineLibrary(): MapAssetLibrary {
  return new MapAssetLibrary('maps/assets/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    decodeImage: () => Promise.reject(new Error('offline')),
    loadModel: () => Promise.reject(new Error('offline')),
    textureSize: 4,
  });
}

const CASES: { samples: number; objects: number; build: number; frame: number; brush: number }[] = [
  { samples: 257, objects: 5000, build: 1500, frame: 2, brush: 2 },
  { samples: 513, objects: 20000, build: 5000, frame: 4, brush: 2 },
  { samples: 1025, objects: 50000, build: 15000, frame: 8, brush: 2 },
];

describe('CustomMapView budgets', () => {
  for (const c of CASES) {
    it(`${c.samples} samples, ${c.objects} objects`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const doc = createPerfMap(c.samples, c.objects);
      const t0 = performance.now();
      const view = new CustomMapView(doc, offlineLibrary(), { grass: false });
      await view.ready;
      const build = performance.now() - t0;

      const camera = new PerspectiveCamera(55, 1.6, 0.5, 8000);
      const target = new Vector3();
      let step = 0;
      const frame = medianMs(() => {
        // A moving game camera: culling and LOD run every frame
        step++;
        camera.position.copy(mapToScene(Math.sin(step * 0.1) * 100, -150 + step * 0.5, 180, new Vector3()));
        camera.lookAt(mapToScene(0, step * 0.5, 0, target));
        camera.updateMatrixWorld();
        view.update(1 / 60, camera, target);
      }, 30);

      const brush = medianMs(() => {
        const r = 16;
        const g = doc.terrain.grid;
        for (let j = 0; j < g.rows; j++) {
          const y = -doc.terrain.depth / 2 + j * g.cellSize;
          if (Math.abs(y) > r) continue;
          for (let i = 0; i < g.columns; i++) {
            const x = -doc.terrain.width / 2 + i * g.cellSize;
            if (Math.abs(x) <= r) g.heights[j * g.columns + i] += 0.1;
          }
        }
        view.updateHeights({ minX: -r, minY: -r, maxX: r, maxY: r });
      }, 7);
      const splat = medianMs(() => view.updateSplat({ minX: -16, minY: -16, maxX: 16, maxY: 16 }), 7);

      console.log(
        `[perf] custom map ${c.samples}² ${c.objects} objects: build ${build.toFixed(0)} ms, frame ${frame.toFixed(2)} ms, ` +
          `32 m height brush ${brush.toFixed(2)} ms, splat brush ${splat.toFixed(2)} ms`,
      );
      expect(build).toBeLessThan(perfBudget(c.build));
      expect(frame).toBeLessThan(perfBudget(c.frame));
      expect(brush).toBeLessThan(perfBudget(c.brush));
      expect(splat).toBeLessThan(perfBudget(c.brush));
      view.dispose();
    }, 300_000);
  }
});
