import { MeshBasicMaterial, MeshStandardMaterial, ShaderLib, UniformsUtils, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { addHeightFog } from './height-fog';

/** The fragment shader three would compile for a material of `lib` after its onBeforeCompile */
function fragment(material: Material, lib: 'standard' | 'basic'): string {
  const shader = {
    uniforms: UniformsUtils.clone(ShaderLib[lib].uniforms),
    vertexShader: ShaderLib[lib].vertexShader,
    fragmentShader: ShaderLib[lib].fragmentShader,
  };
  material.onBeforeCompile(shader as never, null as never);
  return shader.fragmentShader;
}

describe('addHeightFog lava glow', () => {
  it('lights lit map materials near lava from below, after their emissive map', () => {
    const material = new MeshStandardMaterial();
    addHeightFog(material);
    const fs = fragment(material, 'standard');
    const glow = fs.indexOf('totalEmissiveRadiance += vec3(1.0, 0.32, 0.06)');
    expect(glow).toBeGreaterThan(fs.indexOf('#include <emissivemap_fragment>'));
    expect(fs).toContain('uniform sampler2D uLavaGlowTex;');
  });

  it('leaves out materials that glow by themselves or have no emissive term', () => {
    const terrain = new MeshStandardMaterial();
    terrain.userData['noLavaGlow'] = true;
    addHeightFog(terrain);
    expect(fragment(terrain, 'standard')).not.toContain('lavaNear');
    const basic = new MeshBasicMaterial();
    addHeightFog(basic);
    expect(fragment(basic, 'basic')).not.toContain('lavaNear');
  });
});
