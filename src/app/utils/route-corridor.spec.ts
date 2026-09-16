import { afterEach, describe, expect, it } from 'vitest';
import {
  CorridorPiece,
  CorridorStations,
  closeShortNarrowings,
  corridorConfig,
  corridorHalfWidth,
  estimateStreetWidth,
  fitCorridorPieces,
  fitCorridorStations,
  probeFreeSpace,
  probeLowWall,
  lowRayAlone,
  getRouteProfile,
  closeShortDips,
  cutShortBulges,
  lateralLimit,
  resetCorridorConfig,
  routeHalfWidths,
  runsUnderCover,
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

describe('runsUnderCover', () => {
  it('takes any tunnel value but no, and covered=yes', () => {
    expect(runsUnderCover({ tunnel: 'yes' })).toBe(true);
    expect(runsUnderCover({ tunnel: 'building_passage' })).toBe(true);
    expect(runsUnderCover({ covered: 'yes' })).toBe(true);
    expect(runsUnderCover({})).toBe(false);
    expect(runsUnderCover({ tunnel: 'no', covered: 'no' })).toBe(false);
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

  it('keeps a low wall however short the dip', () => {
    // A parked car on two stations: the low ray hit it, the ground behind the hit is its roof.
    expect(closeShortDips([7, 7, 3, 3, 7, 7], [false, false, true, true, false, false])).toEqual([7, 7, 3, 3, 7, 7]);
    // A lamp post between two of them still goes, to their width.
    expect(closeShortDips([7, 3, 1, 3, 7], [false, true, false, true, false])).toEqual([7, 3, 3, 3, 7]);
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

  it('keeps a car the low ray found on two stations, and closing short narrowings keeps to it', () => {
    // A car 4.5 m long 3.2 m right of the centre line at stations 5 and 6
    // of a 24 m segment; the open stretches either side are longer than
    // bulgeLength, or they would be cut to the car's width.
    const right = [7, 7, 7, 7, 7, 3.2, 3.2, 7, 7, 7, 7, 7];
    const car = measured(right.map(() => 7), right);
    const segment: CorridorStations = { ...car, lowWallRight: right.map((d) => d < 7) };
    const pieces = fitCorridorPieces([segment]);
    expect(pieces).toEqual([[
      { t: 0, left: 7, right: 7 },
      { t: 5 / 12, left: 7, right: 2.5, maxRight: 2.5 },
      { t: 7 / 12, left: 7, right: 7 },
    ]]);
    expect(closeShortNarrowings(pieces, [24], [false])).toEqual([[
      { t: 0, left: 7, right: 7 },
      { t: 5 / 12, left: 7, right: 2.5 },
      { t: 7 / 12, left: 7, right: 7 },
    ]]);
    // The same dip from both rays, a wall on two stations, is closed.
    expect(fitCorridorPieces([car])).toEqual([[{ t: 0, left: 7, right: 7 }]]);
  });
});

describe('fitCorridorStations', () => {
  const measured = (left: number[], right: number[], fallback = 2.75, onStreet = true): CorridorStations =>
    ({ left, right, fallback, onStreet });
  /** The fit of station `k` on the left of a single segment. */
  const leftAt = (segment: CorridorStations, k: number) => fitCorridorStations([segment]).left[0][k];

  it('names the rule that set each half width', () => {
    expect(leftAt(measured([7, 7, 7], [7, 7, 7]), 1))
      .toEqual({ free: 7, smoothed: 7, halfWidth: 7, rule: 'no wall within the maximum' });
    expect(leftAt(measured([5.2, 5.2, 5.2], [7, 7, 7]), 1)).toMatchObject({ halfWidth: 4.5, rule: 'wall less margin' });
    expect(leftAt(measured([0.4, 0.4, 0.4], [7, 7, 7]), 1)).toMatchObject({ halfWidth: 1, rule: 'wall less margin, minimum' });
    expect(leftAt(measured([NaN, NaN], [7, 7], 4), 0)).toMatchObject({ halfWidth: 4, rule: 'unmeasured: street width' });
    expect(leftAt(measured([7, 7, 7], [7, 7, 7], 2.75, false), 1))
      .toMatchObject({ halfWidth: 2.75, rule: 'no wall within the maximum, leg to the HQ: street width' });
  });

  it('shows what the smoothing did', () => {
    // A driveway: two open stations between walls at 3 m.
    expect(leftAt(measured([3, 3, 3, 7, 7, 3, 3, 3], [3, 3, 3, 3, 3, 3, 3, 3]), 3))
      .toEqual({ free: 7, smoothed: 3, halfWidth: 2.5, rule: 'bulge cut, wall less margin' });
    // A lamp post in the open.
    expect(leftAt(measured([7, 7, 1, 7, 7], [7, 7, 7, 7, 7]), 2))
      .toEqual({ free: 1, smoothed: 7, halfWidth: 7, rule: 'dip closed, no wall within the maximum' });
  });

  it('gives a short unmeasured gap the free space measured around it', () => {
    // A seam between two tile meshes: the column under one station finds no tile.
    expect(leftAt(measured([7, 7, NaN, 7, 7], [7, 7, NaN, 7, 7]), 2)).toEqual({
      free: NaN, smoothed: 7, halfWidth: 7, rule: 'unmeasured: from neighbours, no wall within the maximum',
    });
    // The narrower side of the gap, two stations long.
    expect(leftAt(measured([7, 7, NaN, NaN, 5.2, 5.2, 5.2], [7, 7, 7, 7, 7, 7, 7]), 3))
      .toMatchObject({ smoothed: 5.2, halfWidth: 4.5, rule: 'unmeasured: from neighbours, wall less margin' });
    // At an end of the route, the one measured side.
    expect(leftAt(measured([NaN, 5.2, 5.2, 5.2], [7, 7, 7, 7]), 0)).toMatchObject({ halfWidth: 4.5 });
  });

  it('keeps the street width in a longer unmeasured gap', () => {
    const segment = measured([7, NaN, NaN, NaN, 7], [7, NaN, NaN, NaN, 7], 2.75);
    expect(fitCorridorStations([segment]).left[0].map((s) => s.halfWidth)).toEqual([7, 2.75, 2.75, 2.75, 7]);
    expect(leftAt(segment, 2).rule).toBe('unmeasured: street width');
    // The gap length follows dipLength.
    corridorConfig.dipLength = 6;
    expect(fitCorridorStations([segment]).left[0].map((s) => s.halfWidth)).toEqual([7, 7, 7, 7, 7]);
  });

  it('fills a gap across waypoints', () => {
    const fit = fitCorridorStations([measured([7, 7, NaN], [7, 7, NaN]), measured([7, 7], [7, 7])]);
    expect(fit.left[0][2]).toMatchObject({ halfWidth: 7, rule: 'unmeasured: from neighbours, no wall within the maximum' });
    expect(fitCorridorPieces([measured([7, 7, NaN], [7, 7, NaN]), measured([7, 7], [7, 7])]))
      .toEqual([[{ t: 0, left: 7, right: 7 }], [{ t: 0, left: 7, right: 7 }]]);
  });

  it('names a low wall and cuts a gap between two parked cars like a driveway', () => {
    // Cars 3.2 m right on stations 0 to 2 and 5 to 7, a 4 m gap on 3 and 4.
    const right = [3.2, 3.2, 3.2, 7, 7, 3.2, 3.2, 3.2];
    const fit = fitCorridorStations([{ ...measured(right.map(() => 7), right), lowWallRight: right.map((d) => d < 7) }]);
    expect(fit.right[0].map((s) => s.halfWidth)).toEqual([2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5]);
    expect(fit.right[0][1].rule).toBe('low obstacle, raised behind, wall less margin');
    expect(fit.right[0][3].rule).toBe('bulge cut, wall less margin');
  });

  it('gives the same half widths the pieces are made of', () => {
    const segments = [measured([3, 3, 3, 3, 3, 6, 6, 6, 6, 6], [4, 4, 4, 4, 4, 4, 4, 4, 4, 4])];
    const fit = fitCorridorStations(segments);
    expect(fit.left[0].map((s) => s.halfWidth)).toEqual([2.5, 2.5, 2.5, 2.5, 2.5, 5.5, 5.5, 5.5, 5.5, 5.5]);
    expect(fitCorridorPieces(segments)).toEqual([[{ t: 0, left: 2.5, right: 3.5 }, { t: 0.5, left: 5.5, right: 3.5 }]]);
  });
});

describe('closeShortNarrowings', () => {
  const piece = (t: number, left: number, right = left): CorridorPiece => ({ t, left, right });

  it('widens a stretch narrower than both sides for up to dipLength to the narrower side', () => {
    // A 2 m piece at the street width inside a 20 m segment the tiles show open.
    const pieces = [[piece(0, 7), piece(0.5, 2.75), piece(0.6, 7)]];
    expect(closeShortNarrowings(pieces, [20], [false])).toEqual([[piece(0, 7)]]);
    // Open on one side, a wall on the other.
    expect(closeShortNarrowings([[piece(0, 7), piece(0.5, 2.75), piece(0.6, 4.5)]], [20], [false]))
      .toEqual([[piece(0, 7), piece(0.5, 4.5)]]);
  });

  it('widens a short segment between wider ones, each side on its own', () => {
    const pieces = [[piece(0, 2.75)], [piece(0, 1, 2.75)], [piece(0, 2.75)]];
    expect(closeShortNarrowings(pieces, [50, 3, 50], [false, false, false]))
      .toEqual([[piece(0, 2.75)], [piece(0, 2.75)], [piece(0, 2.75)]]);
  });

  it('keeps a longer narrowing, one at an end of the route and a tunnel', () => {
    const long = [[piece(0, 7), piece(0.4, 2, 7), piece(0.6, 7)]];
    expect(closeShortNarrowings(long, [30], [false])).toEqual(long);
    const atEnd = [[piece(0, 7)], [piece(0, 1)]];
    expect(closeShortNarrowings(atEnd, [50, 3], [false, false])).toEqual(atEnd);
    const tunnel = [[piece(0, 7)], [piece(0, 1)], [piece(0, 7)]];
    expect(closeShortNarrowings(tunnel, [50, 3, 50], [false, true, false])).toEqual(tunnel);
  });

  it('follows dipLength', () => {
    const pieces = [[piece(0, 7), piece(0.4, 2), piece(0.6, 7)]];
    expect(closeShortNarrowings(pieces, [30], [false])).toEqual(pieces);
    corridorConfig.dipLength = 6;
    expect(closeShortNarrowings(pieces, [30], [false])).toEqual([[piece(0, 7)]]);
  });

  it('widens a stretch no further than its walk cap', () => {
    // The street width of an unmeasured station, with a car 5.1 m left.
    const pieces = [[piece(0, 7), { ...piece(0.5, 2.75), maxLeft: 5 }, piece(0.6, 7)]];
    expect(closeShortNarrowings(pieces, [20], [false])).toEqual([[piece(0, 7), piece(0.5, 5, 7), piece(0.6, 7)]]);
  });
});

describe('probeFreeSpace', () => {
  it('takes the farther first hit, since a wall stops every ray', () => {
    expect(probeFreeSpace({ unmeasured: null, tileError: 2, left: [2, 6], right: [7, 3] }, 'left')).toBe(6);
    expect(probeFreeSpace({ unmeasured: null, tileError: 2, left: [2, 6], right: [7, 3] }, 'right')).toBe(7);
  });

  it('is unknown without a measurement', () => {
    expect(probeFreeSpace({ unmeasured: 'coarse tile', tileError: 20, left: [], right: [] }, 'left')).toBeNaN();
    expect(probeFreeSpace(null, 'right')).toBeNaN();
  });

  it('takes the outer face of upper floors that jut out a little over the ground floor', () => {
    const probe = (low: number, high: number) => ({ unmeasured: null, tileError: 2, left: [low, high], right: [7, 7] });
    // A jetty 0.6 m in front of the ground floor facade at 4 m.
    expect(probeFreeSpace(probe(4, 3.4), 'left')).toBe(3.4);
    // A balcony or a crown 1.5 m out in front of it: the facade.
    expect(probeFreeSpace(probe(5, 3.5), 'left')).toBe(5);
    // A car 0.6 m in front of a facade stops the low ray: the facade.
    expect(probeFreeSpace(probe(3.4, 4), 'left')).toBe(4);
    // Only the high ray hit.
    expect(probeFreeSpace(probe(7, 6.5), 'left')).toBe(7);

    const depth = corridorConfig.overhangDepth;
    corridorConfig.overhangDepth = 0;
    try {
      expect(probeFreeSpace(probe(4, 3.4), 'left')).toBe(4);
    } finally {
      corridorConfig.overhangDepth = depth;
    }
  });

  it('takes the low hit where the ground behind it is raised', () => {
    const probe = (rise: number) => ({ unmeasured: null, tileError: 2, left: [3, 7], right: [7, 7], lowRise: { left: rise, right: NaN } });
    // A parked car 3 m left: the column 1 m behind its side is its roof, 1.2 m up.
    expect(probeFreeSpace(probe(1.2), 'left')).toBe(3);
    // A fence in front of a garden at pavement height.
    expect(probeFreeSpace(probe(0.15), 'left')).toBe(7);
  });
});

describe('probeLowWall', () => {
  const probe = (rise: number) => ({ unmeasured: null, tileError: 2, left: [3, 7], right: [7, 7], lowRise: { left: rise, right: NaN } });

  it('holds where the column behind the low hit is at least lowWallRise up', () => {
    expect(probeLowWall(probe(1.2), 'left')).toBe(true);
    expect(probeLowWall(probe(0.3), 'left')).toBe(true);
    // A kerb: the pavement behind a fence 0.15 m up.
    expect(probeLowWall(probe(0.15), 'left')).toBe(false);
    expect(probeLowWall(probe(1.2), 'right')).toBe(false);
    expect(probeLowWall(probe(NaN), 'left')).toBe(false);
    expect(probeLowWall({ unmeasured: null, tileError: 2, left: [3, 7], right: [7, 7] }, 'left')).toBe(false);
    expect(probeLowWall({ unmeasured: 'coarse tile', tileError: 20, left: [], right: [] }, 'left')).toBe(false);
    expect(probeLowWall(null, 'left')).toBe(false);
  });

  it('follows lowWallRise', () => {
    corridorConfig.lowWallRise = 0.5;
    expect(probeLowWall(probe(0.4), 'left')).toBe(false);
    corridorConfig.lowWallRise = 50;
    expect(probeLowWall(probe(1.2), 'left')).toBe(false);
  });
});

describe('lowRayAlone', () => {
  it('holds where every other ray hit nothing or hit at least 1 m beyond the low one', () => {
    expect(lowRayAlone([3, 7], 7)).toBe(true); // nothing over a car
    expect(lowRayAlone([3, 5], 7)).toBe(true); // a facade 2 m behind it
    expect(lowRayAlone([6.5, 7], 7)).toBe(true); // a car near the end of the rays
    expect(lowRayAlone([3, 3.4], 7)).toBe(false); // a trunk under its crown
    expect(lowRayAlone([3, 2.5], 7)).toBe(false); // a jetty
    expect(lowRayAlone([7, 7], 7)).toBe(false); // nothing hit
    expect(lowRayAlone([3], 7)).toBe(false); // one ray only
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

  it('switches where the enemies run in the band', () => {
    expect(corridorConfig.centreMode).toBe('band');
    expect(setCorridorConfig({ centreMode: 'minimal' })).toEqual([]);
    expect(corridorConfig.centreMode).toBe('minimal');
    expect(setCorridorConfig({ centreMode: 3 } as never)).toEqual(["centreMode must be 'band' or 'minimal'"]);
    expect(corridorConfig.centreMode).toBe('minimal');
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
