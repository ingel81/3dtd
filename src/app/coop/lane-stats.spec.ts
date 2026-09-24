import { describe, it, expect } from 'vitest';
import { laneStats } from './lane-stats';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';

const north = (m: number) => [{ lat: 0, lon: 0 }, { lat: m / 2 / METERS_PER_DEGREE_LAT, lon: 0 }, { lat: m / METERS_PER_DEGREE_LAT, lon: 0 }];

describe('laneStats', () => {
  it('gives each lane its length, walking time and share of the longest', () => {
    const stats = laneStats(new Map([['spawn-1', north(1000)], ['spawn-2', north(500)]]), 5);
    expect(stats.get('spawn-1')!.meters).toBeCloseTo(1000, -1);
    expect(stats.get('spawn-1')!.seconds).toBeCloseTo(200, -1);
    expect(stats.get('spawn-1')!.share).toBe(1);
    expect(stats.get('spawn-2')!.share).toBeCloseTo(0.5, 2);
  });

  it('gives a route without length 0 everywhere', () => {
    expect(laneStats(new Map([['spawn-1', [{ lat: 1, lon: 1 }]]]), 5).get('spawn-1')).toEqual({ meters: 0, seconds: 0, share: 0 });
  });
});
