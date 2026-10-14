import { BoxGeometry, DataTexture, MeshStandardMaterial, ShaderLib, UniformsUtils } from 'three';
import { addHeightFog } from '../environment/height-fog';
import { addVertexRoughMetal, mergeKey, mergeParts } from './merge-parts';

describe('mergeParts (fewer draw calls per model)', () => {
  it('merges plain parts of one look, keeps textured ones, foliage and other looks apart', () => {
    const red = new MeshStandardMaterial({ color: 0xff0000 });
    const blue = new MeshStandardMaterial({ color: 0x0000ff });
    const shiny = new MeshStandardMaterial({ color: 0x0000ff, roughness: 0.1, metalness: 0.7 });
    const glowing = new MeshStandardMaterial({ color: 0x0000ff, emissive: 0xffaa00 });
    const textured = new MeshStandardMaterial({ map: new DataTexture() });
    const leaves = new MeshStandardMaterial({ name: 'foliage-oak' });
    expect(mergeKey(textured)).toBeNull();
    expect(mergeKey(leaves)).toBeNull();
    expect(mergeKey(red)).toBe(mergeKey(blue));
    // Roughness and metalness go per vertex; a glow keeps its own draw
    expect(mergeKey(shiny)).toBe(mergeKey(red));
    expect(mergeKey(glowing)).not.toBe(mergeKey(red));

    const parts = [red, textured, blue, shiny, glowing, leaves].map((material) => ({ geometry: new BoxGeometry(), material }));
    const out = mergeParts(parts);
    expect(out.map((p) => p.material)).toEqual([expect.objectContaining({ vertexColors: true }), textured, glowing, leaves]);
    const color = out[0].geometry.getAttribute('color');
    expect(color.count).toBe(72);
    // Roughness and metalness of the third box, per vertex
    const rm = out[0].geometry.getAttribute('roughMetal');
    expect([rm.getX(48), rm.getY(48)]).toEqual([expect.closeTo(0.1), expect.closeTo(0.7)]);
    // The first box red, the second blue
    expect([color.getX(0), color.getZ(0)]).toEqual([1, 0]);
    expect([color.getX(24), color.getZ(24)]).toEqual([0, 1]);
    expect((out[0].material as MeshStandardMaterial).color.getHex()).toBe(0xffffff);
  });

  it('takes only the draw range of a part of a multi-material mesh', () => {
    const box = new BoxGeometry();
    box.setDrawRange(0, 6);
    const other = new BoxGeometry();
    const [merged] = mergeParts([
      { geometry: box, material: new MeshStandardMaterial({ color: 0xff0000 }) },
      { geometry: other, material: new MeshStandardMaterial({ color: 0x00ff00 }) },
    ]);
    // One face of the first box (4 vertices, 6 corners) and the whole second box
    expect(merged.geometry.getAttribute('position').count).toBe(4 + 24);
    expect(merged.geometry.getIndex()!.count).toBe(6 + 36);
  });

  it('reads roughness and metalness from the vertex where the material had them, before what is patched in after', () => {
    const m = new MeshStandardMaterial({ roughnessMap: new DataTexture() });
    addVertexRoughMetal(m);
    addHeightFog(m);
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as never, null as never);
    const fs = shader.fragmentShader;
    // The material's value is the vertex's inside three's chunk, so a roughness map scales it
    expect(fs.indexOf('#define roughness vRoughMetal.x')).toBeLessThan(fs.indexOf('#include <roughnessmap_fragment>'));
    expect(fs.indexOf('#undef roughness')).toBeGreaterThan(fs.indexOf('#include <roughnessmap_fragment>'));
    expect(fs).toContain('#define metalness vRoughMetal.y');
    // Nothing sets the factor after rain made it wet
    expect(fs).not.toContain('roughnessFactor = vRoughMetal');
    expect(fs.indexOf('min(roughnessFactor, 0.35)')).toBeGreaterThan(fs.indexOf('#include <roughnessmap_fragment>'));
  });
});
