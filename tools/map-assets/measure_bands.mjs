// Measures the far look of every piece that lays as a line (walls, fences,
// hedges, tracks: category wall or structure with a ground rectangle in
// boxes.json): what its full model shows from above and from its two long
// sides, each view rasterised here with a depth buffer over the model at
// scale 1. A pixel takes the colour of the nearest face that is not cut away
// by its alpha (base colour factor times colour texture, linear, times vertex
// colour; not the baked occlusion, which in the game darkens the ambient
// light alone); the band (render/objects/line-bands.ts) is
// coloured with the mean over the covered pixels, top and sides apart, and
// a side that covers less than its box's side rectangle (a chain-link fence's
// wire) keeps that share of its pixels (`cover`). The textures are the shared
// KTX2 files beside the models, decoded with three's Basis transcoder.
// Writes tools/map-assets/bands.json, which update_catalog.py puts into the
// catalogue as `band`. Then the colour a building's basement takes
// (cellars.json, catalogue `cellar`, at the end).
//
//   node tools/map-assets/measure_bands.mjs public/maps/assets
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Matrix4, Vector3 } from 'three';
import { loadGlb } from '../model-budget/glb-node.mjs';

/** Pixels along the longer side of a view */
const RES = 384;
/** A side that covers at least this share of its rectangle is drawn whole */
const SOLID = 0.85;
const CATEGORIES = new Set(['wall', 'structure']);

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/measure_bands.mjs <public/maps/assets>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const objects = JSON.parse(readFileSync(join(here, 'objects.json'), 'utf8'));
const boxes = JSON.parse(readFileSync(join(here, 'boxes.json'), 'utf8'));

// three's Basis transcoder (the game's own), loaded as the CommonJS module it is
const basisDir = join(here, '..', '..', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
const basisModule = { exports: {} };
new Function('module', 'exports', 'require', '__filename', '__dirname', readFileSync(join(basisDir, 'basis_transcoder.js'), 'utf8'))(
  basisModule,
  basisModule.exports,
  createRequire(import.meta.url),
  join(basisDir, 'basis_transcoder.js'),
  basisDir,
);
const basis = await basisModule.exports({ wasmBinary: readFileSync(join(basisDir, 'basis_transcoder.wasm')) });
basis.initializeBasis();
/** RGBA32 in the transcoder's format list */
const RGBA32 = 13;

/** sRGB byte to linear */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const images = new Map();
/** { width, height, data } (RGBA8) of a shared KTX2 file's full-size level */
function image(path) {
  let img = images.get(path);
  if (img) return img;
  const file = new basis.KTX2File(new Uint8Array(readFileSync(path)));
  if (!file.isValid() || !file.startTranscoding()) throw new Error(`${path}: not a KTX2 file the transcoder reads`);
  const data = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
  if (!file.transcodeImage(data, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error(`${path}: transcoding failed`);
  img = { width: file.getWidth(), height: file.getHeight(), data };
  file.close();
  file.delete();
  images.set(path, img);
  return img;
}

const WRAP = { 33071: 'clamp', 33648: 'mirror', 10497: 'repeat' };
function wrap(t, mode) {
  if (mode === 'clamp') return Math.min(Math.max(t, 0), 1);
  const f = t - Math.floor(t);
  return mode === 'mirror' && Math.floor(t) % 2 !== 0 ? 1 - f : f;
}

/** A texture slot of a glTF material: its image, wrap modes and UV set; null for none */
function slot(json, models, info) {
  if (!info) return null;
  const tex = json.textures[info.index];
  const source = tex.extensions?.KHR_texture_basisu?.source ?? tex.source;
  const uri = json.images[source].uri;
  if (!uri) throw new Error('an embedded image: pack the model with pack-map-models.mjs first');
  const sampler = json.samplers?.[tex.sampler] ?? {};
  return {
    img: image(normalize(join(models, decodeURIComponent(uri)))),
    s: WRAP[sampler.wrapS ?? 10497],
    t: WRAP[sampler.wrapT ?? 10497],
    uv: info.texCoord ?? 0,
  };
}

/** Byte offset of the texel at uv (nearest) */
function texel(sl, u, v) {
  const { width, height } = sl.img;
  const x = Math.min(width - 1, Math.floor(wrap(u, sl.s) * width));
  const y = Math.min(height - 1, Math.floor(wrap(v, sl.t) * height));
  return (y * width + x) * 4;
}

/** What a glTF material puts on a pixel, as the rasteriser reads it */
function look(json, models, index) {
  const m = json.materials?.[index] ?? {};
  const pbr = m.pbrMetallicRoughness ?? {};
  return {
    factor: pbr.baseColorFactor ?? [1, 1, 1, 1],
    colour: slot(json, models, pbr.baseColorTexture),
    cutoff: m.alphaMode === 'MASK' ? (m.alphaCutoff ?? 0.5) : m.alphaMode === 'BLEND' ? 0.5 : -1,
    twoSided: !!m.doubleSided,
  };
}

/** The triangles of a model at scale 1: world positions, uv sets, vertex colours and their look */
function triangles(root, json, associations, models) {
  root.updateMatrixWorld(true);
  const out = [];
  const looks = new Map();
  const matrix = new Matrix4();
  const p = new Vector3();
  root.traverse((node) => {
    if (!node.isMesh) return;
    const g = node.geometry;
    const pos = g.getAttribute('position');
    const uvs = [g.getAttribute('uv'), g.getAttribute('uv1')];
    const col = g.getAttribute('color');
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    const instances = node.isInstancedMesh ? node.count : 1;
    for (let n = 0; n < instances; n++) {
      matrix.copy(node.matrixWorld);
      if (node.isInstancedMesh) matrix.multiply(new Matrix4().fromArray(node.instanceMatrix.array, n * 16));
      const flip = matrix.determinant() < 0;
      const world = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) p.fromBufferAttribute(pos, i).applyMatrix4(matrix).toArray(world, i * 3);
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0];
        const at = associations.get(material)?.materials;
        if (!looks.has(at)) looks.set(at, look(json, models, at));
        const lk = looks.get(at);
        for (let k = group.start; k + 2 < Math.min(count, group.start + group.count); k += 3) {
          const ids = index ? [index.getX(k), index.getX(k + 1), index.getX(k + 2)] : [k, k + 1, k + 2];
          if (flip) ids.reverse();
          out.push({ ids, world, uvs, col, look: lk });
        }
      }
    }
  });
  return out;
}

