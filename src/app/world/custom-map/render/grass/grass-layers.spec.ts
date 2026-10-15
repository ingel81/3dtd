import { Texture, Vector2, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { HeightTexture } from '../terrain/height-texture';
import { FAR_GRASS, GRASS_FADE_TO, NEAR_GRASS, grassFade } from './grass-field';
import { FAR_GRASS_AHEAD, GRASS_AHEAD, GrassLayers, grassCenters, grassShow } from './grass-layers';

type Uniforms = Record<string, { value: unknown }>;
const uniformsOf = (o: unknown): Uniforms => (o as { uniforms: Uniforms }).uniforms;

describe('GrassLayers', () => {
  it('keeps the near tile round the camera foot and the far one ahead, never past the focus', () => {
    const near = new Vector2();
    const far = new Vector2();
    // A tower's view: low camera, aim point 400 m ahead along +x
    grassCenters({ x: 10, z: 5 }, { x: 410, z: 5 }, 0, near, far);
    expect(near.x).toBeCloseTo(10 + GRASS_AHEAD, 6);
    expect(far.x).toBeCloseTo(10 + GRASS_AHEAD + FAR_GRASS_AHEAD, 6);
    expect(near.y).toBe(5);
    expect(far.y).toBe(5);
    // A camera 30 m up sees the ground from further out: the near tile moves out by half its height
    grassCenters({ x: 10, z: 5 }, { x: 410, z: 5 }, 30, near, far);
    expect(near.x).toBeCloseTo(10 + GRASS_AHEAD + 15, 6);
    expect(far.x - near.x).toBeCloseTo(FAR_GRASS_AHEAD, 6);
    // From straight above: both on the focus' side, at most at the focus
    grassCenters({ x: 0, z: 0 }, { x: 0, z: 20 }, 10, near, far);
    expect(near.y).toBeCloseTo(12, 6);
    expect(far.y).toBeCloseTo(20, 6);
    grassCenters({ x: 3, z: 4 }, { x: 3, z: 4 }, 10, near, far);
    expect([near.x, near.y, far.x, far.y]).toEqual([3, 4, 3, 4]);
  });

  it('has the far ring at full density wherever the near blades thin out', () => {
    const near = new Vector2();
    const far = new Vector2();
    let rnd = 7;
    const next = (): number => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      grassCenters({ x: next() * 400, z: next() * 400 }, { x: next() * 800, z: next() * 800 }, next() * 120, near, far);
      // The near blades' whole circle, its farthest point from the far middle
      const outer = near.distanceTo(far) + GRASS_FADE_TO * 0.5 * NEAR_GRASS.tile;
      expect(grassFade(outer, FAR_GRASS.tile)).toBe(1);
      // Near plus far: the near share where it is, the rest far; no point has both at full
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const r = next() * GRASS_FADE_TO * 0.5 * NEAR_GRASS.tile;
        const p = new Vector2(near.x + Math.cos(a) * r, near.y + Math.sin(a) * r);
        const n = grassFade(p.distanceTo(near), NEAR_GRASS.tile);
        const f = grassFade(p.distanceTo(far), FAR_GRASS.tile) * (1 - n);
        expect(n + f).toBeCloseTo(1, 9);
      }
    }
  });

  it('fades each layer out by the camera distance and opens the far hole only while the near blades draw', () => {
    const field = new HeightField({ columns: 3, rows: 3, cellSize: 10, heights: new Float32Array(9) }, 20, 20);
    const grass = new GrassLayers(new HeightTexture(field));
    expect(grassShow(50, 140)).toBe(1);
    expect(grassShow(140, 140)).toBe(0);
    expect(grassShow(129.5, 140)).toBeCloseTo(0.5, 6);
    expect(grassShow(10, 0)).toBe(0);
    grass.setQuality(70_000, 140, 60_000, 300);
    // No grass layers on this map: neither draws, the far ring has no hole
    grass.update({ x: 0, z: 0 }, { x: 0, z: 50 }, 20, 80);
    expect(grass.meshes.map((m) => m.visible)).toEqual([false, false]);
    expect(uniformsOf(grass.far)['uGrassHoleTile'].value).toBe(0);
    // A meadow: near and far draw, the far ring leaves the near tile to the near blades
    const tex = new Texture();
    grass.setInputs({ splat: [tex, tex], pathMask: tex, mask: [new Vector4(1, 0, 0, 0), new Vector4()], colors: [], width: 20, depth: 20 });
    grass.update({ x: 0, z: 0 }, { x: 0, z: 50 }, 20, 80);
    expect(grass.meshes.map((m) => m.visible)).toEqual([true, true]);
    expect(uniformsOf(grass.far)['uGrassHoleTile'].value).toBe(NEAR_GRASS.tile);
    expect(uniformsOf(grass.far)['uGrassHoleCenter'].value).toEqual(uniformsOf(grass.near)['uGrassCenter'].value);
    // Past the near distance only the far ring is left, without a hole
    grass.update({ x: 0, z: 0 }, { x: 0, z: 50 }, 150, 200);
    expect(grass.meshes.map((m) => m.visible)).toEqual([false, true]);
    expect(uniformsOf(grass.far)['uGrassHoleTile'].value).toBe(0);
    grass.update({ x: 0, z: 0 }, { x: 0, z: 50 }, 150, 300);
    expect(grass.meshes.map((m) => m.visible)).toEqual([false, false]);
    // A tower's view: low over the ground, its aim point far off; both stay
    grass.update({ x: 0, z: 0 }, { x: 0, z: 400 }, 12, 400);
    expect(grass.meshes.map((m) => m.visible)).toEqual([true, true]);
    grass.dispose();
  });

  it('draws the far ring on fewer rows and only on its quality levels', () => {
    const field = new HeightField({ columns: 3, rows: 3, cellSize: 10, heights: new Float32Array(9) }, 20, 20);
    const grass = new GrassLayers(new HeightTexture(field));
    expect(grass.near.mesh.geometry.getAttribute('position').count).toBe((NEAR_GRASS.rows + 1) * 2);
    expect(grass.far.mesh.geometry.getAttribute('position').count).toBe((FAR_GRASS.rows + 1) * 2);
    expect(FAR_GRASS.rows).toBeLessThan(NEAR_GRASS.rows);
    grass.setQuality(35_000, 90, 0, 0);
    expect(grass.far.mesh.geometry.instanceCount).toBe(0);
    grass.setQuality(70_000, 140, 60_000, 300);
    expect(grass.far.mesh.geometry.instanceCount).toBe(60_000);
    expect(uniformsOf(grass.far)['uGrassWidth'].value).toBe(1);
    grass.dispose();
  });
});
