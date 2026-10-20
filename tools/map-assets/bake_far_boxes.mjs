// Bakes the far stage of the buildings and of rows of foliage (object-layer.ts, far-boxes.ts): each building model as a box of 24
// triangles, its top a 3 x 3 grid of heights (a flat roof, a gable either way, a hip, a shed), its four walls
// and its top textured with the model seen square on from that side, five tiles of TILE px in one atlas for all
// buildings. A model the box cannot stand for (an L, a tower beside a hall, a spire) gets none and keeps its
// LOD model to its draw distance.
//
// Writes tools/map-assets/farboxes.json (update_catalog.py puts it into the catalogue as `far`) and
// public/maps/assets/models/far-boxes.ktx2 (tools/model-pack/encode-image.mjs, UASTC; each tile unsharp-masked,
// needs KTX_TOOL). The models render in Playwright's Chromium (three's GLTFLoader with
// the meshopt decoder, as the game loads them), unlit: the colour of their textures, vertex colours and
// factors; the alpha of the atlas marks window glass (half alpha), which glows at night as on the model.
//
//   node tools/map-assets/bake_far_boxes.mjs public/maps/assets [<id> ...]
//
// Playwright comes from e2e/node_modules (E2E_DIR points elsewhere, e.g. at the main checkout from a worktree).
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pixels per tile edge; a building takes its far stage at a few dozen pixels on screen */
const TILE = 64;
/** Tiles per atlas row */
const COLUMNS = 16;
/** Supersampling of each view before it is scaled down to its tile */
const SUPER = 4;
/** Strength of the unsharp mask on each building's tile (sharpen) */
const SHARPEN = 0.8;
/** Height samples per side of the grid the top is fitted to */
const SAMPLES = 24;
/** A model whose top strays further from the box's top than this share of its height on average keeps no box */
const MAX_TOP_ERROR = 0.12;
/** A model covering less of its bounds than this, seen from above, keeps no box (an L, a courtyard, a tower beside a hall) */
const MIN_COVER = 0.72;

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/bake_far_boxes.mjs <public/maps/assets> [<id> ...]');
  process.exit(1);
}
const only = new Set(process.argv.slice(3));
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const e2e = process.env.E2E_DIR ?? path.join(root, 'e2e');
const { chromium } = createRequire(path.join(e2e, 'package.json'))('playwright');
const catalog = JSON.parse(readFileSync(path.join(assets, 'catalog.json'), 'utf8'));
/**
 * Rows of foliage that read as a solid line from afar (a vineyard's rows, hedges) get a box too, after the
 * buildings so their tiles keep their places
 */
const ROWS = ['vine-row', 'hedge', 'hedge-long'];
const buildings = [
  ...catalog.objects.filter((o) => o.category === 'building'),
  ...ROWS.map((id) => catalog.objects.find((o) => o.id === id)).filter(Boolean),
].filter((o) => o.file && (!only.size || only.has(o.id)));

