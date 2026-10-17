import { describe, it, expect } from 'vitest';
import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, FloatType, FrontSide, RGBAFormat, Scene, Vector3, type Vector4 } from 'three';
import { clothSeed, clothUniforms, MAX_CLOTH_PALETTE, MAX_CLOTH_REGIONS } from './vat-cloth';
import { createVATMaterial } from './vat-material';
import { EnemyInstanceManager, type TypePool } from './enemy-instance.manager';
import { ENEMY_TYPES, type ClothVariants } from '../../../configs/enemy-types.config';
import type { VATData } from './vat-baker';

const CLOTH: ClothVariants = {
  regions: [
    { color: '#e0d8d0', tolerance: 0.08, from: 0.5, to: 0.8, palette: ['#7d9cc0', '#a8b07a'], fade: 0.5 },
    { color: '#705048', tolerance: 0.08, from: 0, to: 0.6, palette: ['#3b4150'] },
  ],
  grime: { dirt: 0.8, blood: 0.5 },
};

/** A rest pose from y -1 to 3 */
function geometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, 3, 0, 0, 1, 1], 3));
  return g;
}

function vat(): VATData {
  return {
    positionTexture: new DataTexture(new Float32Array(3 * 4), 3, 1, RGBAFormat, FloatType),
    encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
    vertexCount: 3,
    totalFrames: 1,
    animations: new Map([['walk', { name: 'walk', frameStart: 0, frameCount: 1, duration: 1, totalTime: 1 }]]),
    geometry: geometry(),
    diffuseMap: null,
    isUnlit: false,
    alpha: { mode: 'opaque', cutoff: 0 },
    fps: 30,
    texWidth: 3,
    rowsPerFrame: 1,
    baseColor: { r: 1, g: 1, b: 1 },
    side: FrontSide,
    modelMinY: -1,
    modelMaxY: 3,
  } as VATData;
}

describe('clothing looks (E185)', () => {
  it('gives each id its seed, the same each time, spread evenly over [0, 1)', () => {
    expect(clothSeed('enemy-17')).toBe(clothSeed('enemy-17'));
    const counts = [0, 0, 0, 0];
    for (let k = 0; k < 4000; k++) {
      const seed = clothSeed(`enemy-${k}`);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1);
      counts[Math.floor(seed * 4)]++;
    }
    for (const n of counts) expect(n).toBeGreaterThan(850);
  });

  it('turns the regions into uniforms: colour in sRGB, band in rest-pose metres, palettes, rest pose and grime', () => {
    const u = clothUniforms(CLOTH, geometry());
    const region = (u['uClothRegion'].value as Vector4[])[0];
    expect([region.x, region.y, region.z].map((v) => Math.round(v * 255))).toEqual([224, 216, 208]);
    expect(region.w).toBe(0.08);
    const band = (u['uClothBand'].value as Vector4[])[0];
    // 0.5 and 0.8 of the height from y -1 to 3, the fade in w
    expect(band.x).toBeCloseTo(1);
    expect(band.y).toBeCloseTo(2.2);
    expect(band.w).toBe(0.5);
    expect(u['uClothCount'].value).toEqual([2, 1, 0, 0]);
    const palette = u['uClothPalette'].value as Vector4[];
    expect(palette).toHaveLength(MAX_CLOTH_REGIONS * MAX_CLOTH_PALETTE);
    const blue = new Color('#7d9cc0');
    expect([palette[0].x, palette[0].y, palette[0].z, palette[0].w]).toEqual([blue.r, blue.g, blue.b, 1]);
    expect(palette[2].w).toBe(0);
    expect(palette[MAX_CLOTH_PALETTE].w).toBe(1);
    const rest = u['uClothRest'].value as Vector4;
    expect([rest.x, rest.y, rest.z, rest.w]).toEqual([-1, 4, 0.8, 0.5]);
    expect(() => clothUniforms({ regions: [{ ...CLOTH.regions[0], palette: [] }] }, geometry())).toThrow(/at most/);
    expect(() => clothUniforms({ regions: Array(5).fill(CLOTH.regions[1]) }, geometry())).toThrow(/at most/);
  });

  it('switches the recolouring on only for a type with looks', () => {
    expect(createVATMaterial(vat()).defines).toEqual({});
    const material = createVATMaterial(vat(), { cloth: CLOTH });
    expect(material.defines).toEqual({ VAT_CLOTH: '' });
    expect(material.fragmentShader).toContain('clothRecolor(baseColor)');
    expect(material.vertexShader).toContain('attribute float aClothSeed');
  });

  it('gives each instance of a type with looks its seed in one more instance attribute, kept as the pool grows', () => {
    const manager = new EnemyInstanceManager(new Scene());
    const config = { ...ENEMY_TYPES['zombie'], clothVariants: CLOTH };
    manager.createPool('zombie', vat(), config);
    manager.createPool('zombie-v2', vat(), { ...ENEMY_TYPES['zombie-v2'], clothVariants: undefined });
    const pools = (manager as unknown as { pools: Map<string, TypePool> }).pools;
    expect(pools.get('zombie-v2')!.clothAttr).toBeNull();
    expect(pools.get('zombie-v2')!.instancedMesh.geometry.getAttribute('aClothSeed')).toBeUndefined();

    const ids = Array.from({ length: 600 }, (_, k) => `z${k}`);
    for (const id of ids) manager.addEnemy(id, 'zombie', new Vector3(), 0);
    const pool = pools.get('zombie')!;
    // Past the first 512: the attribute grew with the pool and is the mesh's
    expect(pool.clothAttr!.count).toBeGreaterThanOrEqual(600);
    expect(pool.instancedMesh.geometry.getAttribute('aClothSeed')).toBe(pool.clothAttr);
    for (const id of ids) {
      const state = manager.getState(id)!;
      expect(pool.clothAttr!.getX(state.index)).toBeCloseTo(clothSeed(id), 6);
    }
    // Still one mesh for the type
    expect(pool.instancedMesh.count).toBe(600);
  });
});
