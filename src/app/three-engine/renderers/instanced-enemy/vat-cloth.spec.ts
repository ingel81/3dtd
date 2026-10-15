import { describe, it, expect } from 'vitest';
import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, FloatType, FrontSide, RGBAFormat, Scene, Vector3, type Vector4 } from 'three';
import { clothLook, clothUniforms, MAX_CLOTH_LOOKS } from './vat-cloth';
import { createVATMaterial } from './vat-material';
import { EnemyInstanceManager, type TypePool } from './enemy-instance.manager';
import { ENEMY_TYPES, type ClothVariants } from '../../../configs/enemy-types.config';
import type { VATData } from './vat-baker';

const CLOTH: ClothVariants = {
  regions: [
    { color: '#e0d8d0', tolerance: 0.08, from: 0.5, to: 0.8 },
    { color: '#705048', tolerance: 0.08, from: 0, to: 0.6 },
  ],
  looks: [
    ['#7d9cc0', '#3b4150'],
    ['#a8b07a', null],
  ],
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
  it('picks a look by id, the same each time, every look and the own about as often', () => {
    expect(clothLook('enemy-17', CLOTH)).toBe(clothLook('enemy-17', CLOTH));
    const counts = [0, 0, 0];
    for (let k = 0; k < 3000; k++) counts[clothLook(`enemy-${k}`, CLOTH)]++;
    for (const n of counts) expect(n).toBeGreaterThan(800);
  });

  it('turns the regions into uniforms: colour in sRGB, band in rest-pose metres, keep where a look has none', () => {
    const u = clothUniforms(CLOTH, geometry());
    const region = (u['uClothRegion'].value as Vector4[])[0];
    expect([region.x, region.y, region.z].map((v) => Math.round(v * 255))).toEqual([224, 216, 208]);
    expect(region.w).toBe(0.08);
    const band = (u['uClothBand'].value as Vector4[])[0];
    // 0.5 and 0.8 of the height from y -1 to 3
    expect(band.x).toBeCloseTo(1);
    expect(band.y).toBeCloseTo(2.2);
    const colors = u['uClothColor'].value as Vector4[];
    expect(colors).toHaveLength(2 * MAX_CLOTH_LOOKS);
    const blue = new Color('#7d9cc0');
    expect([colors[0].x, colors[0].y, colors[0].z, colors[0].w]).toEqual([blue.r, blue.g, blue.b, 1]);
    // Look 2 keeps the trousers, the looks after it do not exist
    expect(colors[3].w).toBe(0);
    expect(colors.slice(4).every((c) => c.w === 0)).toBe(true);
    expect(() => clothUniforms({ regions: CLOTH.regions, looks: Array(5).fill(['#000000', null]) }, geometry())).toThrow(/at most/);
  });

  it('switches the recolouring on only for a type with looks', () => {
    expect(createVATMaterial(vat()).defines).toEqual({});
    const material = createVATMaterial(vat(), { cloth: CLOTH });
    expect(material.defines).toEqual({ VAT_CLOTH: '' });
    expect(material.fragmentShader).toContain('clothRecolor(baseColor)');
    expect(material.vertexShader).toContain('attribute float aClothLook');
  });

  it('gives each instance of a type with looks its look in one more instance attribute, kept as the pool grows', () => {
    const manager = new EnemyInstanceManager(new Scene());
    const config = { ...ENEMY_TYPES['zombie'], clothVariants: CLOTH };
    manager.createPool('zombie', vat(), config);
    manager.createPool('zombie-v2', vat(), { ...ENEMY_TYPES['zombie-v2'], clothVariants: undefined });
    const pools = (manager as unknown as { pools: Map<string, TypePool> }).pools;
    expect(pools.get('zombie-v2')!.clothAttr).toBeNull();
    expect(pools.get('zombie-v2')!.instancedMesh.geometry.getAttribute('aClothLook')).toBeUndefined();

    const ids = Array.from({ length: 600 }, (_, k) => `z${k}`);
    for (const id of ids) manager.addEnemy(id, 'zombie', new Vector3(), 0);
    const pool = pools.get('zombie')!;
    // Past the first 512: the attribute grew with the pool and is the mesh's
    expect(pool.clothAttr!.count).toBeGreaterThanOrEqual(600);
    expect(pool.instancedMesh.geometry.getAttribute('aClothLook')).toBe(pool.clothAttr);
    for (const id of ids) {
      const state = manager.getState(id)!;
      expect(pool.clothAttr!.getX(state.index)).toBe(clothLook(id, CLOTH));
    }
    // Still one mesh for the type
    expect(pool.instancedMesh.count).toBe(600);
  });
});
