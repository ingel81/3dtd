import { describe, expect, it } from 'vitest';
import {
  CORRIDOR_DEFAULT_HALF_WIDTH_M,
  CORRIDOR_MAX_HALF_WIDTH_M,
  CORRIDOR_MIN_HALF_WIDTH_M,
  LATERAL_EDGE_MARGIN_M,
  LATERAL_TAPER,
  corridorHalfWidth,
  estimateStreetWidth,
  getRouteProfile,
  clearancePieces,
  closeShortDips,
  lateralLimit,
  routeHalfWidths,
} from './route-corridor';
import { METERS_PER_DEGREE_LAT } from './geo-utils';
import type { RouteWaypoint } from '../models/game.types';

describe('estimateStreetWidth', () => {
  it('takes the width tag first', () => {
    expect(estimateStreetWidth({ type: 'residential', width: 9, lanes: 1 })).toEqual({ widthM: 9, source: 'width' });
  });

  it('derives the width from lanes when there is no width tag', () => {
    expect(estimateStreetWidth({ type: 'primary', lanes: 2 })).toEqual({ widthM: 7, source: 'lanes' });
  });

  it('falls back to the highway class', () => {
    expect(estimateStreetWidth({ type: 'primary' })).toEqual({ widthM: 8, source: 'highway' });
    expect(estimateStreetWidth({ type: 'residential' })).toEqual({ widthM: 5.5, source: 'highway' });
    expect(estimateStreetWidth({ type: 'footway' })).toEqual({ widthM: 2, source: 'highway' });
  });

  it('has a value for highway classes it does not list', () => {
    expect(estimateStreetWidth({ type: 'raceway' }).widthM).toBeGreaterThan(0);
  });
});

describe('corridorHalfWidth', () => {
  it('halves the street width', () => {
    expect(corridorHalfWidth(8)).toBe(4);
  });

  it('never goes below two cells or above the old radius', () => {
    expect(corridorHalfWidth(2)).toBe(CORRIDOR_MIN_HALF_WIDTH_M);
    expect(corridorHalfWidth(40)).toBe(CORRIDOR_MAX_HALF_WIDTH_M);
  });
});

describe('routeHalfWidths', () => {
  it('gives each segment the half width of its street', () => {
    expect(routeHalfWidths([{ type: 'primary' }, { type: 'residential', width: 12 }])).toEqual([4, 6]);
  });

  it('keeps the width of the street before a stretch off the network', () => {
    expect(routeHalfWidths([{ type: 'primary' }, null, null])).toEqual([4, 4, 4]);
  });

  it('uses the default before any street', () => {
    expect(routeHalfWidths([null, { type: 'footway' }])).toEqual([CORRIDOR_DEFAULT_HALF_WIDTH_M, 2]);
  });
});

describe('closeShortDips', () => {
  it('drops a dip shorter than three stations', () => {
    expect(closeShortDips([7, 7, 1, 7, 7])).toEqual([7, 7, 7, 7, 7]);
    expect(closeShortDips([7, 7, 1, 1, 7, 7])).toEqual([7, 7, 7, 7, 7, 7]);
  });

  it('keeps a narrowing of three stations or more at its full length', () => {
    expect(closeShortDips([7, 7, 3, 3, 3, 7, 7])).toEqual([7, 7, 3, 3, 3, 7, 7]);
  });

  it('leaves unmeasured stations unknown and ignores them for the neighbours', () => {
    const closed = closeShortDips([7, NaN, 3, 3, 3, 7]);
    expect(closed[1]).toBeNaN();
    expect(closed.slice(2)).toEqual([3, 3, 3, 7]);
  });
});

describe('clearancePieces', () => {
  it('keeps the street width where the tiles leave more room', () => {
    expect(clearancePieces(4, [7, 7, 7])).toEqual([{ t: 0, halfWidth: 4 }]);
    // A ray without a hit reports the street half width; it must not round down.
    expect(clearancePieces(2.75, [2.75, 2.75])).toEqual([{ t: 0, halfWidth: 2.75 }]);
  });

  it('narrows to the free space where it is less, rounded down to 0.5 m', () => {
    expect(clearancePieces(4, [7, 7, 2.9, 2.9, 2.9, 2.9, 7, 7])).toEqual([
      { t: 0, halfWidth: 4 },
      { t: 2 / 8, halfWidth: 2.5 },
      { t: 6 / 8, halfWidth: 4 },
    ]);
  });

  it('never goes below two cells', () => {
    expect(clearancePieces(4, [0.4, 0.4, 0.4])).toEqual([{ t: 0, halfWidth: CORRIDOR_MIN_HALF_WIDTH_M }]);
  });

  it('keeps the street width at stations it could not measure', () => {
    expect(clearancePieces(4, [NaN, NaN])).toEqual([{ t: 0, halfWidth: 4 }]);
  });
});

