import { describe, expect, it } from 'vitest';
import { frameKey, KEY_STEP_M, movedBy, zoomForSide } from './osm-frame-view';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

/** The frame's map under a square that keeps its size on the screen (E282) */
describe('OSM frame view', () => {
  it('zooms so the side spans the square on the screen: twice the side is one zoom out', () => {
    const lat = 49.7;
    const z = zoomForSide(2400, lat, 300);
    expect(zoomForSide(1200, lat, 300)).toBeCloseTo(z + 1, 9);
    expect(zoomForSide(2400, lat, 600)).toBeCloseTo(z + 1, 9);
    // At that zoom the side's metres per pixel are Web Mercator's (512 px world at zoom 0)
    const metresPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);
    expect(metresPerPx * 300).toBeCloseTo(2400, 6);
    // A 1.2 to 2.4 km square over a few hundred pixels sits well inside the map's zoom range (11 to 18)
    expect(z).toBeGreaterThan(11);
    expect(zoomForSide(1200, lat, 420)).toBeLessThan(18);
  });

  it('moves a point by metres east and north', () => {
    const at = { lat: 49.7, lon: 9.26 };
    const to = movedBy(at, 100, -200);
    expect((to.lat - at.lat) * METERS_PER_DEGREE_LAT).toBeCloseTo(-200, 6);
    expect((to.lon - at.lon) * METERS_PER_DEGREE_LAT * Math.cos((at.lat * Math.PI) / 180)).toBeCloseTo(100, 6);
  });

  it('arrows move the map a step (five with Shift), plus and minus size the square, other keys pass', () => {
    expect(frameKey('ArrowUp')).toEqual({ east: 0, north: KEY_STEP_M });
    expect(frameKey('ArrowLeft', true)).toEqual({ east: -5 * KEY_STEP_M, north: 0 });
    expect(frameKey('+')).toEqual({ side: 1 });
    expect(frameKey('=')).toEqual({ side: 1 });
    expect(frameKey('-')).toEqual({ side: -1 });
    expect(frameKey('a')).toBeNull();
    expect(frameKey('Tab')).toBeNull();
  });
});
