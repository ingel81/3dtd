import { BoxGeometry, DataTexture, MeshStandardMaterial } from 'three';
import { mergeKey, mergeParts } from './merge-parts';

describe('mergeParts (fewer draw calls per model)', () => {
  it('merges plain parts of one look, keeps textured ones, foliage and other looks apart', () => {
    const red = new MeshStandardMaterial({ color: 0xff0000 });
    const blue = new MeshStandardMaterial({ color: 0x0000ff });
    const shiny = new MeshStandardMaterial({ color: 0x0000ff, roughness: 0.1 });
    const textured = new MeshStandardMaterial({ map: new DataTexture() });
    const leaves = new MeshStandardMaterial({ name: 'foliage-oak' });
    expect(mergeKey(textured)).toBeNull();
    expect(mergeKey(leaves)).toBeNull();
    expect(mergeKey(red)).toBe(mergeKey(blue));
    expect(mergeKey(shiny)).not.toBe(mergeKey(red));

    const parts = [red, textured, blue, shiny, leaves].map((material) => ({ geometry: new BoxGeometry(), material }));
    const out = mergeParts(parts);
    expect(out.map((p) => p.material)).toEqual([expect.objectContaining({ vertexColors: true }), textured, shiny, leaves]);
    const color = out[0].geometry.getAttribute('color');
    expect(color.count).toBe(48);
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
});
