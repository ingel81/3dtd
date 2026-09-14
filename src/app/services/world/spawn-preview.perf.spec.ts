import { describe, it, expect } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Group, Vector2, Vector3 } from 'three';
import { MapPlacementService } from './map-placement.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { OsmStreetService, Street, StreetNetwork, StreetNode } from '../location/osm-street.service';
import { StreetCacheService } from '../location/street-cache.service';
import { UIStore } from '../../store/ui.store';
import type { ThreeTilesEngine } from '../../three-engine';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import {
  portalCorridorWidth,
  portalLaneOffset,
  portalTurnRange,
  spawnPortalPose,
} from '../../three-engine/renderers/marker/spawn-portal-pose';
import { fakePortalPreview } from '../../../test/portal-preview-fixture';

/**
 * What one cursor move costs the spawn preview (MapPlacementService.
 * updatePreviewPosition) on a street network the size of a loaded city box,
 * without the tile raycasts (the terrain answers 0). A measurement, not a
 * test: skipped unless SPAWN_PREVIEW_PERF=1, then it prints a table.
 *
 *   $env:SPAWN_PREVIEW_PERF=1; npx vitest run src/app/services/world/spawn-preview.perf.spec.ts
 *
 * The network: a grid of streets over +-2000 m around the HQ, as the
 * relocation loads it (LOCATION_SYSTEM.md), a street every 100 m, a way per
 * block, a shape node every 20 m, a fifth of the ways footways. Real boxes
 * differ; Overpass caps the answer at 4 MB.
 */