const PAGE = /* html */ `<!doctype html><html><body>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
// The packed models name shared KTX2 textures (pack-map-models.mjs)
const ktx2 = new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').detectSupport(renderer);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const glass = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const solid = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });

/** The model unlit: its colour texture, vertex colours and colour factor; glass apart */
function unlit(scene) {
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    const isGlass = src.name.startsWith('window-glass') || src.name === 'window';
    o.material = new THREE.MeshBasicMaterial({ map: src.map ?? null, color: src.color ?? new THREE.Color(1, 1, 1), vertexColors: !!o.geometry.attributes.color,
      alphaTest: src.alphaTest > 0 ? src.alphaTest : 0, side: THREE.DoubleSide });
    parts.push({ mesh: o, look: o.material, glass: isGlass });
  });
  return parts;
}

/** Each side's view: where the camera stands, where it looks, its up; the box is centre c, half sides hw, hd */
function views(c, hw, hd, y0, top) {
  const far = 1000;
  return [
    { pos: [c.x, top + far, c.z], up: [0, 0, -1], w: hw, h: hd, mid: [0, 0] },
    { pos: [c.x, 0, c.z - hd - far], up: [0, 1, 0], w: hw, h: (top - y0) / 2, mid: [0, (top + y0) / 2] },
    { pos: [c.x + hw + far, 0, c.z], up: [0, 1, 0], w: hd, h: (top - y0) / 2, mid: [0, (top + y0) / 2] },
    { pos: [c.x, 0, c.z + hd + far], up: [0, 1, 0], w: hw, h: (top - y0) / 2, mid: [0, (top + y0) / 2] },
    { pos: [c.x - hw - far, 0, c.z], up: [0, 1, 0], w: hd, h: (top - y0) / 2, mid: [0, (top + y0) / 2] },
  ];
}

/** Colour into pixels nothing covers, from their covered neighbours, so the tile's edge and mips keep the wall's colour */
/**
 * An unsharp mask over the model's pixels (alpha 1): the scaled-down view loses the fine lines that make a panel
 * of solar cells, a window's frame or a roof's tiles read as such, and a tile far off showed them as one blur (E268)
 */
function sharpen(px, amount) {
  const src = px.slice();
  for (let y = 0; y < ${TILE}; y++) for (let x = 0; x < ${TILE}; x++) {
    const k = (y * ${TILE} + x) * 4;
    if (src[k + 3] === 0) continue;
    let r = 0, g = 0, b = 0, m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ${TILE} || ny >= ${TILE}) continue;
      const j = (ny * ${TILE} + nx) * 4;
      if (src[j + 3] === 0) continue;
      r += src[j]; g += src[j + 1]; b += src[j + 2]; m++;
    }
    px[k] = src[k] + amount * (src[k] - r / m);
    px[k + 1] = src[k + 1] + amount * (src[k + 1] - g / m);
    px[k + 2] = src[k + 2] + amount * (src[k + 2] - b / m);
  }
}

function dilate(px, n) {
  for (let pass = 0; pass < n; pass++) {
    const src = px.slice();
    let open = 0;
    for (let y = 0; y < ${TILE}; y++) for (let x = 0; x < ${TILE}; x++) {
      const k = (y * ${TILE} + x) * 4;
      if (src[k + 3] > 0) continue;
      let r = 0, g = 0, b = 0, m = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ${TILE} || ny >= ${TILE}) continue;
        const j = (ny * ${TILE} + nx) * 4;
        if (src[j + 3] === 0) continue;
        r += src[j]; g += src[j + 1]; b += src[j + 2]; m++;
      }
      if (m) { px[k] = r / m; px[k + 1] = g / m; px[k + 2] = b / m; px[k + 3] = 1; }
      else open++;
    }
    if (!open) return;
  }
}

window.bake = async (list) => {
  const rows = Math.ceil((list.length * 5) / ${COLUMNS});
  const atlas = document.createElement('canvas');
  atlas.width = ${COLUMNS} * ${TILE};
  atlas.height = Math.max(1, rows) * ${TILE};
  const actx = atlas.getContext('2d');
  const tile = document.createElement('canvas');
  tile.width = tile.height = ${TILE};
  const tctx = tile.getContext('2d', { willReadFrequently: true });
  tctx.imageSmoothingQuality = 'high';
  renderer.setSize(${TILE * SUPER}, ${TILE * SUPER});
  const out = {};
  const report = [];
  let k = 0;
  for (const { id, url, row } of list) {
    const gltf = await loader.loadAsync(url);
    const scene = new THREE.Scene();
    scene.add(gltf.scene);
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
    const y0 = bounds.min.y;
    const top = bounds.max.y;
    const base = Math.max(0, y0);
    const height = top - base;
    // The top seen from above: the first surface down a grid of rays over the bounds
    const meshes = [];
    gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const S = ${SAMPLES};
    const heights = new Float32Array(S * S);
    const sx = (bounds.max.x - bounds.min.x) / S;
    const sz = (bounds.max.z - bounds.min.z) / S;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      ray.set(new THREE.Vector3(bounds.min.x + (i + 0.5) * sx, top + 10, bounds.min.z + (j + 0.5) * sz), down);
      const hit = ray.intersectObjects(meshes, false)[0];
      heights[j * S + i] = hit && hit.point.y > base + 0.3 ? hit.point.y : NaN;
    }
    // The box: the bounds less border rows and columns mostly open (balconies, eaves, a porch, a chimney's reach)
    let i0 = 0, i1 = S - 1, j0 = 0, j1 = S - 1;
    const share = (fi, fj) => {
      let hit = 0, all = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (fi(i) && fj(j)) { all++; if (!Number.isNaN(heights[j * S + i])) hit++; }
      return all ? hit / all : 1;
    };
    for (let step = 0; step < S / 4; step++) {
      const sides = [
        [share((i) => i === i0, () => true), () => i0++],
        [share((i) => i === i1, () => true), () => i1--],
        [share(() => true, (j) => j === j0), () => j0++],
        [share(() => true, (j) => j === j1), () => j1--],
      ].sort((a, b) => a[0] - b[0]);
      if (sides[0][0] >= 0.5) break;
      sides[0][1]();
    }
    const cover = share(() => true, () => true);
    const c = new THREE.Vector3(bounds.min.x + ((i0 + i1 + 1) / 2) * sx, 0, bounds.min.z + ((j0 + j1 + 1) / 2) * sz);
    const hw = ((i1 - i0 + 1) / 2) * sx;
    const hd = ((j1 - j0 + 1) / 2) * sz;
    // The 3 x 3 grid at the box's corners, edge middles and middle: the heights whose bilinear surface (in each
    // quarter, as the box's two triangles nearly are) comes nearest the model's top in least squares
    const weights = (i, j) => {
      const u = ((i - i0 + 0.5) / (i1 - i0 + 1)) * 2, v = ((j - j0 + 0.5) / (j1 - j0 + 1)) * 2;
      const gi = Math.min(1, Math.floor(u)), gj = Math.min(1, Math.floor(v));
      const fu = u - gi, fv = v - gj;
      const w = new Float64Array(9);
      w[gj * 3 + gi] = (1 - fu) * (1 - fv);
      w[gj * 3 + gi + 1] = fu * (1 - fv);
      w[(gj + 1) * 3 + gi] = (1 - fu) * fv;
      w[(gj + 1) * 3 + gi + 1] = fu * fv;
      return w;
    };
    const A = Array.from({ length: 9 }, () => new Float64Array(10));
    let mean = 0, hits = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!Number.isNaN(heights[j * S + i])) { mean += heights[j * S + i]; hits++; }
    mean = hits ? mean / hits : base;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const h = heights[j * S + i];
      if (Number.isNaN(h)) continue;
      const w = weights(i, j);
      for (let a = 0; a < 9; a++) {
        if (!w[a]) continue;
        for (let b = 0; b < 9; b++) A[a][b] += w[a] * w[b];
        A[a][9] += w[a] * h;
      }
    }
    // A little pull towards the mean height keeps a node no sample reaches defined
    for (let a = 0; a < 9; a++) { A[a][a] += 1e-3; A[a][9] += 1e-3 * mean; }
    for (let col = 0; col < 9; col++) {
      let pivot = col;
      for (let r = col + 1; r < 9; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      [A[col], A[pivot]] = [A[pivot], A[col]];
      for (let r = 0; r < 9; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        for (let q = col; q < 10; q++) A[r][q] -= f * A[col][q];
      }
    }
    const grid = A.map((row, a) => Math.min(top, Math.max(base, row[9] / row[a])));
    // How far the model's top strays from the grid's within the box; an open sample counts from the ground
    let err = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const h = heights[j * S + i];
      const w = weights(i, j);
      let fit = 0;
      for (let a = 0; a < 9; a++) fit += w[a] * grid[a];
      err += Number.isNaN(h) ? fit - base : Math.abs(h - fit);
      n++;
    }
    const topError = err / n / Math.max(1, height);
    report.push({ id, cover: +cover.toFixed(2), topError: +topError.toFixed(3) });
    // A row of foliage stands for a slab from afar, gaps and all
    if (!row && (cover < ${MIN_COVER} || topError > ${MAX_TOP_ERROR})) continue;
    // Five views into five tiles: the colour, then the glass as alpha
    const parts = unlit(scene);
    const atlasTile = k;
    for (const [view, vw] of views(c, hw, hd, y0, top).entries()) {
      const cam = new THREE.OrthographicCamera(-vw.w, vw.w, vw.h, -vw.h, 1, 4000);
      cam.position.set(...vw.pos);
      cam.up.set(...vw.up);
      cam.lookAt(view === 0 ? new THREE.Vector3(c.x, 0, c.z) : new THREE.Vector3(c.x, vw.pos[1], c.z));
      if (view > 0) { cam.position.y = vw.mid[1]; cam.lookAt(c.x, vw.mid[1], c.z); }
      cam.updateMatrixWorld();
      const shot = () => {
        renderer.setClearColor(0x000000, 0);
        renderer.render(scene, cam);
        tctx.clearRect(0, 0, ${TILE}, ${TILE});
        tctx.drawImage(renderer.domElement, 0, 0, ${TILE * SUPER}, ${TILE * SUPER}, 0, 0, ${TILE}, ${TILE});
        return tctx.getImageData(0, 0, ${TILE}, ${TILE});
      };
      for (const p of parts) p.mesh.material = p.look;
      const colour = shot();
      for (const p of parts) p.mesh.material = p.glass ? glass : solid;
      const mask = shot();
      const px = colour.data;
      // Pixels the model covers at least partly keep their (straight) colour, the others are filled from beside
      for (let q = 0; q < px.length; q += 4) px[q + 3] = px[q + 3] > 24 ? 1 : 0;
      if (!row) sharpen(px, ${SHARPEN});
      const open = row ? px.filter((_, q) => q % 4 === 3).map((a) => 1 - a) : null;
      dilate(px, ${TILE});
      if (open) {
        // A row's gaps are the shade inside its foliage, and the unlit leaves are lighter than the lit crown
        for (let q = 0; q < px.length; q += 4) {
          const k = open[q / 4] ? 0.45 : 0.8;
          px[q] *= k;
          px[q + 1] *= k;
          px[q + 2] *= k;
        }
      }
      for (let q = 0; q < px.length; q += 4) px[q + 3] = mask.data[q] > 127 ? 128 : 255;
      const t = atlasTile * 5 + view;
      actx.putImageData(colour, (t % ${COLUMNS}) * ${TILE}, Math.floor(t / ${COLUMNS}) * ${TILE});
    }
    const r = (x) => Math.round(x * 100) / 100 || 0;
    out[id] = { tile: atlasTile, box: [r(c.x), r(c.z), r(hw), r(hd), r(y0), r(top)], top: grid.map(r) };
    k++;
  }
  // Rows the boxes did not fill go
  const used = Math.max(1, Math.ceil((k * 5) / ${COLUMNS}));
  const trimmed = document.createElement('canvas');
  trimmed.width = atlas.width;
  trimmed.height = used * ${TILE};
  trimmed.getContext('2d').drawImage(atlas, 0, 0);
  return { out, report, image: trimmed.toDataURL('image/png') };
};
window.ready = true;
</script></body></html>`;

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
    return;
  }
  const file = url.startsWith('/assets/') ? path.join(assets, url.slice(8)) : url.startsWith('/node_modules/') ? path.join(root, url) : null;
  try {
    if (!file) throw new Error('not served');
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.ready === true);
  const list = buildings.map((o) => ({ id: o.id, url: `/assets/${o.file}`, row: ROWS.includes(o.id) }));
  const { out, report, image } = await page.evaluate((l) => window.bake(l), list);
  for (const r of report) console.error(`${r.id.padEnd(28)} cover ${r.cover}  top error ${r.topError}${out[r.id] ? '' : '  (no box)'}`);
  // Lossless out of the page, then GPU-compressed as the model textures are
  const work = mkdtempSync(path.join(tmpdir(), 'far-boxes-'));
  try {
    const png = path.join(work, 'far-boxes.png');
    writeFileSync(png, Buffer.from(image.split(',')[1], 'base64'));
    // UASTC: ETC1S smeared a tile's fine lines into its blocks (BC7 on the GPU either way, the same memory)
    execFileSync(process.execPath, [path.join(here, '..', 'model-pack', 'encode-image.mjs'), png, path.join(assets, 'models', 'far-boxes.ktx2'), '--uastc'], { stdio: 'inherit' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  // One line per model: "id": {"tile", "box": [middle x, middle z, half width, half depth, bottom, top of the views],
  // "top": the 3 x 3 heights, rows from -z to +z, each from -x to +x}
  const lines = Object.entries(out).map(([id, b]) => `  ${JSON.stringify(id)}: ${JSON.stringify(b)}`);
  writeFileSync(path.join(here, 'farboxes.json'), `{\n${lines.join(',\n')}\n}\n`);
  console.error(`${lines.length} of ${buildings.length} buildings boxed`);
} finally {
  await browser.close();
  server.close();
}
