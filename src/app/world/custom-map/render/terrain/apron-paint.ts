import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { MAX_GROUND_LAYERS, type MapTerrain } from '../../map-document';

/**
 * The ground of the apron (the land beyond the map's edge, terrain-apron.ts):
 * the paint of the map's border carried outward, so a forest's floor runs
 * on past the edge instead of the first layer. Only natural ground goes
 * (`natural`, not roads, pavement or glowing lava): a town's border carries
 * on as the town's grass, a map without any at its border as the natural
 * ground the map holds most of; a map without natural ground keeps its
 * border's paint.
 *
 * One texel per APRON_PAINT_SAMPLES-th of the border, counter-clockwise from
 * the south-west corner as the apron runs (side 0 south, 1 east, 2 north,
 * 3 west); row r holds the weights of the layers 4r..4r+3. Each texel
 * averages the splat over a strip reaching INWARD metres into the map and
 * BLUR metres along the border either way.
 */
export const APRON_PAINT_SAMPLES = 512;
/** Rows of the texture: the 12 ground layers four to a row */
export const APRON_PAINT_ROWS = MAX_GROUND_LAYERS / 4;
const INWARD = 24;
const BLUR = 30;
/** Metres from the border within which a change of paint changes the apron's */
export const APRON_PAINT_BAND = INWARD + BLUR + 8;

/** Map point at metre `p` of the border (counter-clockwise from the south-west corner) and its inward normal */
function borderAt(t: MapTerrain, p: number): [number, number, number, number] {
  const w = t.width;
  const d = t.depth;
  const at = ((p % (2 * (w + d))) + 2 * (w + d)) % (2 * (w + d));
  if (at < w) return [-w / 2 + at, -d / 2, 0, 1];
  if (at < w + d) return [w / 2, -d / 2 + (at - w), -1, 0];
  if (at < 2 * w + d) return [w / 2 - (at - w - d), d / 2, 0, -1];
  return [-w / 2, d / 2 - (at - 2 * w - d), 1, 0];
}

/** Splat weights (0..1 each) of the map's layers at a map point, nearest texel */
function splatAt(t: MapTerrain, x: number, y: number, out: Float32Array): void {
  const res = t.splat.resolution;
  const u = Math.min(res - 1, Math.max(0, Math.floor(((x + t.width / 2) / t.width) * res)));
  const v = Math.min(res - 1, Math.max(0, Math.floor(((y + t.depth / 2) / t.depth) * res)));
  const texel = (v * res + u) * 4;
  for (let k = 0; k < MAX_GROUND_LAYERS; k++) out[k] = (t.splat.maps[k >> 2]?.[texel + (k & 3)] ?? 0) / 255;
}

/** The weights per border sample, APRON_PAINT_SAMPLES x MAX_GROUND_LAYERS, each sample summing to 1 */
export function apronPaintWeights(t: MapTerrain, natural: (layer: number) => boolean): Float32Array {
  const n = APRON_PAINT_SAMPLES;
  const perimeter = 2 * (t.width + t.depth);
  const step = perimeter / n;
  const raw = new Float32Array(n * MAX_GROUND_LAYERS);
  const w = new Float32Array(MAX_GROUND_LAYERS);
  for (let s = 0; s < n; s++) {
    const [x, y, nx, ny] = borderAt(t, (s + 0.5) * step);
    for (let d = 1; d <= INWARD; d += 4) {
      splatAt(t, x + nx * d, y + ny * d, w);
      for (let k = 0; k < MAX_GROUND_LAYERS; k++) raw[s * MAX_GROUND_LAYERS + k] += w[k];
    }
  }
  // Along the border either way, round the corners
  const reach = Math.max(1, Math.round(BLUR / step));
  const blurred = new Float32Array(n * MAX_GROUND_LAYERS);
  for (let s = 0; s < n; s++) {
    for (let o = -reach; o <= reach; o++) {
      const from = ((s + o) % n + n) % n;
      for (let k = 0; k < MAX_GROUND_LAYERS; k++) blurred[s * MAX_GROUND_LAYERS + k] += raw[from * MAX_GROUND_LAYERS + k];
    }
  }
  const layers = t.layers.length;
  const isNatural = Array.from({ length: MAX_GROUND_LAYERS }, (_, k) => k < layers && natural(k));
  // The natural ground the map holds most of, for a border without any
  let most = -1;
  if (isNatural.some(Boolean)) {
    const totals = new Float64Array(MAX_GROUND_LAYERS);
    const res = t.splat.resolution;
    for (let texel = 0; texel < res * res; texel += 7) {
      for (let k = 0; k < MAX_GROUND_LAYERS; k++) if (isNatural[k]) totals[k] += t.splat.maps[k >> 2]?.[texel * 4 + (k & 3)] ?? 0;
    }
    for (let k = 0; k < MAX_GROUND_LAYERS; k++) if (isNatural[k] && (most < 0 || totals[k] > totals[most])) most = k;
  }
  const out = new Float32Array(n * MAX_GROUND_LAYERS);
  for (let s = 0; s < n; s++) {
    const row = blurred.subarray(s * MAX_GROUND_LAYERS, (s + 1) * MAX_GROUND_LAYERS);
    let total = 0;
    let kept = 0;
    for (let k = 0; k < MAX_GROUND_LAYERS; k++) {
      total += row[k];
      if (isNatural[k]) kept += row[k];
    }
    const target = out.subarray(s * MAX_GROUND_LAYERS, (s + 1) * MAX_GROUND_LAYERS);
    if (most >= 0 && kept < total * 0.05) {
      target[most] = 1;
      continue;
    }
    const keep = most >= 0;
    const sum = keep ? kept : total;
    if (sum <= 0) {
      target[0] = 1;
      continue;
    }
    for (let k = 0; k < MAX_GROUND_LAYERS; k++) if (!keep || isNatural[k]) target[k] = row[k] / sum;
  }
  return out;
}

/** The weights as the shader reads them (TerrainMaterial uApronPaint): RGBA rows of four layers, the border along x */
export function apronPaintTexture(weights: Float32Array, target?: DataTexture): DataTexture {
  const n = APRON_PAINT_SAMPLES;
  const data = (target?.image.data as Uint8Array | undefined) ?? new Uint8Array(n * APRON_PAINT_ROWS * 4);
  for (let r = 0; r < APRON_PAINT_ROWS; r++) {
    for (let s = 0; s < n; s++) {
      for (let c = 0; c < 4; c++) data[(r * n + s) * 4 + c] = Math.round(weights[s * MAX_GROUND_LAYERS + r * 4 + c] * 255);
    }
  }
  if (target) {
    target.needsUpdate = true;
    return target;
  }
  const t = new DataTexture(data, n, APRON_PAINT_ROWS, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.magFilter = t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}
