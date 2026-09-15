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
  terrain: { getStreetHeightEstimate: () => 2 },
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

  it('compares with the deck on a bridge and on the ways that carry it on, as the overlay draws them', () => {
    const decks: unknown[] = [];
    const metric = {
      sync: {
        geoToLocalSimple: (lat: number, lon: number) => ({ x: (lon - 9) * M_PER_DEG_LON, y: 0, z: (lat - 48) * METERS_PER_DEGREE_LAT }),
      },
      terrain: {
        getStreetHeightEstimate: (...args: unknown[]) => {
          decks.push(args[6]);
          return 2;
        },
      },
    } as unknown as ThreeTilesEngine;
    // North: 99 m over the bridge, 29 m off its end, 59 m more; samples at most 2 m apart.
    const north = (m: number) => 48 + m / METERS_PER_DEGREE_LAT;
    const path: RouteWaypoint[] = [
      { lat: north(0), lon: 9, onBridge: true }, { lat: north(99), lon: 9 }, { lat: north(128), lon: 9 }, { lat: north(187), lon: 9 },
    ];
    describeRouteWays(new Map([['s1', path]]), new StreetEdgeIndex([]), metric, { isInitialized: () => true, getGroundLocalYAt: () => 2 }, flat);

    expect(decks).toHaveLength(51 + 16 + 31);
    expect(decks.slice(0, 51).every((d) => d === 'bridge')).toBe(true);
    // The route from the bridge end, the waypoint after the bridge, up to
    // 60 m on: 29 m, then 16 samples of the last segment (0 to 30 of its 59 m).
    const off = decks.slice(51, 67 + 16) as { path: RouteWaypoint[]; m: number }[];
    expect(off.every((d) => d !== null && typeof d === 'object' && d.path[0] === path[1])).toBe(true);
    expect(off[16].path).toEqual([path[1], path[2], path[3]]);
    expect(off[16].m).toBeCloseTo(29, 3);
    expect(decks.slice(67 + 16).every((d) => d === null)).toBe(true);
  });
});
