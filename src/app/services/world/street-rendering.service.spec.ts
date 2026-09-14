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
      west: node(1, 0, 0), east: node(2, 60, 0), a: node(3, 67, 0), b: node(4, 120, 0), under1: node(5, 30, -20), under2: node(6, 30, 20),
    };
    const way = (id: number, nodes: StreetNode[], bridge?: string): Street => ({ id, name: '', type: 'service', nodes, bridge });
    const streets = [way(100, [n.west, n.east], 'yes'), way(200, [n.east, n.a, n.b]), way(300, [n.under1, n.under2])];
    const network = { streets, nodes: new Map(), bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } } as unknown as StreetNetwork;

    // The deck at 80 m, the ground under it and beside it at 70 m.
    const asked: [number, StreetDeck | null][] = [];
    const overlay = new Group();
    const engine = {
      getOverlayGroup: () => overlay,
      getTerrainHeightAtGeo: () => 70,
      sync: { geoToLocalSimple: (lat: number, lon: number, h: number) => new Vector3(lon * METERS_PER_DEGREE_LAT, h, -lat * METERS_PER_DEGREE_LAT) },
      terrain: {
        getStreetHeightEstimate: (lat: number, lon: number, _pl: number, _po: number, _nl: number, _no: number, deck: StreetDeck | null) => {
          asked.push([Object.values(n).find((p) => p.lat === lat && p.lon === lon)!.id, deck]);
          return deck === null ? 70 : 80;
        },
      },
    } as unknown as ThreeTilesEngine;

    new StreetRenderingService().renderStreets(engine, network, network, { lat: 0, lon: 0 } as never, true);

    expect(asked).toEqual([
      [n.west.id, 'bridge'],
      [n.east.id, 'bridge'],
      // The way off the east end: its first node and the one 7 m on compare
      // with the end node; 60 m on, its ground.
      [n.east.id, n.east],
      [n.a.id, n.east],
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
});
