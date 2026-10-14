import { ShaderLib, UniformsUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { HeightTexture } from '../terrain/height-texture';
import { GrassField } from './grass-field';

/** The grass material's vertex shader as three would compile it */
function vertexShader(grass: GrassField): string {
  const shader = {
    uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  grass.mesh.material.onBeforeCompile(shader as never, null as never);
  return shader.vertexShader;
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
});
