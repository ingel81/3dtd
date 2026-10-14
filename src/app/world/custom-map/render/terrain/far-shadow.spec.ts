import { ShaderLib, UniformsUtils, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { sunDirection } from '../environment/map-environment';
import { FAR_SHADOW_SLICE_ROWS, FarShadow, farShadowData } from './far-shadow';
import { TerrainMaterial } from './terrain-material';

/** A flat 400 x 400 m map with a 60 m high ridge running north-south through x = 0 */
function ridge(): HeightField {
  const columns = 101;
  const heights = new Float32Array(columns * columns);
  for (let j = 0; j < columns; j++) {
    for (let i = 0; i < columns; i++) heights[j * columns + i] = Math.abs(i - 50) <= 2 ? 60 : 0;
  }
  return new HeightField({ columns, rows: columns, cellSize: 4, heights }, 400, 400);
}

describe('farShadowData', () => {
  it('shades the land behind a ridge from a low sun, not the land before it', () => {
    // Sun low in the east: the shadow falls west of the ridge (map x < 0)
    const sun = new Vector3(-1, 0.25, 0).normalize();
    const { data, columns, rows } = farShadowData(ridge(), sun, 400, 400);
    expect(columns).toBe(256);
    expect(rows).toBe(256);
    const at = (x: number, y: number): number => data[Math.floor(((y + 200) / 400) * rows) * columns + Math.floor(((x + 200) / 400) * columns)];
    // 60 m high at a rise of 0.26 per metre: about 230 m of shadow west of it
    expect(at(-60, 0)).toBe(0);
    expect(at(-150, 0)).toBe(0);
    expect(at(60, 0)).toBe(255);
    expect(at(150, 50)).toBe(255);
  });

  it('turns with the sun and darkens everything once it has set', () => {
    const field = ridge();
    const west = farShadowData(field, new Vector3(1, 0.25, 0).normalize(), 400, 400);
    const at = (d: Uint8Array, x: number): number => d[128 * 256 + Math.floor(((x + 200) / 400) * 256)];
    expect(at(west.data, 60)).toBe(0);
    expect(at(west.data, -60)).toBe(255);
    const night = farShadowData(field, sunDirection(90, -5, new Vector3()), 400, 400);
    expect(night.data.every((v) => v === 0)).toBe(true);
  });
});

describe('TerrainMaterial far shadow', () => {
  it("dims the directional light's direct light by the far cascade, after its shadow map", () => {
    const shader = {
      uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    const fs = compileTerrain(shader);
    const loop = fs.slice(fs.indexOf('NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'));
    const shadow = loop.indexOf('vDirectionalShadowCoord[ i ]');
    const far = loop.indexOf('directLight.color *= farSunShade();');
    expect(shadow).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(shadow);
    expect(far).toBeLessThan(loop.indexOf('RE_Direct('));
  });
});

/** The terrain material's fragment shader as three would compile it */
function compileTerrain(shader: { uniforms: object; vertexShader: string; fragmentShader: string }): string {
  const layers = { image: { depth: 4 } };
  const material = new TerrainMaterial({
    colorArray: layers,
    dataArray: layers,
    splat: [null, null],
    pathMask: null,
    gridNormals: null,
    gridOcclusion: null,
    grid: { columns: 2, rows: 2, cellSize: 1, heights: new Float32Array(4) },
    width: 1,
    depth: 1,
    scales: [],
    averages: [],
    slots: { splat: [], cliff: -1, road: -1, path: -1 },
    cliffAngle: 40,
  } as never);
  material.onBeforeCompile(shader as never, null as never);
  return shader.fragmentShader;
}

describe('FarShadow.bakeSliced', () => {
  it('bakes the same over several tasks as at once, and stops for a newer bake', async () => {
    const field = ridge();
    const sun = new Vector3(-1, 0.25, 0).normalize();
    const whole = farShadowData(field, sun, 400, 400);
    const shadow = new FarShadow();
    let tasks = 0;
    const done = await shadow.bakeSliced(field, sun, 400, 400, () => (tasks++, true));
    expect(done).toBe(true);
    expect(tasks).toBe(Math.ceil(whole.rows / FAR_SHADOW_SLICE_ROWS));
    expect(shadow.texture.value.image.data).toEqual(whole.data);
    const before = shadow.texture.value.image.data;
    // A newer bake took over: this one leaves the texture as it is
    expect(await shadow.bakeSliced(field, new Vector3(1, 0.25, 0).normalize(), 400, 400, () => false)).toBe(false);
    expect(shadow.texture.value.image.data).toBe(before);
    shadow.dispose();
  });
});
