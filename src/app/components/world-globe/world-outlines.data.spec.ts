import { describe, it, expect } from 'vitest';
import { BORDERS, COASTLINES, OUTLINE_FACTOR } from './world-outlines.data';
import { decodePolyline } from './globe-projection';

/** The generated outlines decode to plausible coordinates (tools/world-outlines/build.mjs) */
describe('world outlines data', () => {
  for (const [name, lines] of [['coastlines', COASTLINES], ['borders', BORDERS]] as const) {
    it(`${name}: every line decodes to at least two points on the globe`, () => {
      expect(lines.length).toBeGreaterThan(100);
      for (const line of lines) {
        const pts = decodePolyline(line, OUTLINE_FACTOR);
        expect(pts.length).toBeGreaterThanOrEqual(4);
        for (let i = 0; i < pts.length; i += 2) {
          expect(Math.abs(pts[i])).toBeLessThanOrEqual(90);
          expect(Math.abs(pts[i + 1])).toBeLessThanOrEqual(180);
        }
      }
    });
  }

  it('finds known coasts: the Strait of Gibraltar and Cape Horn are near a coastline point', () => {
    const all = COASTLINES.flatMap((l) => decodePolyline(l, OUTLINE_FACTOR));
    const near = (lat: number, lon: number, deg: number) => {
      for (let i = 0; i < all.length; i += 2) {
        if (Math.abs(all[i] - lat) <= deg && Math.abs(all[i + 1] - lon) <= deg) return true;
      }
      return false;
    };
    expect(near(36.0, -5.6, 1)).toBe(true);
    expect(near(-55.9, -67.3, 1.5)).toBe(true);
    // the middle of the Pacific has no coast
    expect(near(-40, -130, 5)).toBe(false);
  });
});
