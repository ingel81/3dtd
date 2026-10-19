import { Group, MeshDepthMaterial, MeshStandardMaterial, ShaderChunk, ShaderLib, UniformsUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { turnToCamera } from './impostor';
import { IMPOSTOR_ARRAY, ImpostorDraws, type ImpostorSet } from './impostor-array';

describe('impostors in texture arrays', () => {
  it('reads the asset from its layer and row, not from uniforms of its own', () => {
    for (const [lib, lit] of [[ShaderLib.standard, true], [ShaderLib.depth, false]] as const) {
      const shader = { uniforms: UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      turnToCamera(shader as never, {}, lit, IMPOSTOR_ARRAY);
      expect(shader.vertexShader).toContain('attribute float aImpLayer');
      expect(shader.vertexShader).toContain('#define IMP_CENTER impParam(0).xyz');
      expect(shader.vertexShader).not.toContain('uniform vec3 uImpCenter');
      expect(shader.fragmentShader).toContain('texture(uImpColor, vec3(uv, vImpLayer))');
      expect(shader.fragmentShader.includes('uniform highp sampler2DArray uImpNd')).toBe(lit);
    }
    expect(ShaderChunk.alphatest_fragment).toContain('alphaTest');
  });

  it('draws the impostors of one view size and sight flag in one mesh, the layer per instance, the LOS cube the same cards', () => {
    const blocking = new Group();
    const open = new Group();
    const draws = new ImpostorDraws({ blocking, open });
    const set = { cell: 64, material: new MeshStandardMaterial(), depthMaterial: new MeshDepthMaterial(), losVertex: { key: 'k', pars: '', vertex: '', uniforms: {} } } as unknown as ImpostorSet;
    const key = ImpostorDraws.key({ set, layer: 3 }, true);
    expect(key).toBe('64|blocking');
    draws.register(key, set);
    const { list, renewed } = draws.list(key, 20);
    expect(renewed).toBe(true);
    expect(draws.list(key, 20).renewed).toBe(false);
    expect(blocking.children).toHaveLength(1);
    const mesh = blocking.children[0] as import('three').InstancedMesh;
    expect(mesh.geometry.getAttribute('aImpLayer')).toBe(list.extras[0]);
    expect(mesh.userData['losVertex']).toBe(set.losVertex);
    expect(mesh.customDepthMaterial).toBe(set.depthMaterial);
    // More than it holds: a new list, the old mesh gone
    expect(draws.list(key, 1000).renewed).toBe(true);
    expect(blocking.children).toHaveLength(1);
    draws.dispose();
    expect(blocking.children).toHaveLength(0);
  });
});
