import { mapEnvironment, mildTint, TILESETS } from './environment';
import type { W3iInfo } from '../formats/w3i';

describe('w3x map mood', () => {
  it('keeps every tileset tint within 10% of white', () => {
    expect(mildTint('#ffd8c8')).toBe('#ffe6e6');
    expect(mildTint('#fff8ee')).toBe('#fff8ee');
    for (const [letter, mood] of Object.entries(TILESETS)) {
      const n = parseInt(mood.env.tint.slice(1), 16);
      for (const shift of [16, 8, 0]) expect((n >> shift) & 255, letter).toBeGreaterThanOrEqual(0xe6);
    }
  });

  it("takes a map's own fog, at most thin enough to see the playfield", () => {
    const info = (fogEnd: number) => ({ fogStyle: 1, fogStart: 0, fogEnd }) as unknown as W3iInfo;
    // Fog ending at 3000 m: about a tenth left there
    expect(mapEnvironment('L', info(3000 / 0.25), 0.25).fogDensity).toBeCloseTo(0.0005, 6);
    expect(mapEnvironment('L', info(100), 0.25).fogDensity).toBe(0.002);
    expect(mapEnvironment('X', null, 0.25)).toMatchObject({ sky: 'day', sunElevation: 50, tint: '#fff8ee' });
  });
});
