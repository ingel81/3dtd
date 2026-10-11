import { COVERAGE_EDGE_MARGIN_M, coveredSpawnRange, isInsideCoverage } from './world-coverage';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';

/** A point `m` metres north of the center */
const north = (m: number) => ({ lat: 60 + m / METERS_PER_DEGREE_LAT, lon: 25 });
const COVERAGE = { center: { lat: 60, lon: 25 }, radiusM: 1000 };

describe('isInsideCoverage()', () => {
  it('lets everything through without a coverage (Google tiles)', () => {
    expect(isInsideCoverage(null, -33.87, 151.21)).toBe(true);
  });

  it('keeps the edge margin inside the circle', () => {
    const edge = 1000 - COVERAGE_EDGE_MARGIN_M;
    expect(isInsideCoverage(COVERAGE, north(0).lat, 25)).toBe(true);
    expect(isInsideCoverage(COVERAGE, north(edge - 5).lat, 25)).toBe(true);
    expect(isInsideCoverage(COVERAGE, north(edge + 5).lat, 25)).toBe(false);
  });

  it('keeps half the circle usable when the margin would eat more', () => {
    const small = { center: COVERAGE.center, radiusM: 80 };
    expect(isInsideCoverage(small, north(35).lat, 25)).toBe(true);
    expect(isInsideCoverage(small, north(45).lat, 25)).toBe(false);
  });
});

describe('coveredSpawnRange()', () => {
  it('passes the range through without a coverage', () => {
    expect(coveredSpawnRange(null, north(0), 200, 1500)).toEqual({ min: 200, max: 1500 });
  });

  it('caps the far end at the far side of the usable circle, from the HQ', () => {
    // HQ in the middle: 950 m usable
    const middle = coveredSpawnRange(COVERAGE, north(0), 200, 1500);
    expect(middle.min).toBe(200);
    expect(middle.max).toBeCloseTo(950, 6);
    // HQ 500 m off the middle: up to 1450 m away on the far side
    const off = coveredSpawnRange(COVERAGE, north(500), 200, 1500);
    expect(off.min).toBe(200);
    // The haversine and the metres per degree differ by under a metre on 500 m
    expect(Math.abs(off.max - 1450)).toBeLessThan(1);
  });

  it('lowers the near end to half the far end when the cap leaves too little ring', () => {
    const small = { center: COVERAGE.center, radiusM: 700 };
    // 650 m usable: 500 to 1000 becomes 325 to 650
    const range = coveredSpawnRange(small, north(0), 500, 1000);
    expect(range.min).toBeCloseTo(325, 6);
    expect(range.max).toBeCloseTo(650, 6);
  });
});
