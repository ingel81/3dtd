import { DataArrayTexture, DataTexture, ShaderLib, UniformsUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { GroundAlbedo, groundAlbedoSide } from './ground-albedo';
import { GROUND_COLOR_GLSL, GROUND_COLOR_UNIFORMS } from './ground-color';
import { TerrainMaterial, type TerrainMaterialParams } from './terrain-material';

function params(albedoBake: boolean): TerrainMaterialParams {
  const tex = new DataTexture(new Uint8Array(4), 1, 1);
  const array = new DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  return {
    colorArray: array,
    dataArray: array,
    splat: [tex, tex],
    pathMask: tex,
    gridNormals: tex,
    gridOcclusion: tex,
    grid: { columns: 2, rows: 2, cellSize: 1 },
    slots: { count: 1, splat: [0], cliff: -1, road: -1, path: -1 },
    scales: [4],
    averages: ['#808080'],
    width: 10,
    depth: 10,
    cliffAngle: 40,
    albedoBake,
  };
}

describe('GroundAlbedo', () => {
  it('bakes a metre a texel, 1024 at most, its sides as the map is', () => {
    expect(groundAlbedoSide(512)).toBe(512);
    expect(groundAlbedoSide(2400)).toBe(1024);
    expect(groundAlbedoSide(10)).toBe(64);
    const wide = new GroundAlbedo(800, 400);
    expect([wide.target.width, wide.target.height]).toEqual([800, 400]);
    wide.dispose();
  });

  it('draws with the sampling of the terrain material, its colour alone, as from a few dozen metres', () => {
    const bake = new TerrainMaterial(params(true));
    const ground = new TerrainMaterial(params(false));
    expect(bake.customProgramCacheKey()).not.toBe(ground.customProgramCacheKey());
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    bake.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toContain('#define TERRAIN_ALBEDO_BAKE');
    expect(shader.fragmentShader).toContain('float viewDist = TERRAIN_VIEW_DIST;');
    expect(shader.fragmentShader).toContain('gl_FragColor = vec4(diffuseColor.rgb, 1.0);');
    bake.dispose();
    ground.dispose();
  });

  it('is what groundColorAt reads once baked, until then the splat averages', () => {
    expect(GROUND_COLOR_GLSL).toContain('if (uGroundAlbedoOn > 0.5) return textureLod(uGroundAlbedo, uv, 0.0).rgb;');
    expect(GROUND_COLOR_UNIFORMS.uGroundAlbedoOn.value).toBe(0);
  });
});
