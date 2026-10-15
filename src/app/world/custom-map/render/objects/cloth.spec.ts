import { BufferAttribute, BufferGeometry, MeshStandardMaterial, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { clothGeometry, isCloth } from './cloth';

describe('banner cloth', () => {
  it('is the banner cards only', () => {
    expect(isCloth(Object.assign(new MeshStandardMaterial(), { name: 'foliage-banner-red' }))).toBe(true);
    expect(isCloth(Object.assign(new MeshStandardMaterial(), { name: 'foliage-oak' }))).toBe(false);
  });

  it('cuts a quad into a grid that hangs from its top edge, the uv spread over it', () => {
    const quad = new PlaneGeometry(2, 3).translate(0, 3.5, 0.1);
    const cloth = clothGeometry(quad, 4, 6);
    const pos = cloth.getAttribute('position');
    const uv = cloth.getAttribute('uv');
    const hang = cloth.getAttribute('aHang');
    expect(pos.count).toBe(5 * 7);
    expect(cloth.getIndex()!.count).toBe(4 * 6 * 6);
    for (let k = 0; k < pos.count; k++) {
      expect(pos.getZ(k)).toBeCloseTo(0.1, 6);
      // 0 at the top (y 5), 1 at the bottom (y 2)
      expect(hang.getX(k)).toBeCloseTo((5 - pos.getY(k)) / 3, 6);
      // A plane's uv runs with x and y
      expect(uv.getX(k)).toBeCloseTo((pos.getX(k) + 1) / 2, 6);
      expect(uv.getY(k)).toBeCloseTo((pos.getY(k) - 2) / 3, 6);
    }
  });

  it('keeps any other shape as it is, with how far down each vertex hangs', () => {
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]), 3));
    const cloth = clothGeometry(tri);
    expect(cloth.getAttribute('position').count).toBe(3);
    expect(Array.from(cloth.getAttribute('aHang').array)).toEqual([1, 1, 0]);
  });
});
