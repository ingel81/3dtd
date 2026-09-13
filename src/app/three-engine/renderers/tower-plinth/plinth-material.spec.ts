import { describe, expect, it } from 'vitest';
import { Color, MeshStandardMaterial, ShaderChunk, ShaderLib, type IUniform } from 'three';
import { createPlinthMaterial } from './plinth-material';

/** The standard shader as three hands it to onBeforeCompile, patched by the plinth material. */
function patchedShader(material = createPlinthMaterial()) {
  const shader = {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, IUniform>,
  };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

describe('createPlinthMaterial', () => {
  const shader = patchedShader();

  it('draws the masonry right after the chunks it extends', () => {
    expect(shader.vertexShader).toMatch(/#include <begin_vertex>\n\s*vPlinthLocal = transformed;/);
    expect(shader.fragmentShader).toMatch(/#include <color_fragment>\n\s*vec4 plinthCell = plinthStones/);
    expect(shader.fragmentShader).toMatch(/#include <roughnessmap_fragment>\n\s*roughnessFactor = plinthRoughness;/);
    expect(shader.fragmentShader).toMatch(/#include <normal_fragment_maps>\n\s*normal = plinthPerturbNormal/);
  });

  it('declares its varyings in both stages and its functions before main', () => {
    for (const varying of ['vPlinthWorld', 'vPlinthLocal', 'vPlinthUp']) {
      expect(shader.vertexShader).toContain(`varying vec3 ${varying};`);
      expect(shader.fragmentShader).toContain(`varying vec3 ${varying};`);
    }
    const main = shader.fragmentShader.indexOf('void main()');
    for (const fn of ['float plinthHash1(', 'vec3 plinthHash3(', 'float plinthNoise(', 'vec4 plinthStones(', 'vec3 plinthPerturbNormal(']) {
      expect(shader.fragmentShader.indexOf(fn)).toBeGreaterThan(-1);
      expect(shader.fragmentShader.indexOf(fn)).toBeLessThan(main);
    }
  });

  it('only uses what the standard shader provides where it is used', () => {
    // faceDirection comes from normal_fragment_begin, vViewPosition is a varying of the standard shader
    expect(ShaderChunk.normal_fragment_begin).toContain('float faceDirection');
    expect(ShaderLib.standard.fragmentShader).toContain('varying vec3 vViewPosition;');
    expect(ShaderChunk.roughnessmap_fragment).toContain('float roughnessFactor');
    expect(ShaderChunk.beginnormal_vertex).toContain('vec3 objectNormal');
  });

  it('adds balanced GLSL', () => {
    const count = (source: string, ch: string) => source.split(ch).length - 1;
    const addedCount = (ch: string) =>
      count(shader.fragmentShader, ch) - count(ShaderLib.standard.fragmentShader, ch)
      + count(shader.vertexShader, ch) - count(ShaderLib.standard.vertexShader, ch);
    expect(addedCount('(')).toBeGreaterThan(0);
    expect(addedCount('(')).toBe(addedCount(')'));
    expect(addedCount('{')).toBe(addedCount('}'));
  });

  it('keeps the log depth and the output conversion of the standard shader', () => {
    expect(shader.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(shader.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(shader.fragmentShader).toContain('#include <fog_fragment>');
  });

  it('hands the shader its colours in the linear working space', () => {
    const mortar = shader.uniforms['plinthMortar'].value as Color;
    expect(mortar).toBeInstanceOf(Color);
    // 0xb8 is 0.72 in sRGB, about 0.48 linear
    expect(mortar.r).toBeLessThan(0xb8 / 255 - 0.1);
    for (const name of ['plinthStoneLight', 'plinthStoneMid', 'plinthStoneDark', 'plinthMoss']) {
      expect(shader.uniforms[name].value).toBeInstanceOf(Color);
    }
  });

  it('shares one program among all plinths, apart from the plain standard material', () => {
    const a = createPlinthMaterial();
    const b = createPlinthMaterial();
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toBe(new MeshStandardMaterial().customProgramCacheKey());
    expect(a).toBeInstanceOf(MeshStandardMaterial);
  });
});