describe('lateralLimit', () => {
  it('keeps half a cell diagonal off the corridor edge', () => {
    expect(LATERAL_EDGE_MARGIN_M).toBeGreaterThanOrEqual(Math.SQRT2);
    expect(lateralLimit(4)).toBe(4 - LATERAL_EDGE_MARGIN_M);
  });

  it('leaves room to spread even in the narrowest corridor', () => {
    expect(lateralLimit(CORRIDOR_MIN_HALF_WIDTH_M)).toBeGreaterThan(0);
  });
});

describe('getRouteProfile', () => {
  /** Waypoints `metres` apart going north, with the given half widths per segment. */
  function northbound(lengths: number[], halfWidths: (number | undefined)[]): RouteWaypoint[] {
    const path: RouteWaypoint[] = [{ lat: 0, lon: 0, corridorHalfWidth: halfWidths[0] }];
    let lat = 0;
    for (let i = 0; i < lengths.length; i++) {
      lat += lengths[i] / METERS_PER_DEGREE_LAT;
      path.push({ lat, lon: 0, corridorHalfWidth: halfWidths[i + 1] });
    }
    return path;
  }

  it('is computed once per path and shared', () => {
    const path = northbound([10], [4]);
    expect(getRouteProfile(path)).toBe(getRouteProfile(path));
  });

  it('uses the default width where the route carries none', () => {
    const profile = getRouteProfile(northbound([10], [undefined]));
    expect(profile.segmentLimit[0]).toBe(lateralLimit(CORRIDOR_DEFAULT_HALF_WIDTH_M));
  });

  it('sums the segment lengths', () => {
    const profile = getRouteProfile(northbound([10, 20], [4, 4]));
    expect(profile.segmentLengths[0]).toBeCloseTo(10, 1);
    expect(profile.cumulativeLength[2]).toBeCloseTo(30, 1);
    expect(profile.totalLength).toBeCloseTo(30, 1);
  });

  it('lets a waypoint allow no more than its tighter segment', () => {
    const profile = getRouteProfile(northbound([50, 50], [6, 2]));
    expect(profile.nodeLimit[1]).toBe(lateralLimit(2));
  });

  it('tapers the wide side towards a narrowing', () => {
    // 50 m wide, then 50 m narrow: the start of the wide segment is far
    // enough away to keep its full room, the end has to meet the narrow one.
    const profile = getRouteProfile(northbound([50, 50], [6, 2]));
    expect(profile.nodeLimit[0]).toBe(lateralLimit(6));
    const wideAt = (s: number) =>
      Math.min(profile.segmentLimit[0], profile.nodeLimit[0] + LATERAL_TAPER * s, profile.nodeLimit[1] + LATERAL_TAPER * (50 - s));
    // The envelope never rises faster than the taper allows.
    for (let s = 0; s < 50; s += 0.5) {
      expect(Math.abs(wideAt(s + 0.5) - wideAt(s))).toBeLessThanOrEqual(LATERAL_TAPER * 0.5 + 1e-9);
    }
    expect(wideAt(50)).toBeCloseTo(lateralLimit(2), 6);
  });

  it('carries a narrow spot across short segments', () => {
    // A 2 m segment next to a narrow one cannot recover its full width.
    const profile = getRouteProfile(northbound([50, 2, 50], [2, 6, 6]));
    expect(profile.nodeLimit[2]).toBeCloseTo(lateralLimit(2) + LATERAL_TAPER * profile.segmentLengths[1], 6);
  });

  it('handles paths too short to have a segment', () => {
    expect(getRouteProfile([]).totalLength).toBe(0);
    expect(getRouteProfile([{ lat: 1, lon: 1 }]).segmentLengths).toEqual([]);
  });
});
