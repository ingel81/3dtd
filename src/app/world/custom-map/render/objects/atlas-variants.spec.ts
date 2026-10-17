import { MeshStandardMaterial, ShaderChunk, ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { addAtlasVariants } from './atlas-variants';

function compiled(material: MeshStandardMaterial): string {
  const shader = {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader.vertexShader.replace('#include <uv_vertex>', ShaderChunk.uv_vertex);
}

describe('addAtlasVariants', () => {
  it('reads every map through the cell the instance picks', () => {
    const m = new MeshStandardMaterial();
    addAtlasVariants(m, 4);
    const vs = compiled(m);
    expect(vs).toContain('vec2 atlasUv = uv;');
    expect(vs).toContain('vMapUv = ( mapTransform * vec3( atlasUv, 1 ) ).xy;');
    expect(vs).toContain('vNormalMapUv = ( normalMapTransform * vec3( atlasUv, 1 ) ).xy;');
    expect(vs).not.toContain('vec3( MAP_UV, 1 )');
    // 2 x 2 cells: columns to the right, rows downwards in glTF's v
    expect(vs).toContain('* 4.0);');
    expect(vs).toContain('mod(atlasPick, 2.0), -floor(atlasPick / 2.0)) / 2.0');
  });

  it('gives the material a program of its own per count', () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    addAtlasVariants(a, 4);
    addAtlasVariants(b, 9);
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toContain('atlas4');
  });
});
