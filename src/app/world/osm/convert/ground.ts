/**
 * The land cover of an OSM world painted into the ground (docs/OSM_WORLD_PLAN.md,
 * Zuordnung: Boden): every area with a land class (land-tags.ts) fills the
 * splat texels inside it, the smaller area over the larger (a park in the
 * town, a pond's meadow in the forest). The materials get the layers left
 * after the base, the roads' surfaces and the water's beds and shores, the
 * ones covering most ground first; one that gets none falls back on the
 * next material of its class that did, else on the base grass. Edges blend
 * over one texel either side.
 *
 * The same areas fill a land grid on the height samples, for the plants
 * (vegetation.ts): which class grows where.
 */
import { MAX_LAYERS } from '../../../editor/ops/paint-ops';
import { fitSplatMaps, type MapEnvironment, type MapTerrain } from '../../custom-map/map-document';
import { LAND_GROUND, landClassOf, type LandClass } from '../land-tags';
import type { OsmFeatures } from '../osm-parse';
import { fillRings, sampleGrid, texelGrid } from './raster';

/** The land classes in a fixed order: index + 1 in the land grid, 0 for none */
export const LAND_CLASSES = Object.keys(LAND_GROUND) as LandClass[];

export interface GroundReport {
  /** Areas painted, by class */
  areas: Partial<Record<LandClass, number>>;
  /** Materials that got a layer, and those that fell back on another (material: the one it took) */
  layers: string[];
  fellBack: Record<string, string>;
}

export interface GroundResult {
  report: GroundReport;
  /** Per height sample: the land class index + 1 (LAND_CLASSES), 0 for none */
  land: Uint8Array;
}

/**
 * Paints the land of `features` into `terrain`, keeping layers free for the
 * materials painted after it (`reserved`: the roads' surfaces, the water's
 * beds and shores); the land may take those as well
 */
