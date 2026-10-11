// Whether a custom map view frees what it took: opens and closes a CustomMapView on the map preview N times (load,
// environment applied to the scene as the game does, shader warm-up, a few frames, dispose) and prints, after each
// cycle and a forced GC, three's GPU resource counts (geometries, textures, programs) and the JS heap. A leak shows
// as counts or a heap that keep climbing. With the shared asset library its caches (models, ground material pixels)
// fill once and stay; `--library fresh` gives every cycle its own library and disposes it with the view, so the
// library's dispose is measured too.
//
//   node e2e/perf/map-cycles.ts --url http://localhost:4211 [--cycles 20] [--view game] [--query "big=1024"]
//                               [--library shared|fresh]
//
// The page is /map-preview of a dev server or of a production build (node e2e/perf/serve.mjs ...).
import { chromium } from '@playwright/test';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const URL_BASE = argument('url', 'http://localhost:4211');
const CYCLES = Number(argument('cycles', '20'));
const VIEW = argument('view', 'game');
const QUERY = argument('query', '');
const FRESH_LIBRARY = argument('library', 'shared') === 'fresh';

interface Sample {
  cycle: number;
  geometries: number;
  textures: number;
  programs: number;
  heapMB: number;
}

const browser = await chromium.launch({ headless: false, args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${URL_BASE}/map-preview?view=${VIEW}${QUERY ? `&${QUERY}` : ''}`);
await page.waitForFunction(() => (window as unknown as { __mapPreview?: { isReady(): boolean } }).__mapPreview?.isReady(), null, {
  timeout: 180000,
});
await page.waitForTimeout(1500);

const samples = await page.evaluate(async ({ cycles, freshLibrary }): Promise<Sample[]> => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const p = (window as any).__mapPreview;
  const View = p.view.constructor;
  const Library = p.view.assets.constructor;
  const SceneType = p.view.group.parent.constructor;
  const renderer = p.renderer;
  const gc = (window as any).gc as () => void;
  const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const sample = async (cycle: number): Promise<Sample> => {
    for (let k = 0; k < 3; k++) {
      gc();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const m = renderer.info.memory;
    return {
      cycle,
      geometries: m.geometries,
      textures: m.textures,
      programs: renderer.info.programs?.length ?? 0,
      heapMB: Math.round((performance as any).memory.usedJSHeapSize / 104857.6) / 10,
    };
  };
  const out = [await sample(0)];
  for (let c = 1; c <= cycles; c++) {
    const scene = new SceneType();
    const assets = freshLibrary ? new Library(p.view.assets.baseUrl, { textureSize: p.view.assets.textureSize }) : p.view.assets;
    const view = new View(p.view.doc, assets, { anisotropy: 8, renderer });
    view.attach(scene);
    view.environment.apply(scene, renderer);
    await view.ready;
    await view.warmUp(renderer, scene, p.camera);
    for (let f = 0; f < 5; f++) {
      view.update(0.016, p.camera, p.controls.target);
      renderer.render(scene, p.camera);
      await frame();
    }
    view.dispose();
    if (freshLibrary) assets.dispose();
    scene.clear();
    out.push(await sample(c));
  }
  return out;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}, { cycles: CYCLES, freshLibrary: FRESH_LIBRARY });

console.log('cycle  geometries  textures  programs  heap MB');
for (const s of samples) {
  console.log(
    `${String(s.cycle).padStart(5)}  ${String(s.geometries).padStart(10)}  ${String(s.textures).padStart(8)}  ${String(s.programs).padStart(8)}  ${s.heapMB.toFixed(1).padStart(7)}`,
  );
}
const first = samples[1];
const last = samples[samples.length - 1];
if (first && last) {
  console.log(
    `after cycle 1 to ${last.cycle}: geometries ${last.geometries - first.geometries}, textures ${last.textures - first.textures}, ` +
      `programs ${last.programs - first.programs}, heap ${(last.heapMB - first.heapMB).toFixed(1)} MB`,
  );
}
await browser.close();
