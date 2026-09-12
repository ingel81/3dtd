import { describe, it, expect } from 'vitest';
import type { ThreeTilesEngine } from '../../three-engine';
import type { RouteWaypoint } from '../../models/game.types';
import type { Street } from '../location/osm-street.service';
import { StreetEdgeIndex } from '../../utils/route-ways';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import { describeRouteWays } from './route-way-report';

const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(48 * DEG_TO_RAD);

/** Flat-earth distance, precise enough over a few hundred metres. */
const flat = {
  haversineDistance: (lat1: number, lon1: number, lat2: number, lon2: number) =>
    Math.hypot((lon2 - lon1) * M_PER_DEG_LON, (lat2 - lat1) * METERS_PER_DEGREE_LAT),
};

const n0 = { id: 1, lat: 48, lon: 9 };
const n1 = { id: 2, lat: 48.001, lon: 9 };
const n2 = { id: 3, lat: 48.001, lon: 9.001 };
const streets = [
  { id: 100, type: 'residential', name: 'Hauptweg', nodes: [n0, n1] },
  { id: 200, type: 'footway', name: 'Durchgang', width: 8, tunnel: 'building_passage', nodes: [n1, n2] },
] as unknown as Street[];

/** Way 100, way 200 in two pieces of different width, then off the network to the HQ. */
const route: RouteWaypoint[] = [
  { lat: n0.lat, lon: n0.lon, corridorLeft: 2, corridorRight: 3 },
  { lat: n1.lat, lon: n1.lon, corridorLeft: 4, corridorRight: 4 },
  { lat: 48.001, lon: 9.0005, corridorLeft: 4, corridorRight: 1 },
  { lat: n2.lat, lon: n2.lon, corridorLeft: 3, corridorRight: 3 },
  { lat: 48.0015, lon: 9.001 },
];

const engine = {
  sync: { geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }) },
  terrain: { getGroundHeightEstimate: () => 2 },
} as unknown as ThreeTilesEngine;

const describe_ = (cellY: number | null) =>
  describeRouteWays(
    new Map([['s1', route]]),
    new StreetEdgeIndex(streets),
    engine,
    { isInitialized: () => cellY !== null, getGroundLocalYAt: () => cellY },
    flat,
  );

describe('describeRouteWays', () => {
  it('gives one row per way the route runs over, and one for the leg off the network', () => {
    const rows = describe_(null);
    expect(rows.map((r) => [r.way, r.fromIndex, r.toIndex])).toEqual([[100, 0, 1], [200, 1, 3], [null, 3, 4]]);
    expect(rows[0].lengthM).toBeCloseTo(111.2, 0);
    expect(rows[1]).toMatchObject({
      name: 'Durchgang',
      tags: 'width=8 tunnel=building_passage',
      widthM: 8,
      widthSource: 'width',
      corridorM: '5.0-8.0',
      leftM: '4.0',
      rightM: '1.0-4.0',
    });
    expect(rows[2]).toMatchObject({ type: '(off network)', widthM: null, widthSource: 'inherited', corridorM: '6.0' });
  });

  it('leaves the height comparison empty until the cells exist', () => {
    expect(describe_(null).every((r) => r.maxCellAboveStreetM === null && r.at === '')).toBe(true);
  });

  it('reports the largest gap between cell and street overlay and where it first shows', () => {
    const rows = describe_(5);
    expect(rows.map((r) => r.maxCellAboveStreetM)).toEqual([3, 3, 3]);
    expect(rows[0].at).toBe('48.000000,9.000000');
  });
});
