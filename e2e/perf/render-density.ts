// Where the frame's time and points go on a custom map (docs/RENDER_DENSITY_PLAN.md): per map and camera the draw
// calls, triangles and instances per category, the GPU time (timer query) of the whole view and with each category
// hidden, the share of instances outside the view frustum and behind buildings (a depth image of the buildings
// from the camera, tested per instance's bounding sphere as a Hi-Z culler would), what a culled instance list
// would save on the GPU (the lists compacted to what is in view, measured), objects smaller than a few pixels, a
// forced shadow map, the objects under the pixel limit and the main thread's time for detail levels. Variants
// are measured in turns and pooled (the GPU's clock drifts over a run). Prints a summary, writes everything as JSON.
// The page under test is the probe's: it wraps the renderer, the view's update and the meshes' onBeforeRender.
//
//   npm run build     (with CUSTOM_MAPS_RELEASED true in src/app/world/custom-maps-open.ts for that build only:
//                      a production build opens /map-preview only once the custom maps are released)
//   node e2e/perf/render-density.ts [--port 4440] [--maps ruined-city,autumn-keep] [--own <dir>/<id>.3dtdmap,...]
//        [--quality high] [--json tmp/render-density.json] [--shots <dir>] [--frames 90] [--only <cam>,...]
//
// Serves the production build (dist/3DTD/browser) with the map files of public/ beside it (a release loads them
// from the site, map-data.ts) on its own port and opens /map-preview per map and camera: the map as the game
// draws it (objects, buildings, ground, water, sky, the sun's shadow), no game around it (no towers, enemies, LOS
// cube, post-processing). Chromium with ANGLE D3D11 on Windows, frames uncapped, a visible window (the GPU draws).
// An own map (an OSM world, tools/osm/osm-world.spec.ts) is seeded into the page's map store with its
// <id>.summary.json beside it.
//
// Cameras per map, relative to the HQ unless a map lists its own: `start` the game's start view (400 m up, 145 m
// south, 60 degrees, three-engine/camera-rig.ts), `game` zoomed in as one plays (90 m up, 110 m back), `low`
// a low oblique look across the map (35 m up, 600 m ahead), `top` the whole map from its south edge, `street` at eye
// height and the other views a map lists (VIEWS).
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { seedMap, vsyncArgs } from './perf-run.ts';

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = Number(argument('port', '4440'));
const MAPS = argument('maps', 'ruined-city,autumn-keep').split(',').filter(Boolean);
const OWN = argument('own', '').split(',').filter(Boolean);
const QUALITY = argument('quality', 'high');
const JSON_OUT = argument('json', join(ROOT, 'tmp/render-density.json'));
const SHOTS = argument('shots', '');
const FRAMES = Number(argument('frames', '90'));
const ONLY = argument('only', '').split(',').filter(Boolean);
const WIDTH = 1600;
const HEIGHT = 900;

/** A camera in map metres: eye x, y, height over the ground there, target x, y, height */
type Cam = [number, number, number, number, number, number];
/**
 * Views a map lists of its own, per map id (map metres, as map-preview's `cam`): `street` at eye height in a
 * street, `station` the main station's field of tracks of Würzburg (its full 2.4 km world) from 200 m up, south
 * of it, as one looks there in the game (E303 found tracks missing there)
 */
const VIEWS: Record<string, Record<string, Cam>> = {
  'osm-wuerzburgwelt': { street: [-188, -62, 4, -160, -54, 2], station: [337, 650, 200, 337, 997, 0] },
  'ruined-city': { street: [-6, -60, 3, 0, 0, 2] },
  'autumn-keep': { street: [40, -40, 3, 0, 0, 4] },
};

if (PORT < 4440 || PORT > 4449) throw new Error('--port must lie in 4440-4449');

