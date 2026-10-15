import { boxDistance, groundRing, toModel } from './object-ground';
import { seatHeight } from './render/objects/object-seat';

describe('object ground: disc and turned rectangle', () => {
  const school = { x: 10, y: -5, rotation: 0.7, scale: 1 };
  const box = [0, 1.3, 20.9, 7.6] as const;

  it('turns the rectangle with the model and keeps its points in the disc', () => {
    const ring = groundRing(20.9, box, school);
    expect(ring.length).toBe(16);
    const c = Math.cos(school.rotation);
    const s = Math.sin(school.rotation);
    for (let k = 0; k < 16; k += 2) {
      const m = toModel(ring[k] - school.x, ring[k + 1] - school.y, c, s);
      expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(20.9 + 1e-9);
      expect(boxDistance(box, 1, ring[k] - school.x, ring[k + 1] - school.y, c, s)).toBeLessThan(1e-9);
    }
    // The side middles across the depth lie on the long sides, 7.6 m off the middle (the disc: 20.9 m)
    const front = toModel(ring[2 * 2] - school.x, ring[2 * 2 + 1] - school.y, c, s);
    expect(front.z).toBeCloseTo(1.3 + 7.6, 9);
    expect(front.x).toBeCloseTo(0, 9);
  });

  it('seats a long building on a slope across it by its sides, not by the disc of half its length', () => {
    // Ground falls 0.2 m per metre to the south (map -y); the school's long side runs east-west
    const ground = (_x: number, y: number) => 20 + 0.2 * y;
    const o = { id: 'o', asset: 'school', x: 0, y: 0, z: 0, rotation: 0, scale: 1 };
    const withBox = seatHeight({ category: 'building', footprint: 20.9, height: 14, box }, o, ground, () => null);
    const disc = seatHeight({ category: 'building', footprint: 20.9, height: 14 }, o, ground, () => null);
    // The lowest side 7.6 - 1.3 m south of the middle, the disc reached 20.9 m: 4 m deeper
    expect(withBox).toBeCloseTo(20 - 0.2 * (7.6 - 1.3), 6);
    expect(disc).toBeCloseTo(20 - 0.2 * 20.9, 6);
  });
});
