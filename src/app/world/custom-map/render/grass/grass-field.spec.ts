import { ShaderLib, UniformsUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { HeightTexture } from '../terrain/height-texture';
import { Texture, Vector4 } from 'three';
import { DEFAULT_BLADES, GrassField } from './grass-field';

/** The grass material's shaders as three would compile them */
function shaders(grass: GrassField): { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> } {
  const shader = {
    uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  grass.mesh.material.onBeforeCompile(shader as never, null as never);
  return shader;
}

function vertexShader(grass: GrassField): string {
  return shaders(grass).vertexShader;
}

describe('GrassField', () => {
  it('does the terrain and cover lookups only for blades that are kept', () => {
    const field = new HeightField({ columns: 3, rows: 3, cellSize: 10, heights: new Float32Array(9) }, 20, 20);
    const grass = new GrassField(new HeightTexture(field));
    const vs = vertexShader(grass);
    const main = vs.slice(vs.indexOf('vec2 sceneXZ'));
    // Splat, then terrain, then cover, each behind the previous check
    const splat = main.indexOf('if (keepEdge > 0.0 && onMap)');
    const terrain = main.indexOf('if (grass > 0.45) {');
    const cover = main.indexOf('grassCovered(mapPos)');
    expect(splat).toBeGreaterThan(0);
    expect(terrain).toBeGreaterThan(splat);
    expect(cover).toBeGreaterThan(terrain);
    expect(main.slice(0, terrain)).not.toContain('terrainHeightAt(');
    // Three height lookups per kept blade (ground and two forward differences)
    expect(main.match(/terrainHeightAt\(/g)).toHaveLength(3);
    grass.dispose();
  });

  it('widens the blades of a level that draws fewer, and gives some blades a kind of their own', () => {
    const field = new HeightField({ columns: 3, rows: 3, cellSize: 10, heights: new Float32Array(9) }, 20, 20);
    const grass = new GrassField(new HeightTexture(field));
    const width = (grass as unknown as { uniforms: { uGrassWidth: { value: number } } }).uniforms.uGrassWidth;
    grass.setBlades(70_000);
    expect(width.value).toBe(1);
    grass.setBlades(35_000);
    expect(width.value).toBeCloseTo(Math.SQRT2, 6);
    const vs = vertexShader(grass);
    for (const kind of ['broad', 'seedHead', 'flower']) expect(vs).toContain(`float ${kind} =`);
    grass.dispose();
  });

  it('grows each layer its own blades, short at walls, and lets the sun shine through the tips', () => {
    const field = new HeightField({ columns: 3, rows: 3, cellSize: 10, heights: new Float32Array(9) }, 20, 20);
    const grass = new GrassField(new HeightTexture(field));
    const blades = (grass as unknown as { uniforms: { uGrassBlades: { value: Vector4[] } } }).uniforms.uGrassBlades.value;
    const tex = new Texture();
    // A lawn in channel 0, a layer without its own blades in channel 1 (the meadow's)
    grass.setInputs({ pathMask: tex, mask: [new Vector4(1, 1, 0, 0), new Vector4()], blades: [{ height: [0.06, 0.12], width: 0.02 }, null] });
    expect(blades[0].toArray()).toEqual([0.06, 0.12, 0.02, 0]);
    expect(blades[1].toArray()).toEqual([DEFAULT_BLADES.height[0], DEFAULT_BLADES.height[1], DEFAULT_BLADES.width, 1]);
    const { vertexShader: vs, fragmentShader: fs } = shaders(grass);
    // Blades by the layers' weights, a rim from the cover's distance, the colour from the baked ground
    expect(vs).toContain('kind += uGrassBlades[k] * w0');
    expect(vs).toContain('wall = smoothstep(0.3, 1.5, covered.y');
    expect(vs).toContain('groundColorAt(mapPos)');
    expect(fs).toContain('vBladeGlow * 0.55');
    grass.dispose();
  });
});
