import { DataTexture, ShaderLib, UniformsUtils, type WebGLRenderer } from 'three';
import { APRON_LOOK, ApronMaterial } from './apron-material';
import { TerrainMaterial, type TerrainMaterialParams } from './terrain-material';
import type { LayerArray } from './terrain-textures';
import { addHeightFog } from '../environment/height-fog';

function params(): TerrainMaterialParams {
  const tex = new DataTexture(new Uint8Array(4), 1, 1);
  const array = { image: { depth: 4 } } as unknown as LayerArray;
  return {
    colorArray: array,
    dataArray: array,
    splat: [tex, tex],
    pathMask: tex,
    gridNormals: tex,
    gridOcclusion: tex,
    grid: { columns: 2, rows: 2, cellSize: 1 },
    slots: { count: 4, splat: [0], cliff: 1, road: 2, path: 3 },
    scales: [4, 4, 4, 4],
    averages: ['#808080', '#808080', '#808080', '#808080'],
    width: 100,
    depth: 100,
    cliffAngle: 40,
  };
}

describe('ApronMaterial', () => {
  it("shares the ground's uniforms, so what the layer sets on the ground holds on the apron", () => {
    const ground = new TerrainMaterial(params());
    const apron = new ApronMaterial(params(), ground);
    expect(apron.terrainUniforms.uApronPaint).toBe(ground.terrainUniforms.uApronPaint);
    ground.setFarDistances(90, 250, 0);
    expect(apron.terrainUniforms.uFarFlat.value).toBe(250);
    expect(apron.customProgramCacheKey()).not.toBe(ground.customProgramCacheKey());
  });

  it('paints the range on top of the terrain and lets its upper flanks keep less of the haze', () => {
    const apron = new ApronMaterial(params(), new TerrainMaterial(params()));
    addHeightFog(apron);
    apron.setRange(12, 420, APRON_LOOK.mountain);
    const shader = {
      uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    apron.onBeforeCompile(shader as never, {} as WebGLRenderer);
    const f = shader.fragmentShader;
    expect(f).toContain('float rangeShare');
    // The range is painted after the terrain's albedo and before the fog reads the keep
    expect(f.indexOf('apronHazeKeep = 1.0 - uApronClear')).toBeLessThan(f.indexOf('diffuseColor.rgb = albedo;'));
    expect(f).toContain('#define FOG_BEYOND_KEEP apronHazeKeep');
    expect(f).toContain('uFogBeyond * FOG_BEYOND_KEEP');
    expect(shader.uniforms['uApronHeight' as keyof typeof shader.uniforms]).toEqual({ value: 420 });
  });

  it('has no snow line where the look has no snow, and none clears the haze without a range', () => {
    for (const look of Object.values(APRON_LOOK)) {
      if (!look.snow) expect(look.snowFrom).toBeGreaterThan(1.2);
    }
    const apron = new ApronMaterial(params(), new TerrainMaterial(params()));
    apron.setRange(0, 0, APRON_LOOK.temperate);
    expect(apron.apronUniforms.uApronClear.value).toBe(0);
  });
});