/**
 * A view of the triangles: axes (a, b) across the picture, c towards the
 * viewer. Returns the mean linear colour of the covered pixels and the
 * covered area (m²); with `rows` ([from, to] along b, m) only the pixels
 * between, and those at least `minLum` bright (a wall without its windows)
 */
function view(tris, bounds, a, b, c, sign, rows = null, minLum = 0) {
  const lo = [bounds.min.x, bounds.min.y, bounds.min.z];
  const hi = [bounds.max.x, bounds.max.y, bounds.max.z];
  const px = Math.max(hi[a] - lo[a], hi[b] - lo[b]) / RES;
  const w = Math.max(1, Math.ceil((hi[a] - lo[a]) / px));
  const h = Math.max(1, Math.ceil((hi[b] - lo[b]) / px));
  const depth = new Float32Array(w * h).fill(-Infinity);
  const colour = new Float32Array(w * h * 3);
  for (const { ids, world, uvs, col, look: lk } of tris) {
    const xs = ids.map((i) => (world[i * 3 + a] - lo[a]) / px);
    const ys = ids.map((i) => (world[i * 3 + b] - lo[b]) / px);
    const zs = ids.map((i) => world[i * 3 + c] * sign);
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    // The face's normal towards the viewer: a one-sided face seen from behind shows nothing
    const e = (i, k) => world[ids[i] * 3 + k] - world[ids[0] * 3 + k];
    const [u, v] = [(c + 1) % 3, (c + 2) % 3];
    const facing = (e(1, u) * e(2, v) - e(1, v) * e(2, u)) * sign > 0;
    if (area === 0 || (!facing && !lk.twoSided)) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const w0 = ((xs[1] - qx) * (ys[2] - qy) - (xs[2] - qx) * (ys[1] - qy)) / area;
        const w1 = ((xs[2] - qx) * (ys[0] - qy) - (xs[0] - qx) * (ys[2] - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * zs[0] + w1 * zs[1] + w2 * zs[2];
        const at = y * w + x;
        if (z <= depth[at]) continue;
        const lerp = (attr, comp) => w0 * attr.getComponent(ids[0], comp) + w1 * attr.getComponent(ids[1], comp) + w2 * attr.getComponent(ids[2], comp);
        let [r, g, bl, al] = lk.factor;
        if (lk.colour) {
          const uv = uvs[lk.colour.uv];
          const o = texel(lk.colour, lerp(uv, 0), lerp(uv, 1));
          const d = lk.colour.img.data;
          r *= LINEAR[d[o]];
          g *= LINEAR[d[o + 1]];
          bl *= LINEAR[d[o + 2]];
          al *= d[o + 3] / 255;
        }
        if (col) {
          r *= lerp(col, 0);
          g *= lerp(col, 1);
          bl *= lerp(col, 2);
          if (col.itemSize === 4) al *= lerp(col, 3);
        }
        if (al < lk.cutoff) continue;
        depth[at] = z;
        colour[at * 3] = r;
        colour[at * 3 + 1] = g;
        colour[at * 3 + 2] = bl;
      }
    }
  }
  const sum = [0, 0, 0];
  let covered = 0;
  for (let i = 0; i < w * h; i++) {
    if (depth[i] === -Infinity) continue;
    if (rows) {
      const at = lo[b] + (Math.floor(i / w) + 0.5) * px;
      if (at < rows[0] || at > rows[1]) continue;
    }
    if (minLum && 0.2126 * colour[i * 3] + 0.7152 * colour[i * 3 + 1] + 0.0722 * colour[i * 3 + 2] < minLum) continue;
    covered++;
    for (let k = 0; k < 3; k++) sum[k] += colour[i * 3 + k];
  }
  return { sum, covered, area: covered * px * px };
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const out = {};
for (const o of objects) {
  if (!CATEGORIES.has(o.category) || !boxes[o.id] || o.file === '') continue;
  const models = join(assets, 'models');
  const { root, json, associations } = await loadGlb(join(assets, o.file ?? `models/${o.id}.glb`));
  const tris = triangles(root, json, associations, models);
  const bounds = new Box3().setFromObject(root, true);
  // From above (looking down y), from +z and from -z (looking along z)
  const top = view(tris, bounds, 0, 2, 1, 1);
  const front = view(tris, bounds, 0, 1, 2, 1);
  const back = view(tris, bounds, 0, 1, 2, -1);
  const mean = (...vs) => {
    const n = vs.reduce((s, v) => s + v.covered, 0);
    return n ? [0, 1, 2].map((k) => r3(vs.reduce((s, v) => s + v.sum[k], 0) / n)) : null;
  };
  const side = mean(front, back);
  const band = { top: mean(top) ?? side, side: side ?? mean(top) };
  const [, , hw] = boxes[o.id];
  const cover = Math.min(1, (front.area + back.area) / 2 / (2 * hw * Math.max(bounds.max.y, 0.01)));
  if (cover < SOLID) band.cover = Math.round(cover * 100) / 100;
  out[o.id] = band;
}
// One line per model: "id": {"top": [r, g, b], "side": [r, g, b], "cover": share}
const lines = Object.entries(out).map(([id, b]) => `  ${JSON.stringify(id)}: ${JSON.stringify(b)}`);
writeFileSync(join(here, 'bands.json'), `{\n${lines.join(',\n')}\n}\n`);
console.error(lines.length, 'models measured');

// The basements of the catalogue's buildings (MassLayer cellarBody) are plastered: their plaster takes the colour
// the model's walls show on its ground storey (four sides between CELLAR_ROWS, windows and doors left out by
// CELLAR_MIN_LUM), as a factor over the plaster's own mean colour (the raised buildings' kit, `mass-plaster`).
// Writes tools/map-assets/cellars.json, which update_catalog.py puts into the catalogue as `cellar`
const CELLAR_ROWS = [0.4, 2.6];
const CELLAR_MIN_LUM = 0.05;
const kit = await loadGlb(join(assets, 'models', 'building-mass.glb'));
const plaster = look(kit.json, join(assets, 'models'), kit.json.materials.findIndex((m) => m.name === 'mass-plaster'));
const pm = [0, 0, 0];
const pd = plaster.colour.img.data;
for (let i = 0; i < pd.length; i += 4) for (let k = 0; k < 3; k++) pm[k] += LINEAR[pd[i + k]] * plaster.factor[k];
for (let k = 0; k < 3; k++) pm[k] /= pd.length / 4;
const cellars = {};
for (const o of objects) {
  if (o.category !== 'building' || !boxes[o.id] || o.file === '' || o.id === 'building-mass') continue;
  const models = join(assets, 'models');
  const { root, json, associations } = await loadGlb(join(assets, o.file ?? `models/${o.id}.glb`));
  const tris = triangles(root, json, associations, models);
  const bounds = new Box3().setFromObject(root, true);
  const sides = [
    view(tris, bounds, 0, 1, 2, 1, CELLAR_ROWS, CELLAR_MIN_LUM),
    view(tris, bounds, 0, 1, 2, -1, CELLAR_ROWS, CELLAR_MIN_LUM),
    view(tris, bounds, 2, 1, 0, 1, CELLAR_ROWS, CELLAR_MIN_LUM),
    view(tris, bounds, 2, 1, 0, -1, CELLAR_ROWS, CELLAR_MIN_LUM),
  ];
  const n = sides.reduce((s, v) => s + v.covered, 0);
  if (!n) continue;
  // Held to the range the plaster's texture keeps its look in (as a roof's colour over its covering)
  cellars[o.id] = [0, 1, 2].map((k) => r3(Math.min(2.4, Math.max(0.3, sides.reduce((s, v) => s + v.sum[k], 0) / n / Math.max(pm[k], 0.02)))));
}
const cellarLines = Object.entries(cellars).map(([id, c]) => `  ${JSON.stringify(id)}: ${JSON.stringify(c)}`);
writeFileSync(join(here, 'cellars.json'), `{\n${cellarLines.join(',\n')}\n}\n`);
console.error(cellarLines.length, 'basements measured, plaster mean', pm.map(r3));
