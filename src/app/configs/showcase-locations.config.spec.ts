import { describe, it, expect } from 'vitest';
import { SHOWCASE_LOCATIONS } from './showcase-locations.config';

describe('SHOWCASE_LOCATIONS', () => {
  it('stays a short list', () => {
    expect(SHOWCASE_LOCATIONS.length).toBeGreaterThanOrEqual(10);
    expect(SHOWCASE_LOCATIONS.length).toBeLessThanOrEqual(14);
  });

  it('has unique ids and names', () => {
    expect(new Set(SHOWCASE_LOCATIONS.map((p) => p.id)).size).toBe(SHOWCASE_LOCATIONS.length);
    expect(new Set(SHOWCASE_LOCATIONS.map((p) => p.name)).size).toBe(SHOWCASE_LOCATIONS.length);
  });

  it('holds valid coordinates, none at the DevWorld origin', () => {
    for (const p of SHOWCASE_LOCATIONS) {
      expect(Math.abs(p.lat), p.id).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon), p.id).toBeLessThanOrEqual(180);
      expect(p.lat === 0 && p.lon === 0, p.id).toBe(false);
    }
  });

  it('gives every place a one-line hint', () => {
    for (const p of SHOWCASE_LOCATIONS) {
      expect(p.hint.length, p.id).toBeGreaterThan(0);
      expect(p.hint.length, p.id).toBeLessThanOrEqual(48);
      expect(p.hint.includes('\n'), p.id).toBe(false);
    }
  });
});