const HQ = { lat: 48.9, lon: 9.2 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(HQ.lat * DEG_TO_RAD);
const HALF_M = 2000;
const BLOCK_M = 100;
const NODE_M = 20;
const TYPES = ['residential', 'residential', 'secondary', 'footway', 'service'];

const geoAt = (x: number, z: number) => ({ lat: HQ.lat + z / METERS_PER_DEGREE_LAT, lon: HQ.lon + x / M_PER_DEG_LON });

function cityGrid(): StreetNetwork {
  const nodes = new Map<number, StreetNode>();
  const steps = HALF_M / NODE_M;
  const node = (xi: number, zi: number): StreetNode => {
    const id = (xi + steps) * (2 * steps + 1) + (zi + steps) + 1;
    let n = nodes.get(id);
    if (!n) {
      n = { id, ...geoAt(xi * NODE_M, zi * NODE_M) };
      nodes.set(id, n);
    }
    return n;
  };
  const streets: Street[] = [];
  const perBlock = BLOCK_M / NODE_M;
  for (let line = -HALF_M; line <= HALF_M; line += BLOCK_M) {
    const li = line / NODE_M;
    for (let from = -HALF_M; from < HALF_M; from += BLOCK_M) {
      const fi = from / NODE_M;
      const eastWest: StreetNode[] = [];
      const northSouth: StreetNode[] = [];
      for (let k = 0; k <= perBlock; k++) {
        eastWest.push(node(fi + k, li));
        northSouth.push(node(li, fi + k));
      }
      const type = TYPES[(streets.length / 2) % TYPES.length];
      streets.push({ id: streets.length + 1, name: '', type, nodes: eastWest });
      streets.push({ id: streets.length + 1, name: '', type, nodes: northSouth });
    }
  }
  const min = geoAt(-HALF_M, -HALF_M);
  const max = geoAt(HALF_M, HALF_M);
  return { streets, nodes, bounds: { minLat: min.lat, minLon: min.lon, maxLat: max.lat, maxLon: max.lon } };
}

/** Milliseconds per call of `fn` over `runs` calls after a warm-up: mean, median, 95th percentile, max. */
function measure(name: string, fn: () => void, runs: number) {
  for (let i = 0; i < Math.min(20, runs); i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const ms = (v: number) => Math.round(v * 1000) / 1000;
  return {
    name,
    runs,
    meanMs: ms(times.reduce((s, t) => s + t, 0) / runs),
    medianMs: ms(times[Math.floor(runs / 2)]),
    p95Ms: ms(times[Math.floor(runs * 0.95)]),
    maxMs: ms(times[runs - 1]),
  };
}

describe.skipIf(process.env['SPAWN_PREVIEW_PERF'] !== '1')('spawn preview cost per cursor move (measurement)', () => {
  it('prints what a move costs on a city-sized street network', () => {
    const network = cityGrid();
    let segments = 0;
    for (const street of network.streets) segments += street.nodes.length - 1;

    const injector = Injector.create({
      providers: [
        { provide: UIStore, useValue: { mapPlacementMode: signal<'hq' | 'spawn' | null>(null) } },
        { provide: StreetCacheService, useValue: {} },
        { provide: OsmStreetService, useFactory: () => new OsmStreetService() },
        {
          provide: MarkerVisualizationService,
          useValue: { createPortalPreview: fakePortalPreview, disposePreviewMarker: () => undefined },
        },
      ],
    });
    const osm = injector.get(OsmStreetService);
    const placement = runInInjectionContext(injector, () => new MapPlacementService());
    const engine = {
      getOverlayGroup: () => new Group(),
      getTerrainHeightAtGeo: () => 0,
      getRenderer: () => ({ getSize: (target: Vector2) => target.set(1600, 900) }),
      sync: {
        geoToLocalSimple: (lat: number, lon: number, h: number) =>
          new Vector3((HQ.lon - lon) * M_PER_DEG_LON, h, (lat - HQ.lat) * METERS_PER_DEGREE_LAT),
      },
    } as unknown as ThreeTilesEngine;
    placement.initialize(engine, network, { ...HQ });
    placement.startPlacement('spawn');

    // The cursor 5 m north of the east-west street 800 m north of the HQ
    const CURSOR_Z = 805;
    let cursorX = -400;
    const nextMove = () => {
      cursorX = cursorX >= 400 ? -400 : cursorX + 1;
      return geoAt(cursorX, CURSOR_Z);
    };
    let slide = 0;
    const slideMove = () => {
      slide = (slide + 1) % 18;
      return geoAt(201 + slide, CURSOR_Z);
    };
    const move = (p: { lat: number; lon: number }) => placement.updatePreviewPosition(p.lat, p.lon, 0);

    const at = geoAt(210, CURSOR_Z);
    const nearest = osm.findNearestStreetPoint(network, at.lat, at.lon)!;
    const path = osm.findPath(network, at.lat, at.lon, HQ.lat, HQ.lon);
    expect(path.length).toBeGreaterThan(1);
    const points = path.slice(0, 16).map((n) => engine.sync.geoToLocalSimple(n.lat, n.lon, 0));

    const rows = [
      measure('move along one segment (its routes kept)', () => move(slideMove()), 400),
      measure('move 1 m on, a new segment every 20 m', () => move(nextMove()), 400),
      measure('move onto a segment not seen before', () => {
        placement.updateDependencies(network, { ...HQ });
        move(nextMove());
      }, 100),
      measure('part: findNearestStreetPoint', () => osm.findNearestStreetPoint(network, at.lat, at.lon), 400),
      measure('part: segmentRoutes + routeFrom (A* both ends)', () => {
        osm.segmentRoutes(network, nearest, HQ.lat, HQ.lon)!.routeFrom(at.lat, at.lon);
      }, 100),
      measure('part: spawnPortalPose + portalTurnRange', () => {
        const pose = spawnPortalPose(points, 0, portalCorridorWidth(path[0]))!;
        portalTurnRange(points, pose, portalLaneOffset(path[0]));
      }, 400),
    ];
    console.log(`network: ${network.streets.length} ways, ${segments} segments, ${network.nodes.size} nodes; route ${path.length} nodes`);
    console.table(rows);
  });
});
