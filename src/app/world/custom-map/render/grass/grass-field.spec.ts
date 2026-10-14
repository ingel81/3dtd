import { ShaderLib, UniformsUtils, type Mesh, type Scene, type ShaderMaterial } from 'three';
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

/** The per-blade pass's fragment shader */
function passShader(grass: GrassField): string {
  const scene = (grass as unknown as { passScene: Scene }).passScene;
  return (scene.children[0] as Mesh<never, ShaderMaterial>).material.fragmentShader;
}

function makeGrass(): GrassField {
  const field = new HeightField({ columns: 3, rows: 3, cellSize: 10, heights: new Float32Array(9) }, 20, 20);
  return new GrassField(new HeightTexture(field));
}

describe('GrassField', () => {
  it('does the terrain and cover lookups once per blade, only for blades that are kept', () => {
    const grass = makeGrass();
    const fs = passShader(grass);
    const main = fs.slice(fs.indexOf('void main()'));
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
    // The blade's vertices read what the pass worked out, nothing of the map
    const vs = vertexShader(grass);
    const blade = vs.slice(vs.indexOf('ivec2 bladeTexel'));
    expect(blade.match(/texelFetch\(/g)).toHaveLength(2);
    expect(blade).not.toMatch(/terrainHeightAt\(|uGrassSplat|uGrassCover|variationAt\(/);
    grass.dispose();
  });

  it('draws fewer blades wider, and works out only the rows it draws', () => {
    const grass = makeGrass();
    const state = grass as unknown as { uniforms: { uGrassWidth: { value: number } }; blades: { viewport: { w: number; z: number } } };
    grass.setBlades(70_000);
    expect(state.uniforms.uGrassWidth.value).toBe(1);
    expect(state.blades.viewport.w).toBe(Math.ceil(70_000 / 256));
    grass.setBlades(35_000);
    expect(grass.mesh.geometry.instanceCount).toBe(35_000);
    expect(state.uniforms.uGrassWidth.value).toBeCloseTo(Math.SQRT2, 5);
    expect(state.blades.viewport.w).toBe(Math.ceil(35_000 / 256));
    grass.setBlades(100_000);
    expect(state.uniforms.uGrassWidth.value).toBe(1);
    grass.dispose();
  });
});
