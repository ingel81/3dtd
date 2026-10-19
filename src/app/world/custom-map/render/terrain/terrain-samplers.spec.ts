import { DataArrayTexture, DataTexture } from 'three';
import { describe, expect, it } from 'vitest';
import { programSamplers } from '../../../../../test/program-samplers';
import { addHeightFog } from '../environment/height-fog';
import { ApronMaterial } from './apron-material';
import { TerrainMaterial, type TerrainMaterialParams } from './terrain-material';

/** The ground's materials as MapTerrainLayer builds them, on a map of `splatMaps` splat maps (8 or 12 layers) */
function params(splatMaps: 2 | 3, albedoBake = false): TerrainMaterialParams {
  const tex = new DataTexture(new Uint8Array(4), 1, 1);
  const layers = new DataArrayTexture(new Uint8Array(64), 1, 1, 16);
  return {
    colorArray: layers,
    dataArray: layers,
    splat: new DataArrayTexture(new Uint8Array(4 * splatMaps), 1, 1, splatMaps),
    pathMask: tex,
    apronPaint: tex,
    gridNormals: tex,
    gridOcclusion: tex,
    grid: { columns: 2, rows: 2, cellSize: 1 },
    slots: { count: 15, splat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], cliff: 12, road: 13, path: 14 },
    scales: [],
    averages: [],
    width: 100,
    depth: 100,
    cliffAngle: 40,
    albedoBake,
  };
}

function ground(splatMaps: 2 | 3, albedoBake = false): TerrainMaterial {
  const m = new TerrainMaterial(params(splatMaps, albedoBake));
  addHeightFog(m);
  return m;
}

function apron(splatMaps: 2 | 3): ApronMaterial {
  const m = new ApronMaterial(params(splatMaps), ground(splatMaps));
  addHeightFog(m);
  return m;
}

/** Texture units a map program may take: the hardware's 16 with room for lava, cover and fog to come */
const MAX_UNITS = 13;

describe('texture units of the ground programs (report-gperf 5)', () => {
  it.each([
    ['ground, 8 layers', () => ground(2)],
    ['ground, 12 layers', () => ground(3)],
    ['apron, 8 layers', () => apron(2)],
    ['apron, 12 layers', () => apron(3)],
    ['colour bake, 12 layers', () => ground(3, true)],
  ])('%s takes at most 13', (_, make) => {
    const units = programSamplers(make());
    expect(units.length, units.join(', ')).toBeLessThanOrEqual(MAX_UNITS);
  });
});
