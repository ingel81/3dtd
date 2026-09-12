import { afterEach, describe, expect, it } from 'vitest';
import {
  CorridorStations,
  corridorConfig,
  corridorHalfWidth,
  estimateStreetWidth,
  fitCorridorPieces,
  getRouteProfile,
  closeShortDips,
  cutShortBulges,
  lateralLimit,
  resetCorridorConfig,
  routeHalfWidths,
  setCorridorConfig,
} from './route-corridor';
import { METERS_PER_DEGREE_LAT } from './geo-utils';
import type { RouteWaypoint } from '../models/game.types';

afterEach(() => resetCorridorConfig());

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

  it('reads the table in use', () => {
    corridorConfig.highwayWidths['residential'] = 7;
    expect(estimateStreetWidth({ type: 'residential' }).widthM).toBe(7);
  });
});

describe('corridorHalfWidth', () => {
  it('halves the street width', () => {
    expect(corridorHalfWidth(8)).toBe(4);
  });

  it('never goes below the minimum or above the maximum', () => {
    expect(corridorHalfWidth(2)).toBe(corridorConfig.minHalfWidth);
    expect(corridorHalfWidth(40)).toBe(corridorConfig.maxHalfWidth);
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
    expect(routeHalfWidths([null, { type: 'footway' }])).toEqual([corridorConfig.defaultHalfWidth, 1]);
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

  it('bridges longer dips when the dip length is raised', () => {
    // A 6 m van on 2 m stations covers three of them.
    expect(closeShortDips([7, 7, 3, 3, 3, 7, 7])).toEqual([7, 7, 3, 3, 3, 7, 7]);
    corridorConfig.dipLength = 6;
    expect(closeShortDips([7, 7, 3, 3, 3, 7, 7])).toEqual([7, 7, 7, 7, 7, 7, 7]);
  });
});

describe('cutShortBulges', () => {
  it('cuts a bulge of up to 8 m, a driveway or a gap between houses', () => {
    expect(cutShortBulges([3, 3, 3, 7, 7, 3, 3, 3])).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(cutShortBulges([3, 3, 7, 7, 7, 7, 3, 3])).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('keeps a longer widening at its full length', () => {
    expect(cutShortBulges([3, 3, 7, 7, 7, 7, 7, 3, 3])).toEqual([3, 3, 7, 7, 7, 7, 7, 3, 3]);
  });

  it('leaves unmeasured stations unknown', () => {
    expect(cutShortBulges([3, NaN, 3, 3])[1]).toBeNaN();
  });
});

describe('fitCorridorPieces', () => {
  /** A segment on a street with the same free space at every station on each side. */
  const measured = (left: number[], right: number[], fallback = 2.75, onStreet = true): CorridorStations =>
    ({ left, right, fallback, onStreet });

  it('widens each side to the free space the tiles show, up to the maximum', () => {
    // A 5.5 m residential street: 2.75 m from OSM, but the tiles show a
    // parking lane and a pavement on the right up to a facade at 5.2 m,
    // less the 0.5 m wall margin, and open front gardens on the left.
    expect(fitCorridorPieces([measured([7, 7, 7], [5.2, 5.2, 5.2])])).toEqual([[{ t: 0, left: 7, right: 4.5 }]]);
  });

  it('narrows a side to the free space, rounded down, never below half a cell', () => {
    expect(fitCorridorPieces([measured([2.9, 2.9, 2.9], [0.4, 0.4, 0.4], 4)])).toEqual([[{ t: 0, left: 2, right: 1 }]]);
  });

  it('keeps the wall margin off a wall, not off open space', () => {
    corridorConfig.wallMargin = 0;
    expect(fitCorridorPieces([measured([7, 7], [5.2, 5.2])])).toEqual([[{ t: 0, left: 7, right: 5 }]]);
    corridorConfig.wallMargin = 1;
    expect(fitCorridorPieces([measured([7, 7], [5.2, 5.2])])).toEqual([[{ t: 0, left: 7, right: 4 }]]);
  });

  it('keeps the street width at stations it could not measure', () => {
    expect(fitCorridorPieces([measured([NaN, NaN], [NaN, NaN], 4)])).toEqual([[{ t: 0, left: 4, right: 4 }]]);
    expect(fitCorridorPieces([{ left: [], right: [], fallback: 4, onStreet: true }])).toEqual([[{ t: 0, left: 4, right: 4 }]]);
  });

  it('lets the tiles only narrow the leg off the network', () => {
    const offStreet = (free: number) => measured([free, free, free], [free, free, free], 2.75, false);
    expect(fitCorridorPieces([offStreet(7)])).toEqual([[{ t: 0, left: 2.75, right: 2.75 }]]);
    expect(fitCorridorPieces([offStreet(2.2)])).toEqual([[{ t: 0, left: 1.5, right: 1.5 }]]);
  });

  it('splits a segment where the width changes and merges equal runs', () => {
    const left = [3, 3, 3, 3, 3, 6, 6, 6, 6, 6];
    expect(fitCorridorPieces([measured(left, left.map(() => 4))])).toEqual([[
      { t: 0, left: 2.5, right: 3.5 },
      { t: 0.5, left: 5.5, right: 3.5 },
    ]]);
  });

  it('smooths along the route, across its waypoints', () => {
    // A van right at a waypoint: two short dips that are one.
    const vanAtNode = fitCorridorPieces([measured([7, 7, 7, 3], [7, 7, 7, 7]), measured([3, 7, 7, 7], [7, 7, 7, 7])]);
    expect(vanAtNode).toEqual([[{ t: 0, left: 7, right: 7 }], [{ t: 0, left: 7, right: 7 }]]);
    // A driveway right at a waypoint.
    const gapAtNode = fitCorridorPieces([measured([3, 3, 3, 7], [3, 3, 3, 3]), measured([7, 3, 3, 3], [3, 3, 3, 3])]);
    expect(gapAtNode).toEqual([[{ t: 0, left: 2.5, right: 2.5 }], [{ t: 0, left: 2.5, right: 2.5 }]]);
  });

  it('follows the configured limits', () => {
    corridorConfig.maxHalfWidth = 5;
    corridorConfig.widthStep = 1;
    expect(fitCorridorPieces([measured([7, 7, 7], [4.8, 4.8, 4.8])])).toEqual([[{ t: 0, left: 5, right: 4 }]]);
  });
});

describe('lateralLimit', () => {
  it('keeps half a cell diagonal off the corridor edge', () => {
    expect(corridorConfig.edgeMargin).toBeGreaterThanOrEqual(Math.SQRT2);
    expect(lateralLimit(4)).toBe(4 - corridorConfig.edgeMargin);
  });

  it('lets enemies walk the centre line at a bottleneck', () => {
    expect(lateralLimit(corridorConfig.minHalfWidth)).toBe(0);
    expect(lateralLimit(2)).toBeGreaterThan(0);
  });
});

describe('getRouteProfile', () => {
  /** Waypoints `metres` apart going north, half widths per segment on the right and, unless given, the same on the left. */
  function northbound(lengths: number[], right: (number | undefined)[], left = right): RouteWaypoint[] {
    const path: RouteWaypoint[] = [{ lat: 0, lon: 0, corridorLeft: left[0], corridorRight: right[0] }];
    let lat = 0;
    for (let i = 0; i < lengths.length; i++) {
      lat += lengths[i] / METERS_PER_DEGREE_LAT;
      path.push({ lat, lon: 0, corridorLeft: left[i + 1], corridorRight: right[i + 1] });
    }
    return path;
  }

  it('is computed once per path and shared', () => {
    const path = northbound([10], [4]);
    expect(getRouteProfile(path)).toBe(getRouteProfile(path));
  });

  it('uses the default width where the route carries none', () => {
    const profile = getRouteProfile(northbound([10], [undefined]));
    expect(profile.right.segment[0]).toBe(lateralLimit(corridorConfig.defaultHalfWidth));
    expect(profile.left.segment[0]).toBe(lateralLimit(corridorConfig.defaultHalfWidth));
  });

  it('keeps the two sides apart', () => {
    const profile = getRouteProfile(northbound([50, 50], [6, 6], [2, 5]));
    expect(profile.right.segment[0]).toBe(lateralLimit(6));
    expect(profile.left.segment[0]).toBe(lateralLimit(2));
    expect(profile.left.segment[1]).toBe(lateralLimit(5));
    // The narrow left start holds the left side back at the waypoint, not the right.
    expect(profile.left.node[1]).toBe(lateralLimit(2));
    expect(profile.right.node[1]).toBe(lateralLimit(6));
  });

  it('sums the segment lengths', () => {
    const profile = getRouteProfile(northbound([10, 20], [4, 4]));
    expect(profile.segmentLengths[0]).toBeCloseTo(10, 1);
    expect(profile.cumulativeLength[2]).toBeCloseTo(30, 1);
    expect(profile.totalLength).toBeCloseTo(30, 1);
  });

  it('lets a waypoint allow no more than its tighter segment', () => {
    const profile = getRouteProfile(northbound([50, 50], [6, 2]));
    expect(profile.right.node[1]).toBe(lateralLimit(2));
  });

  it('tapers the wide side towards a narrowing', () => {
    // 50 m wide, then 50 m narrow: the start of the wide segment is far
    // enough away to keep its full room, the end has to meet the narrow one.
    const profile = getRouteProfile(northbound([50, 50], [6, 2]));
    const { segment, node } = profile.right;
    const taper = profile.taper;
    expect(node[0]).toBe(lateralLimit(6));
    const wideAt = (s: number) => Math.min(segment[0], node[0] + taper * s, node[1] + taper * (50 - s));
    // The envelope never rises faster than the taper allows.
    for (let s = 0; s < 50; s += 0.5) {
      expect(Math.abs(wideAt(s + 0.5) - wideAt(s))).toBeLessThanOrEqual(taper * 0.5 + 1e-9);
    }
    expect(wideAt(50)).toBeCloseTo(lateralLimit(2), 6);
  });

  it('carries a narrow spot across short segments', () => {
    // A 2 m segment next to a narrow one cannot recover its full width.
    const profile = getRouteProfile(northbound([50, 2, 50], [2, 6, 6]));
    expect(profile.right.node[2]).toBeCloseTo(lateralLimit(2) + profile.taper * profile.segmentLengths[1], 6);
  });

  it('builds with the taper in use', () => {
    corridorConfig.taper = 0.25;
    expect(getRouteProfile(northbound([10], [4])).taper).toBe(0.25);
  });

  it('handles paths too short to have a segment', () => {
    expect(getRouteProfile([]).totalLength).toBe(0);
    expect(getRouteProfile([{ lat: 1, lon: 1 }]).segmentLengths).toEqual([]);
  });
});

describe('setCorridorConfig', () => {
  it('applies the values and adds to the street width table', () => {
    expect(setCorridorConfig({ maxHalfWidth: 8, bulgeLength: 12, highwayWidths: { residential: 7 } })).toEqual([]);
    expect(corridorConfig.maxHalfWidth).toBe(8);
    expect(corridorConfig.bulgeLength).toBe(12);
    expect(corridorConfig.highwayWidths['residential']).toBe(7);
    expect(corridorConfig.highwayWidths['primary']).toBe(8);
  });

  it('changes nothing when a key is unknown or a value out of range', () => {
    const problems = setCorridorConfig({ maxHalfWidth: 9, bogus: 1, taper: -1 } as never);
    expect(problems).toEqual(['unknown setting bogus', 'taper must be a number from 0.05 to 5']);
    expect(corridorConfig.maxHalfWidth).toBe(7);
    expect(setCorridorConfig({ highwayWidths: { residential: 'wide' } } as never)).toHaveLength(1);
    expect(corridorConfig.highwayWidths['residential']).toBe(5.5);
  });

  it('keeps enemies at the edge inside the cells', () => {
    expect(setCorridorConfig({ edgeMargin: 1 })).toHaveLength(1);
    expect(corridorConfig.edgeMargin).toBe(1.5);
  });

  it('refuses a minimum above the maximum', () => {
    expect(setCorridorConfig({ minHalfWidth: 6, maxHalfWidth: 5 })).toEqual(['minHalfWidth must not be above maxHalfWidth']);
  });

  it('moves the default into a narrower range unless it is set with it', () => {
    expect(setCorridorConfig({ maxHalfWidth: 4 })).toEqual([]);
    expect(corridorConfig.defaultHalfWidth).toBe(4);
    expect(setCorridorConfig({ maxHalfWidth: 3, defaultHalfWidth: 3.5 })).toHaveLength(1);
    expect(corridorConfig.maxHalfWidth).toBe(4);
  });
});