export function paintGround(terrain: MapTerrain, features: OsmFeatures, reserved: ReadonlySet<string>): GroundResult {
  const areas = features.areas
    .map((a) => ({ a, cls: landClassOf(a.tags) }))
    .filter((e): e is { a: (typeof features.areas)[number]; cls: LandClass } => e.cls !== null && e.a.area > 0)
    // Larger first, so the smaller is painted over it
    .sort((p, q) => q.a.area - p.a.area);
  const report: GroundReport = { areas: {}, layers: [], fellBack: {} };
  const res = terrain.splat.resolution;
  const texels = texelGrid(terrain.width, res);
  const cls = new Uint8Array(res * res);
  const land = new Uint8Array(terrain.grid.columns * terrain.grid.rows);
  const samples = sampleGrid(terrain.width, terrain.grid.cellSize);
  for (const { a, cls: c } of areas) {
    const index = LAND_CLASSES.indexOf(c) + 1;
    report.areas[c] = (report.areas[c] ?? 0) + 1;
    const rings = [...a.outer, ...a.inner];
    fillRings(rings, texels, (i, j) => (cls[j * res + i] = index));
    fillRings(rings, samples, (i, j) => (land[j * samples.n + i] = index));
  }

  // Ground covered per material, and the layers the most covered get
  const count = new Float64Array(LAND_CLASSES.length + 1);
  for (const c of cls) count[c]++;
  const byMaterial = new Map<string, number>();
  LAND_CLASSES.forEach((c, k) => {
    if (count[k + 1]) byMaterial.set(LAND_GROUND[c][0], (byMaterial.get(LAND_GROUND[c][0]) ?? 0) + count[k + 1]);
  });
  const layers = terrain.layers;
  const base = layers[0].material;
  const has = (m: string) => m === base || reserved.has(m) || layers.some((l) => l.material === m);
  const room = Math.max(0, MAX_LAYERS - layers.length - [...reserved].filter((m) => !layers.some((l) => l.material === m)).length);
  const chosen = [...byMaterial.entries()].filter(([m]) => !has(m)).sort((p, q) => q[1] - p[1]).slice(0, room).map(([m]) => m);
  // A class without its own material takes the next one of its list that has a layer (or will get one), else the base
  const layerOf = new Int8Array(LAND_CLASSES.length + 1);
  LAND_CLASSES.forEach((c, k) => {
    if (!count[k + 1]) return;
    const pick = LAND_GROUND[c].find((m) => has(m) || chosen.includes(m));
    const material = pick ?? base;
    if (material !== LAND_GROUND[c][0]) report.fellBack[LAND_GROUND[c][0]] = material;
    let L = layers.findIndex((l) => l.material === material);
    if (L < 0) {
      layers.push({ material });
      L = layers.length - 1;
    }
    layerOf[k + 1] = L;
  });
  report.layers = layers.slice(1).map((l) => l.material);
  fitSplatMaps(terrain);

  // Weights: the share of each layer in the 3 x 3 texels around, so edges blend over a texel either side
  const maps = terrain.splat.maps;
  const near = new Float32Array(MAX_LAYERS);
  const bytes = new Int32Array(MAX_LAYERS);
  for (let v = 0; v < res; v++) {
    for (let u = 0; u < res; u++) {
      const k = v * res + u;
      const c0 = cls[k];
      if (u > 0 && v > 0 && u < res - 1 && v < res - 1) {
        const up = k - res;
        const down = k + res;
        if (cls[k - 1] === c0 && cls[k + 1] === c0 && cls[up] === c0 && cls[down] === c0 && cls[up - 1] === c0 && cls[up + 1] === c0 && cls[down - 1] === c0 && cls[down + 1] === c0) {
          // Inside one area (or none): its layer alone
          if (!c0) continue;
          const L = layerOf[c0];
          const at = k * 4;
          for (const map of maps) map.fill(0, at, at + 4);
          maps[L >> 2][at + (L & 3)] = 255;
          continue;
        }
      }
      let any = false;
      near.fill(0);
      for (let dv = -1; dv <= 1; dv++) {
        const vv = Math.min(res - 1, Math.max(0, v + dv));
        for (let du = -1; du <= 1; du++) {
          const uu = Math.min(res - 1, Math.max(0, u + du));
          const c = cls[vv * res + uu];
          if (c) any = true;
          near[c ? layerOf[c] : 0] += du === 0 && dv === 0 ? 4 : 1;
        }
      }
      if (!any) continue;
      // 12 parts in all: the centre counts 4, its neighbours 1 each
      const at = k * 4;
      let total = 0;
      let largest = 0;
      for (let l = 0; l < MAX_LAYERS; l++) {
        bytes[l] = Math.round((near[l] * 255) / 12);
        total += bytes[l];
        if (bytes[l] > bytes[largest]) largest = l;
      }
      bytes[largest] += 255 - total;
      for (let ch = 0; ch < 4; ch++) {
        maps[0][at + ch] = bytes[ch];
        maps[1][at + ch] = bytes[ch + 4];
        if (maps[2]) maps[2][at + ch] = bytes[ch + 8];
      }
    }
  }
  return { report, land };
}

/** Share of the map under buildings from which its look is a city's */
const CITY_SHARE = 0.15;

/**
 * The look of the place: a city's where buildings cover much of it, else the
 * temperate land; the sun as high as at noon around the equinox at its
 * latitude, from the south (north on the southern half)
 */
export function placeMood(features: OsmFeatures): Pick<MapEnvironment, 'biome' | 'sunElevation' | 'sunAzimuth'> {
  let built = 0;
  for (const a of features.areas) if (a.tags['building']) built += a.area;
  const lat = features.frame.lat;
  return {
    biome: built / (4 * features.half * features.half) >= CITY_SHARE ? 'city' : 'temperate',
    sunElevation: Math.round(Math.min(65, Math.max(25, 90 - Math.abs(lat)))),
    sunAzimuth: lat >= 0 ? 150 : 30,
  };
}
