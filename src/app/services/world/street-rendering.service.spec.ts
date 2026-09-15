import { describe, it, expect, vi } from 'vitest';
import { BufferGeometry, Group, LineSegments, Vector3 } from 'three';

// inject() liefert pro Service-Klasse einen Stub.
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  const stubs: Record<string, unknown> = {
    MarkerVisualizationService: { clearHeightDebugMarkers: () => undefined, addHeightDebugMarker: () => undefined },
    DevWorldService: { isActive: false },
    UIStore: { streetsVisible: () => true },
  };
  return {
    ...actual,
    inject: (token: { name?: string }) => stubs[token?.name ?? ''] ?? {},
  };
});

import { StreetRenderingService } from './street-rendering.service';
import type { Street, StreetNetwork, StreetNode } from '../location/osm-street.service';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StreetDeck } from '../../utils/deck-approach';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

/** A node `x` metres east and `z` north of (0, 0). */
const node = (id: number, x: number, z: number): StreetNode => ({ id, lat: z / METERS_PER_DEGREE_LAT, lon: x / METERS_PER_DEGREE_LAT });

describe('StreetRenderingService', () => {
  /**
   * Playtest 2026-09-14, Paris, Pont d'Iéna: the yellow street overlay ran
   * on the quay and the river under the bridge, and past its ends.
   */
  it('draws a bridge way and the ways off its ends on the deck, other streets on their ground', () => {
    const n = {
      west: node(1, 0, 0), east: node(2, 60, 0), a: node(3, 67, 0), b: node(4, 130, 0), under1: node(5, 30, -20), under2: node(6, 30, 20),
    };
    const way = (id: number, nodes: StreetNode[], bridge?: string): Street => ({ id, name: '', type: 'service', nodes, bridge });
    const streets = [way(100, [n.west, n.east], 'yes'), way(200, [n.east, n.a, n.b]), way(300, [n.under1, n.under2])];
    const network = { streets, nodes: new Map(), bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } } as unknown as StreetNetwork;

    // The deck at 80 m, the ground under it and beside it at 70 m.
    // Per node: 'bridge', the ids along the way from the bridge end and its length, or null.
    const asked: [number, unknown][] = [];
    const overlay = new Group();
    const engine = {
      getOverlayGroup: () => overlay,
      getTerrainHeightAtGeo: () => 70,
      sync: { geoToLocalSimple: (lat: number, lon: number, h: number) => new Vector3(lon * METERS_PER_DEGREE_LAT, h, -lat * METERS_PER_DEGREE_LAT) },
      terrain: {
        getStreetHeightEstimate: (lat: number, lon: number, _pl: number, _po: number, _nl: number, _no: number, deck: StreetDeck | null) => {
          const id = Object.values(n).find((p) => p.lat === lat && p.lon === lon)!.id;
          const way = deck === null || deck === 'bridge' ? deck
            : 'portals' in deck ? 'under'
              : [deck.path.map((p) => (p as StreetNode).id), Math.round(deck.m)];
          asked.push([id, way]);
          return deck === null ? 70 : 80;
        },
      },
    } as unknown as ThreeTilesEngine;

    new StreetRenderingService().renderStreets(engine, network, network, { lat: 0, lon: 0 } as never, true);

    expect(asked).toEqual([
      [n.west.id, 'bridge'],
      [n.east.id, 'bridge'],
      // The way off the east end: its first node and the one 7 m on take
      // the height carried from the end node; 70 m on, its ground.
      [n.east.id, [[n.east.id], 0]],
      [n.a.id, [[n.east.id, n.a.id], 7]],
      [n.b.id, null],
      // The street under the bridge: its ground.
      [n.under1.id, null],
      [n.under2.id, null],
    ]);

    // The street under the bridge is drawn at 70.5 m, the bridge at 80.5 m.
    const mesh = overlay.children[0] as LineSegments<BufferGeometry>;
    const ys = Array.from(mesh.geometry.getAttribute('position').array).filter((_, i) => i % 3 === 1);
    expect(ys.slice(0, 2)).toEqual([80.5, 80.5]);
    expect(ys.slice(-2)).toEqual([70.5, 70.5]);
  });

  /**
   * Playtest 2026-09-15, Erlenbach (D2): a street under a motorway deck
   * whose underside the photogrammetry has filled.
   */
  it('draws a street node under a bridge of another way between the ground either side', () => {
    // A street north along x = 30 with a node 4 m south of a motorway bridge across it at z = 0.
    const n = { south: node(1, 30, -50), near: node(2, 30, -4), north: node(3, 30, 50), west: node(4, 0, 0), east: node(5, 60, 0) };
    const streets: Street[] = [
      { id: 100, name: '', type: 'residential', nodes: [n.south, n.near, n.north] },
      { id: 900, name: '', type: 'motorway', lanes: 3, bridge: 'yes', layer: 1, nodes: [n.west, n.east] },
    ];
    const network = { streets, nodes: new Map(), bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } } as unknown as StreetNetwork;
    const asked = new Map<number, StreetDeck | null>();
    const engine = {
      getOverlayGroup: () => new Group(),
      getTerrainHeightAtGeo: () => 0,
      sync: { geoToLocalSimple: (lat: number, lon: number, h: number) => new Vector3(lon * METERS_PER_DEGREE_LAT, h, -lat * METERS_PER_DEGREE_LAT) },
      terrain: {
        getStreetHeightEstimate: (lat: number, lon: number, _pl: number, _po: number, _nl: number, _no: number, deck: StreetDeck | null) => {
          asked.set(Object.values(n).find((p) => p.lat === lat && p.lon === lon)!.id, deck);
          return 0;
        },
      },
    } as unknown as ThreeTilesEngine;

    new StreetRenderingService().renderStreets(engine, network, network, { lat: 0, lon: 0 } as never, true);

    expect(asked.get(n.south.id)).toBeNull();
    expect(asked.get(n.north.id)).toBeNull();
    // 9 m either side of the bridge, the portals 2 m further: 11 m south and north of it.
    const under = asked.get(n.near.id) as unknown as { portals: StreetNode[]; f: number; wayId: number };
    expect(under.wayId).toBe(900);
    expect(under.portals.map((p) => p.lat * METERS_PER_DEGREE_LAT)).toEqual([expect.closeTo(-11, 1), expect.closeTo(11, 1)]);
    expect(under.f).toBeCloseTo(7 / 22, 2);
    expect(asked.get(n.west.id)).toBe('bridge');
  });
});