// ---- the build and the map files on our own port ----
const DIST = join(ROOT, 'dist/3DTD/browser');
const PUBLIC = join(ROOT, 'public');
const THREE_BUILD = join(ROOT, 'node_modules/three/build');
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST}: npm run build first`);
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.3dtdmap': 'application/octet-stream',
};
async function fileIn(base: string, path: string): Promise<string | null> {
  const p = normalize(join(base, path));
  if (!p.startsWith(normalize(base))) return null;
  try {
    return (await stat(p)).isFile() ? p : null;
  } catch {
    return null;
  }
}
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  // The probe's own copy of three for the depth image (a second renderer, buildings and ground only)
  const found = path.startsWith('/__three/')
    ? await fileIn(THREE_BUILD, path.slice('/__three/'.length))
    : (await fileIn(DIST, path)) ?? (await fileIn(PUBLIC, path)) ?? (extname(path) ? null : join(DIST, 'index.html'));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  if (!found) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', TYPES[extname(found)] ?? 'application/octet-stream');
  res.end(await readFile(found));
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`serving ${DIST} on ${PORT}, pid ${process.pid}`);
// --serve: only the server, to look at a view by hand (stop it by its pid)
if (process.argv.includes('--serve')) await new Promise(() => undefined);

// ---- what runs in the page ----

interface PageArgs { frames: number; cam: Cam | string; quality: string }

/**
 * The measurement of one camera, in the page. Plain JavaScript once node strips the types: no imports, three's
 * classes of the page come from its objects, a second copy of three (served under /__three/) draws the depth image.
 */
async function measure(args: PageArgs): Promise<unknown> {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const P = (globalThis as Any).__mapPreview;
  const renderer = P.renderer;
  const camera = P.camera;
  const controls = P.controls;
  const view = P.view;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const scene = view.group.parent;
  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  // The camera: the game's 60 degrees, a pose relative to the HQ or the map's own, no damping
  camera.fov = 60;
  camera.updateProjectionMatrix();
  controls.enableDamping = false;
  const hq = view.doc.hq as { x: number; y: number };
  const half = Math.max(view.doc.terrain?.width ?? 0, view.doc.terrain?.depth ?? 0) / 2 || 600;
  const poses: Record<string, Cam> = {
    start: [hq.x, hq.y - 145, 400, hq.x, hq.y, 0],
    game: [hq.x, hq.y - 110, 90, hq.x, hq.y, 0],
    low: [hq.x, hq.y - 300, 35, hq.x, hq.y + 300, 0],
    top: [0, -half * 1.15, half * 0.9, 0, 0, 0],
  };
  const c: Cam = typeof args.cam === 'string' ? poses[args.cam] : args.cam;
  const lift = (x: number, y: number, h: number) => [-x, view.heightAt(x, y) + h, y];
  const eye = lift(c[0], c[1], c[2]);
  const at = lift(c[3], c[4], c[5]);
  camera.position.set(eye[0], eye[1], eye[2]);
  controls.target.set(at[0], at[1], at[2]);
  controls.update();
  camera.updateMatrixWorld();
  // Detail levels and shadows settle on the new pose (bands open on rest, lod-fade.ts)
  await wait(4000);

  // ---- categories ----
  const categoryOfEntry = (e: Any): string => {
    const id = String(e.id);
    if (/rail|catenary|buffer-stop|crossing-signal|level-crossing/.test(id)) return 'rail';
    switch (e.category) {
      case 'building': return 'buildings';
      case 'tree': return 'trees';
      case 'plant': return 'plants';
      case 'rock': return 'rocks';
      case 'wall': return 'lines';
      case 'structure': return 'structures';
      default: return 'props';
    }
  };
  // The buildings raised from their footprint (mass-layer.ts): walls, roofs and copings, instanced for the whole map
  const masses = new Set<Any>();
  for (const b of [...(view.objects?.masses?.batches ?? []), ...(view.objects?.masses?.ruinBatches ?? [])]) if (b.mesh) masses.add(b.mesh);
  const categoryOf = (o: Any): { cat: string; asset: string } => {
    if (masses.has(o)) {
      const verts = o.geometry?.attributes?.position?.count ?? 0;
      return { cat: 'buildings', asset: verts === 4 ? 'mass-walls' : verts === 3 ? 'mass-roofs' : 'mass-caps' };
    }
    const entry = o.userData?.batch?.entry;
    if (entry) return { cat: categoryOfEntry(entry), asset: String(entry.id) };
    const name = String(o.name || '');
    if (/far-box/.test(name)) return { cat: 'buildings', asset: name };
    if (/impostor/i.test(name)) return { cat: 'trees', asset: name };
    for (let p = o; p; p = p.parent) {
      const n = String(p.name || '');
      if (n === 'custom-map-masses') return { cat: 'buildings', asset: 'mass:' + name };
      if (/grass/i.test(n)) return { cat: 'grass', asset: n };
      if (/water|sea|river/i.test(n)) return { cat: 'water', asset: n };
      if (/terrain|ground|apron/i.test(n)) return { cat: 'ground', asset: n };
      if (/custom-map-life/i.test(n)) return { cat: 'props', asset: n };
      if (/path|road|drape|decal/i.test(n)) return { cat: 'paths', asset: n };
      if (/sky|dome/i.test(n)) return { cat: 'sky', asset: n };
    }
    return { cat: 'other', asset: name || o.type };
  };

  // ---- the drawable meshes ----
  interface Item { o: Any; cat: string; asset: string; tris: number; instanced: boolean }
  const items: Item[] = [];
  scene.traverse((o: Any) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    const g = o.geometry;
    const verts = g?.index ? g.index.count : (g?.attributes?.position?.count ?? 0);
    const tris = o.isMesh ? Math.min(verts, g.drawRange?.count ?? Infinity) / 3 : 0;
    items.push({ o, ...categoryOf(o), tris, instanced: !!o.isInstancedMesh });
  });

  // Which meshes the main pass draws (onBeforeRender), with how many instances
  const drawn = new Map<Any, number>();
  let recording = false;
  for (const it of items) {
    const before = it.o.onBeforeRender;
    it.o.onBeforeRender = function (this: Any, ...a: Any[]) {
      before.apply(this, a);
      if (recording && a[2] === camera) drawn.set(this, (drawn.get(this) ?? 0) + 1);
    };
  }

  // ---- the GPU timer: every render call of a frame (shadow builds, sky bakes, the view), summed per frame ----
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending: { q: WebGLQuery; frame: number }[] = [];
  const gpuByFrame = new Map<number, number>();
  let frameNo = 0;
  let active = false;
  let cpuRender: number[] = [];
  const original = renderer.render.bind(renderer);
  renderer.render = (s: Any, cam: Any) => {
    const q = ext && !active ? gl.createQuery() : null;
    if (q) {
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = true;
    }
    const t = performance.now();
    original(s, cam);
    const main = s === scene && cam === camera;
    if (main) cpuRender.push(performance.now() - t);
    if (q) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      active = false;
      pending.push({ q, frame: frameNo });
    }
    if (main) frameNo++;
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!disjoint) gpuByFrame.set(p.frame, (gpuByFrame.get(p.frame) ?? 0) + gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(p.q);
      pending.splice(i, 1);
    }
  };
  let shadowEach = false;
  // The view's update (detail levels, wind, effects), timed; paused while the GPU is measured
  const objectLayer = view.objects;
  const objUpdate = objectLayer.update.bind(objectLayer);
  let objMs: number[] = [];
  objectLayer.update = (...a: Any[]) => {
    const t = performance.now();
    objUpdate(...a);
    objMs.push(performance.now() - t);
  };
  const viewUpdate = view.update.bind(view);
  let viewMs: number[] = [];
  let paused = false;
  view.update = (...a: Any[]) => {
    if (shadowEach) {
      // The whole shadow map drawn again in this frame, as after a change near the camera's focus
      view.environment.invalidateShadowsNow();
      viewUpdate(...a);
      return;
    }
    if (paused) return;
    const t = performance.now();
    viewUpdate(...a);
    viewMs.push(performance.now() - t);
  };

  /** GPU, frame interval and render call times over `n` frames */
  const run = async (n: number) => {
    cpuRender = [];
    await nextFrame();
    await nextFrame();
    const first = frameNo;
    const starts: number[] = [];
    for (let i = 0; i < n; i++) starts.push(await nextFrame());
    const last = frameNo;
    for (let i = 0; i < 6; i++) await nextFrame();
    const gpu: number[] = [];
    for (let f = first; f < last; f++) if (gpuByFrame.has(f)) gpu.push(gpuByFrame.get(f)!);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    return { gpuMs: median(gpu), gpuMean: mean(gpu), frameMs: median(gaps), renderCallMs: median(cpuRender), samples: gpu.length, raw: gpu, rawCpu: [...cpuRender] };
  };
  type Run = Awaited<ReturnType<typeof run>>;
  /** Several runs of one variant pooled: the median over all their frames */
  const pooled = (runs: Run[]) => {
    const gpu = runs.flatMap((r) => r.raw);
    const cpu = runs.flatMap((r) => r.rawCpu);
    return { gpuMs: median(gpu), gpuMean: mean(gpu), renderCallMs: median(cpu), samples: gpu.length, rounds: runs.length };
  };

  // ---- the main pass as drawn ----
  paused = true;
  await nextFrame();
  drawn.clear();
  renderer.info.autoReset = false;
  renderer.info.reset();
  recording = true;
  await nextFrame();
  recording = false;
  const info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  renderer.info.autoReset = true;
  // The map's placed objects per category and how many of them show no level at all from here (smaller than the
  // pixel limit; a line's piece past its line's): what the pixel limit leaves out (object-layer.ts levelOf, -1 hidden)
  const placed: Record<string, { objects: number; shown: number; beyond: number }> = {};
  for (const b of view.objects?.batches ?? []) {
    if (b.ruin) continue;
    const cat = categoryOfEntry(b.entry);
    const row = (placed[cat] ??= { objects: 0, shown: 0, beyond: 0 });
    for (let i = 0; i < b.objects.length; i++) {
      row.objects++;
      if (b.levelOf[i] >= 0) row.shown++;
      else row.beyond++;
    }
  }

  // ---- frustum, size on screen and the depth image ----
  camera.updateMatrixWorld();
  const pv = new camera.projectionMatrix.constructor().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements as number[];
  // Planes of the frustum from the view-projection matrix (Gribb-Hartmann), normalised
  const planes: number[][] = [];
  const row = (r: number) => [pv[r], pv[4 + r], pv[8 + r], pv[12 + r]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  for (const [a, s] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]] as [number[], number][]) {
    const p = [r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]];
    const l = Math.hypot(p[0], p[1], p[2]);
    planes.push(p.map((v) => v / l));
  }
  const inFrustum = (x: number, y: number, z: number, r: number) => {
    for (const p of planes) if (p[0] * x + p[1] * y + p[2] * z + p[3] < -r) return false;
    return true;
  };
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const focal = H / 2 / Math.tan((camera.fov * Math.PI) / 360);
  const cp = camera.position;

  // The depth image: a second three draws buildings and ground (the page's geometry, shared) into a small target
  const T = await import(/* @vite-ignore */ '/__three/three.module.js' as string);
  const DW = 400;
  const DH = Math.round((DW * H) / W);
  const r2d = new T.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: false });
  r2d.setSize(DW, DH, false);
  const target = new T.WebGLRenderTarget(DW, DH);
  const depthScene = new T.Scene();
  const depthMat = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
  depthMat.side = T.DoubleSide;
  for (const it of items) {
    const o = it.o;
    if (!o.visible || !o.isMesh) continue;
    let shown = true;
    for (let p = o; p; p = p.parent) if (!p.visible) shown = false;
    // Buildings only: the ground's chunks take their heights from a texture in the shader (terrain-chunks.ts), drawn
    // here they would lie flat. Hills do not count as occluders, the share hidden is a lower bound on hilly maps
    if (!shown || it.cat !== 'buildings') continue;
    if (o.userData?.losVertex) continue;
    if (o.material?.transparent) continue;
    const m = o.isInstancedMesh ? new T.InstancedMesh(o.geometry, depthMat, o.count) : new T.Mesh(o.geometry, depthMat);
    if (o.isInstancedMesh) m.instanceMatrix = o.instanceMatrix;
    m.matrixAutoUpdate = false;
    m.matrixWorldAutoUpdate = false;
    m.matrix.copy(o.matrixWorld);
    m.matrixWorld.copy(o.matrixWorld);
    m.frustumCulled = false;
    depthScene.add(m);
  }
  const dcam = new T.PerspectiveCamera(camera.fov, W / H, camera.near, camera.far);
  dcam.position.copy(camera.position);
  dcam.quaternion.copy(camera.quaternion);
  dcam.updateMatrixWorld();
  r2d.setRenderTarget(target);
  r2d.setClearColor(0xffffff, 1);
  r2d.clear();
  r2d.render(depthScene, dcam);
  const px = new Uint8Array(DW * DH * 4);
  r2d.readRenderTargetPixels(target, 0, 0, DW, DH, px);
  // RGBADepthPacking (three r186 packing.glsl): the most significant byte first, 1 where nothing was drawn
  const UD = 255 / 256;
  const depth = new Float32Array(DW * DH);
  for (let i = 0; i < DW * DH; i++) {
    const k = i * 4;
    depth[i] = px[k] === 255 && px[k + 1] === 255 && px[k + 2] === 255 && px[k + 3] === 255
      ? 1
      : (px[k] / 255) * UD + ((px[k + 1] / 255) * UD) / 256 + ((px[k + 2] / 255) * UD) / 65536 + px[k + 3] / 255 / 16777216;
  }
  // The depth image to look at (`--shots`): near dark, far light, nothing white
  const pic = document.createElement('canvas');
  pic.width = DW;
  pic.height = DH;
  const pctx = pic.getContext('2d')!;
  const img = pctx.createImageData(DW, DH);
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const d = depth[(DH - 1 - y) * DW + x];
      const v = d >= 1 ? 255 : Math.round(Math.min(254, Math.pow(Math.max(0, (d - 0.9) * 10), 4) * 254));
      const k = (y * DW + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  pctx.putImageData(img, 0, 0);
  const depthPng = pic.toDataURL('image/png');
  // A max pyramid, as a Hi-Z culler keeps it: each level the farthest depth of four texels below
  const levels: { w: number; h: number; d: Float32Array }[] = [{ w: DW, h: DH, d: depth }];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const b = levels[levels.length - 1];
    const w = Math.max(1, Math.ceil(b.w / 2));
    const h = Math.max(1, Math.ceil(b.h / 2));
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(b.w - 1, x * 2 + dx);
            const sy = Math.min(b.h - 1, y * 2 + dy);
            m = Math.max(m, b.d[sy * b.w + sx]);
          }
        }
        d[y * w + x] = m;
      }
    }
    levels.push({ w, h, d });
  }
  const proj = camera.projectionMatrix.elements as number[];
  const view16 = camera.matrixWorldInverse.elements as number[];
  /** Hidden behind the depth image: the sphere's nearest point lies behind the farthest depth over its screen box */
  const occluded = (x: number, y: number, z: number, r: number): boolean => {
    const vx = view16[0] * x + view16[4] * y + view16[8] * z + view16[12];
    const vy = view16[1] * x + view16[5] * y + view16[9] * z + view16[13];
    const vz = view16[2] * x + view16[6] * y + view16[10] * z + view16[14];
    const nearZ = vz + r; // view space looks down -z
    if (nearZ > -camera.near) return false;
    // Depth buffer value of the nearest point: perspective z to 0..1
    const ndc = (proj[10] * nearZ + proj[14]) / -nearZ;
    const dNear = ndc * 0.5 + 0.5;
    // Screen box of the sphere, conservative (projected at its nearest depth)
    const sx = (proj[0] * vx) / -vz;
    const sy = (proj[5] * vy) / -vz;
    const sr = (Math.max(proj[0], proj[5]) * r) / -nearZ;
    const x0 = Math.max(0, Math.floor(((sx - sr) * 0.5 + 0.5) * DW));
    const x1 = Math.min(DW - 1, Math.floor(((sx + sr) * 0.5 + 0.5) * DW));
    const y0 = Math.max(0, Math.floor(((sy - sr) * 0.5 + 0.5) * DH));
    const y1 = Math.min(DH - 1, Math.floor(((sy + sr) * 0.5 + 0.5) * DH));
    if (x1 < x0 || y1 < y0) return false;
    let l = 0;
    while (l < levels.length - 1 && ((x1 >> l) - (x0 >> l) > 2 || (y1 >> l) - (y0 >> l) > 2)) l++;
    const lv = levels[l];
    let far = 0;
    for (let yy = y0 >> l; yy <= y1 >> l; yy++) for (let xx = x0 >> l; xx <= x1 >> l; xx++) far = Math.max(far, lv.d[yy * lv.w + xx]);
    return dNear > far + 1e-6;
  };

  // ---- per mesh and instance: in view, hidden, size ----
  interface Row { calls: number; meshes: number; instances: number; tris: number; outInst: number; outTris: number; occInst: number; occTris: number; tinyInst: number; tinyTris: number; smallInst: number; smallTris: number; near: number; mid: number; far: number }
  const cats: Record<string, Row> = {};
  const assets: Record<string, Row & { cat: string }> = {};
  const blank = (): Row => ({ calls: 0, meshes: 0, instances: 0, tris: 0, outInst: 0, outTris: 0, occInst: 0, occTris: 0, tinyInst: 0, tinyTris: 0, smallInst: 0, smallTris: 0, near: 0, mid: 0, far: 0 });
  const keep = new Map<Any, { visible: Uint8Array; seen: Uint8Array; count: number }>();
  const tmp = new camera.position.constructor();
  const m4 = new camera.matrixWorld.constructor();
  for (const it of items) {
    const calls = drawn.get(it.o);
    if (!calls) continue;
    const o = it.o;
    const row = (cats[it.cat] ??= blank());
    const arow = (assets[it.asset] ??= { ...blank(), cat: it.cat });
    const groups = Array.isArray(o.material) ? o.material.length : 1;
    const n = o.isInstancedMesh ? o.count : 1;
    for (const r of [row, arow]) {
      r.calls += calls * groups;
      r.meshes += 1;
      r.instances += n;
      r.tris += n * it.tris;
    }
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const bs = g.boundingSphere;
    const visible = new Uint8Array(n);
    const seen = new Uint8Array(n);
    const testsDepth = !['ground', 'paths', 'water', 'sky', 'grass', 'other'].includes(it.cat);
    for (let i = 0; i < n; i++) {
      if (o.isInstancedMesh) {
        m4.fromArray(o.instanceMatrix.array, i * 16).premultiply(o.matrixWorld);
      } else m4.copy(o.matrixWorld);
      tmp.copy(bs.center).applyMatrix4(m4);
      const e = m4.elements;
      const scale = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
      const r = bs.radius * scale;
      if (!(r > 0)) continue;
      const dist = Math.max(0.001, tmp.distanceTo(cp) - r);
      for (const rr of [row, arow]) {
        if (dist < 150) rr.near += it.tris;
        else if (dist < 500) rr.mid += it.tris;
        else rr.far += it.tris;
      }
      if (!inFrustum(tmp.x, tmp.y, tmp.z, r)) {
        for (const rr of [row, arow]) {
          rr.outInst++;
          rr.outTris += it.tris;
        }
        continue;
      }
      visible[i] = 1;
      // What lies on the ground or is the ground (paths, water, the ground's own tiles) is not tested against it
      if (testsDepth && occluded(tmp.x, tmp.y, tmp.z, r)) {
        for (const rr of [row, arow]) {
          rr.occInst++;
          rr.occTris += it.tris;
        }
      } else seen[i] = 1;
      // Radius on screen in pixels
      const pxr = (r * focal) / dist;
      if (pxr < 1) for (const rr of [row, arow]) {
        rr.tinyInst++;
        rr.tinyTris += it.tris;
      }
      if (pxr < 4) for (const rr of [row, arow]) {
        rr.smallInst++;
        rr.smallTris += it.tris;
      }
    }
    if (o.isInstancedMesh) keep.set(o, { visible, seen, count: n });
  }

  // ---- GPU time: as drawn, each category hidden, lists compacted ----
  // Each category hidden against the view as drawn, in turns (two rounds each): `saved` is what it costs
  const hidden: Record<string, Any> = {};
  for (const cat of Object.keys(cats)) {
    const off = items.filter((it) => it.cat === cat && it.o.visible);
    const on: Run[] = [];
    const without: Run[] = [];
    for (let k = 0; k < 2; k++) {
      on.push(await run(Math.round(args.frames / 3)));
      for (const it of off) it.o.visible = false;
      without.push(await run(Math.round(args.frames / 3)));
      for (const it of off) it.o.visible = true;
    }
    const a = pooled(on);
    const b = pooled(without);
    hidden[cat] = { ...b, saved: a.gpuMs != null && b.gpuMs != null ? a.gpuMs - b.gpuMs : null };
  }
  // The instanced lists cut to their instances in view (frustum) and to those not hidden (frustum and depth):
  // what an instance culler would leave the GPU. Meshes sharing a list (an asset's parts) share the cut; an
  // instance shows when any of its meshes would show it
  const lists = new Map<Any, Any[]>();
  for (const o of keep.keys()) {
    const key = o.instanceMatrix;
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key)!.push(o);
  }
  const compact = (which: 'visible' | 'seen') => {
    const undo: (() => void)[] = [];
    for (const meshes of lists.values()) {
      const n = Math.max(...meshes.map((m: Any) => keep.get(m)!.count));
      const show = new Uint8Array(n);
      for (const m of meshes) {
        const k = keep.get(m)!;
        for (let i = 0; i < k.count; i++) if (k[which][i]) show[i] = 1;
      }
      const order: number[] = [];
      for (let i = 0; i < n; i++) if (show[i]) order.push(i);
      if (order.length === n) continue;
      const attrs = new Set<Any>();
      for (const m of meshes) {
        attrs.add(m.instanceMatrix);
        if (m.instanceColor) attrs.add(m.instanceColor);
        for (const a of Object.values(m.geometry.attributes) as Any[]) if (a.isInstancedBufferAttribute) attrs.add(a);
      }
      for (const a of attrs) {
        const was = a.array.slice();
        const size = a.itemSize;
        for (let j = 0; j < order.length; j++) for (let s = 0; s < size; s++) a.array[j * size + s] = was[order[j] * size + s];
        a.needsUpdate = true;
        undo.push(() => {
          a.array.set(was);
          a.needsUpdate = true;
        });
      }
      for (const m of meshes) {
        const count = m.count;
        m.count = order.length;
        undo.push(() => (m.count = count));
      }
    }
    return () => undo.forEach((f) => f());
  };
  // As drawn, cut to the frustum, cut to the frustum and not hidden: in turns over ROUNDS rounds, pooled, so a
  // drift of the GPU's clock over the measurement falls on all three alike
  const ROUNDS = 4;
  const asDrawn: Run[] = [];
  const inView: Run[] = [];
  const notHidden: Run[] = [];
  for (let k = 0; k < ROUNDS; k++) {
    asDrawn.push(await run(Math.round(args.frames / 2)));
    let restore = compact('visible');
    inView.push(await run(Math.round(args.frames / 2)));
    restore();
    restore = compact('seen');
    notHidden.push(await run(Math.round(args.frames / 2)));
    restore();
  }
  const drawnPooled = pooled(asDrawn);
  const culled = pooled(inView);
  const culledHidden = pooled(notHidden);
  // The sun's shadow map drawn every frame (the map draws it only when something changed): its cost on a change
  const withShadow: Run[] = [];
  const without: Run[] = [];
  for (let k = 0; k < 2; k++) {
    without.push(await run(Math.round(args.frames / 3)));
    shadowEach = true;
    withShadow.push(await run(Math.round(args.frames / 3)));
    shadowEach = false;
  }
  const shadow = pooled(withShadow);
  const again = pooled(without);
  const base = drawnPooled;

  // ---- main thread: detail levels while the camera moves ----
  paused = false;
  objMs = [];
  viewMs = [];
  const from = camera.position.clone();
  const fromTarget = controls.target.clone();
  const dir = fromTarget.clone().sub(from).setY(0).normalize();
  const start = performance.now();
  let frames = 0;
  while (performance.now() - start < 3000) {
    const t = (performance.now() - start) / 3000;
    // 60 m forward over 3 s and a quarter turn: objects cross their bands
    camera.position.copy(from).addScaledVector(dir, 60 * t);
    controls.target.copy(fromTarget).addScaledVector(dir, 60 * t);
    controls.target.x += Math.sin(t * Math.PI / 2) * 80;
    controls.update();
    await nextFrame();
    frames++;
  }
  const moving = { frames, viewUpdateMs: mean(viewMs), viewUpdateMax: Math.max(0, ...viewMs), objectLodMs: mean(objMs), objectLodMax: Math.max(0, ...objMs) };
  camera.position.copy(from);
  controls.target.copy(fromTarget);
  controls.update();

  const instancesTotal = Object.values(cats).reduce((a, r) => a + r.instances, 0);
  const topAssets = Object.entries(assets).sort((a, b) => b[1].tris - a[1].tris).slice(0, 25).map(([id, r]) => ({ id, ...r }));
  const depthShare = depth.reduce((a, d) => a + (d < 1 ? 1 : 0), 0) / depth.length;
  r2d.dispose();
  target.dispose();
  return {
    cam: c,
    canvas: [W, H],
    gpuTimer: !!ext,
    info,
    instancesTotal,
    placed,
    categories: cats,
    topAssets,
    depthCover: depthShare,
    depthPng,
    gpu: { base, hidden, culled, culledHidden, shadowEachFrame: shadow, again },
    moving,
  };
}

// ---- the runs ----
const GPU_ARGS = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: false, args: [`--window-size=${WIDTH},${HEIGHT + 100}`, ...vsyncArgs(false), ...GPU_ARGS] });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const page: Page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem('td_seen_version', '9999.0.0');
  localStorage.setItem('td_onboarding_v2', JSON.stringify({ done: true, completed: [] }));
});
await page.goto(`${BASE}/build-info.json`);
const maps: { id: string; own: boolean }[] = MAPS.map((id) => ({ id, own: false }));
for (const file of OWN) {
  await seedMap(page, file);
  maps.push({ id: basename(file, '.3dtdmap'), own: true });
}
const env = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2')!;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { gpu: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), userAgent: navigator.userAgent, timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
});
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
} catch { /* not a checkout */ }
const out: { env: unknown; runs: unknown[] } = { env: { ...env, date: new Date().toISOString(), commit, quality: QUALITY, canvas: [WIDTH, HEIGHT] }, runs: [] };
console.log(JSON.stringify(out.env));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

for (const map of maps) {
  const cams: (Cam | string)[] = ['start', 'game', 'low', 'top'];
  const names = ['start', 'game', 'low', 'top'];
  for (const [name, cam] of Object.entries(VIEWS[map.id] ?? {})) {
    cams.push(cam);
    names.push(name);
  }
  for (const [i, cam] of cams.entries()) {
    if (ONLY.length && !ONLY.includes(names[i])) continue;
    const t0 = Date.now();
    // `big:<metres>:<objects>`: map-preview's generated load map (createPerfMap), else a shipped or own map
    const big = /^big:(\d+):(\d+)$/.exec(map.id);
    const which = big ? `big=${big[1]}&objects=${big[2]}` : `map=${map.id}${map.own ? '&own' : ''}`;
    await page.goto(`${BASE}/map-preview?${which}&quality=${QUALITY}&clean`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (globalThis as { __mapPreview?: { isReady(): boolean } }).__mapPreview?.isReady(), null, { timeout: 180_000 });
    await page.waitForTimeout(3000);
    const result = (await page.evaluate(measure, { frames: FRAMES, cam, quality: QUALITY })) as Record<string, unknown>;
    if (SHOTS) {
      await page.screenshot({ path: join(SHOTS, `${map.id.replace(/[^a-z0-9.-]+/gi, '_')}-${names[i]}.png`) });
      writeFileSync(join(SHOTS, `${map.id.replace(/[^a-z0-9.-]+/gi, '_')}-${names[i]}-depth.png`), Buffer.from(String(result['depthPng']).split(',')[1], 'base64'));
    }
    delete result['depthPng'];
    out.runs.push({ map: map.id, view: names[i], seconds: Math.round((Date.now() - t0) / 1000), ...result });
    const r = result as { info: { calls: number; triangles: number }; instancesTotal: number; categories: Record<string, Record<string, number>>; gpu: Record<string, { gpuMs: number | null } & Record<string, unknown>> };
    const g = (x: { gpuMs: number | null } | undefined) => (x?.gpuMs == null ? '-' : x.gpuMs.toFixed(2));
    console.log(`\n== ${map.id} ${names[i]}: ${r.info.calls} calls, ${(r.info.triangles / 1e6).toFixed(2)} M tris, ${r.instancesTotal} instances; GPU ${g(r.gpu.base)} ms, frustum-culled ${g(r.gpu.culled)}, + hidden ${g(r.gpu.culledHidden)}, shadow each frame ${g(r.gpu.shadowEachFrame)}`);
    console.table(Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, {
      calls: v.calls, inst: v.instances, ktris: Math.round(v.tris / 1000),
      outPct: v.instances ? Math.round((100 * v.outInst) / v.instances) : 0,
      hidPct: v.instances ? Math.round((100 * v.occInst) / v.instances) : 0,
      sub4pxPct: v.instances ? Math.round((100 * v.smallInst) / v.instances) : 0,
      gpuSaved: g({ gpuMs: (r.gpu.hidden as unknown as Record<string, { saved: number | null }>)[k]?.saved ?? null }),
    }])));
    writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
  }
}
await browser.close();
server.close();
console.log(`\nwritten ${JSON_OUT}`);
