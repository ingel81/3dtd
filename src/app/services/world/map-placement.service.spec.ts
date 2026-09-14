import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Color, Group, Mesh, MeshBasicMaterial, MeshPhongMaterial, PlaneGeometry, Vector2, Vector3 } from 'three';
import { MapPlacementService } from './map-placement.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { OsmStreetService } from '../location/osm-street.service';
import { UIStore } from '../../store/ui.store';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StreetNetwork } from '../location/osm-street.service';
import {
  MAX_MANUAL_SPAWN_DISTANCE,
  MAX_SPAWN_STREET_DISTANCE,
  MIN_MANUAL_SPAWN_DISTANCE,
} from '../../configs/map-constants.config';
import {
  portalCorridorWidth,
  portalLaneOffset,
  portalTurnRange,
  spawnPortalPose,
} from '../../three-engine/renderers/marker/spawn-portal-pose';
import { haversineDistance } from '../../utils/geo-utils';
import { SegmentRoutes } from '../../utils/route-start';
import { raycastStats } from '../../utils/raycast-stats';

const HQ = { lat: 48.9, lon: 9.2 };
/** The box the streets were loaded for: 0.01 degree around the HQ. */
const BOUNDS = { minLat: HQ.lat - 0.01, maxLat: HQ.lat + 0.01, minLon: HQ.lon - 0.01, maxLon: HQ.lon + 0.01 };
const GREEN = new Color(0x22c55e);
const RED = new Color(0xff0000);

/** Where the cursor points: 500 m north of the HQ. */
const CURSOR = { lat: HQ.lat + 0.005, lon: HQ.lon };
/** The route a spawn there gets: from a node 20 m east of the cursor west (+x) along a straight street. */
const STREET = [
  { id: 1, lat: CURSOR.lat, lon: HQ.lon + 0.0002 },
  { id: 2, lat: CURSOR.lat, lon: HQ.lon - 0.0005 },
  { id: 3, lat: CURSOR.lat, lon: HQ.lon - 0.001 },
];
/** The way STREET belongs to, as findNearestStreetPoint names it. */
const STREET_WAY = { id: 7, name: 'Street', type: 'residential', nodes: STREET };

/** 0.001 degree = 100 m, +X west, +Z north, like the engine's frame. */
function geoToLocal(lat: number, lon: number, height: number): Vector3 {
  return new Vector3((HQ.lon - lon) * 1e5, height, (lat - HQ.lat) * 1e5);
}

/** A stand-in for the portal preview: a frame in Phong and a surface in Basic, as createPortalPreview builds it. */
function fakePortalPreview(color: number): Group {
  const group = new Group();
  group.add(new Mesh(new PlaneGeometry(), new MeshPhongMaterial({ color })));
  group.add(new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ color })));
  return group;
}

/** The portal on STREET as MarkerVisualizationService would stand it, and its turn range. */
const STREET_POINTS = STREET.map((node) => {
  const p = geoToLocal(node.lat, node.lon, 0);
  return { x: p.x, z: p.z };
});
const STREET_POSE = spawnPortalPose(STREET_POINTS, 0, portalCorridorWidth(STREET[0]))!;
const STREET_TURN = portalTurnRange(STREET_POINTS, STREET_POSE, portalLaneOffset(STREET[0]));

describe('MapPlacementService', () => {
  let service: MapPlacementService;
  let overlay: Group;
  let distanceToHq: number;
  /** Distance from the cursor to the nearest street of the loaded network, m */
  let distanceToStreet: number;
  /** Index of the segment of STREET_WAY nearest to the cursor */
  let segment: number;
  /** The route a spawn at the cursor gets to the HQ, as the segment's routes answer */
  let route: unknown[];
  /** The segment's routes from the cursor on (SegmentRoutes.routeFrom) */
  let routeFrom: ReturnType<typeof vi.fn>;
  let osm: {
    findNearestStreetPoint: ReturnType<typeof vi.fn>;
    haversineDistance: ReturnType<typeof vi.fn>;
    segmentRoutes: ReturnType<typeof vi.fn>;
  };
  const mapPlacementMode = signal<'hq' | 'spawn' | null>(null);

  beforeEach(() => {
    mapPlacementMode.set(null);
    overlay = new Group();
    distanceToHq = (MIN_MANUAL_SPAWN_DISTANCE + MAX_MANUAL_SPAWN_DISTANCE) / 2;
    distanceToStreet = 1;
    const markerViz = {
      createPortalPreview: vi.fn(fakePortalPreview),
      createDiamondMarker: vi.fn(({ color }: { color: number }) => fakePortalPreview(color)),
      disposePreviewMarker: vi.fn(),
    };
    segment = 0;
    route = STREET;
    routeFrom = vi.fn(() => route);
    osm = {
      findNearestStreetPoint: vi.fn(() => ({ distance: distanceToStreet, street: STREET_WAY, nodeIndex: segment })),
      haversineDistance: vi.fn(() => distanceToHq),
      segmentRoutes: vi.fn(() => ({ routeFrom })),
    };
    const injector = Injector.create({
      providers: [
        { provide: UIStore, useValue: { mapPlacementMode } },
        { provide: MarkerVisualizationService, useValue: markerViz },
        { provide: OsmStreetService, useValue: osm },
      ],
    });
    service = runInInjectionContext(injector, () => new MapPlacementService());
    const engine = {
      getOverlayGroup: () => overlay,
      getTerrainHeightAtGeo: () => 0,
      getRenderer: () => ({ getSize: (target: Vector2) => target.set(1600, 900) }),
      sync: { geoToLocalSimple: geoToLocal },
    };
    service.initialize(engine as unknown as ThreeTilesEngine, { bounds: BOUNDS } as unknown as StreetNetwork, { ...HQ });
  });

  const preview = () => overlay.children.find((o) => o.name === 'placementPreview')!;
  /** Colour of the preview's frame (the Phong material). */
  const frameColor = () => {
    let color: Color | null = null;
    preview().traverse((o) => {
      const material = (o as Mesh).material;
      if (material instanceof MeshPhongMaterial) color = material.color;
    });
    return color!;
  };
  /** How far the preview is turned from its route's heading. */
  const turned = () => preview().rotation.y - STREET_POSE.heading;

  describe('preview colour', () => {
    it('shows a spawn portal green where it may stand and red where not, as the hint and the click decide', () => {
      service.startPlacement('spawn');

      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
      expect(service.validationReason()).toBeNull();
      expect(frameColor().equals(GREEN)).toBe(true);

      distanceToHq = MIN_MANUAL_SPAWN_DISTANCE / 2;
      service.updatePreviewPosition(HQ.lat + 0.001, HQ.lon, 0);
      expect(service.validationReason()).toBe('Too close to HQ');
      expect(frameColor().equals(RED)).toBe(true);
      expect(service.handlePlacementClick()).toBeNull();

      distanceToHq = MIN_MANUAL_SPAWN_DISTANCE * 2;
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
      expect(frameColor().equals(GREEN)).toBe(true);
      expect(service.handlePlacementClick()).toMatchObject({ mode: 'spawn', lat: CURSOR.lat });
    });

    it('shows the HQ preview in the same green', () => {
      service.startPlacement('hq');
      service.updatePreviewPosition(HQ.lat, HQ.lon, 0);
      expect(frameColor().equals(GREEN)).toBe(true);
    });
  });

  describe('where a spawn may stand', () => {
    const inside = CURSOR;
    const outside = { lat: BOUNDS.maxLat + 0.001, lon: HQ.lon };

    it('takes a spot on a street of the loaded network, up to the tolerance', () => {
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE;
      expect(service.validatePosition('spawn', inside.lat, inside.lon)).toEqual({ valid: true });
    });

    it('refuses a spot off the streets, as close as a courtyard behind the houses', () => {
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE + 1;
      expect(service.validatePosition('spawn', inside.lat, inside.lon)).toEqual({ valid: false, reason: 'Too far from streets' });
    });

    it('says the streets are not loaded where the cursor is outside their box', () => {
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE + 1;
      expect(service.validatePosition('spawn', outside.lat, outside.lon))
        .toEqual({ valid: false, reason: 'Streets not loaded here' });

      // A way reaching out of the box is loaded: a spawn may stand on it
      distanceToStreet = 1;
      expect(service.validatePosition('spawn', outside.lat, outside.lon)).toEqual({ valid: true });
    });

    it('goes by the rings before the streets: beyond the outer one it is too far from the HQ', () => {
      distanceToStreet = 500;
      distanceToHq = MAX_MANUAL_SPAWN_DISTANCE + 1;
      expect(service.validatePosition('spawn', inside.lat, inside.lon)).toEqual({ valid: false, reason: 'Too far from HQ' });
      distanceToHq = MIN_MANUAL_SPAWN_DISTANCE - 1;
      expect(service.validatePosition('spawn', inside.lat, inside.lon)).toEqual({ valid: false, reason: 'Too close to HQ' });
    });

    it('refuses a street with no route to the HQ, and asks for the routes once per segment', () => {
      route = [];
      expect(service.validatePosition('spawn', inside.lat, inside.lon)).toEqual({ valid: false, reason: 'No route to HQ' });
      expect(osm.segmentRoutes).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nodeIndex: 0 }), HQ.lat, HQ.lon);
      expect(routeFrom).toHaveBeenCalledWith(inside.lat, inside.lon);

      // Along the same segment: its routes stand, only the start moves
      service.validatePosition('spawn', inside.lat + 0.0001, inside.lon);
      expect(osm.segmentRoutes).toHaveBeenCalledTimes(1);
      expect(routeFrom).toHaveBeenLastCalledWith(inside.lat + 0.0001, inside.lon);

      // The next segment: searched again
      segment = 1;
      route = STREET;
      expect(service.validatePosition('spawn', inside.lat, inside.lon)).toEqual({ valid: true });
      expect(osm.segmentRoutes).toHaveBeenCalledTimes(2);
    });

    it('asks again once the HQ or the streets changed', () => {
      route = [];
      service.validatePosition('spawn', inside.lat, inside.lon);
      route = STREET;
      service.updateDependencies({ bounds: BOUNDS } as unknown as StreetNetwork, { ...HQ });
      expect(service.validatePosition('spawn', inside.lat, inside.lon)).toEqual({ valid: true });
      expect(osm.segmentRoutes).toHaveBeenCalledTimes(2);
    });

    it('keeps the wider tolerance for the HQ, which needs no street to start on', () => {
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE + 1;
      expect(service.validatePosition('hq', inside.lat, inside.lon)).toEqual({ valid: true });
    });
  });

  describe('distance rings', () => {
    const rings = () => overlay.children.find((o) => o.name === 'spawnDistanceRings');

    it('shows the two rings around the HQ while a spawn is placed and takes them away after', () => {
      service.startPlacement('spawn');
      // A halo and a dashed line per ring
      expect(rings()?.children).toHaveLength(4);

      service.exitPlacementMode();
      expect(rings()).toBeUndefined();
    });

    it('shows no rings while the HQ moves', () => {
      service.startPlacement('hq');
      expect(rings()).toBeUndefined();
    });

    it('books the column samples of the rings as spawnRings in __raycastStats: two rings of 96 points and their centre', () => {
      raycastStats.reset();
      // Each sample stands in for a ray into the tiles
      vi.spyOn(service['engine']!, 'getTerrainHeightAtGeo').mockImplementation(() => {
        raycastStats.record(0, 0.3, 1);
        return 0;
      });
      const calls = () => Object.fromEntries(raycastStats.rows().map(({ caller, calls }) => [caller, calls]));

      service.startPlacement('spawn');
      expect(calls()).toEqual({ spawnRings: 194 });

      // The preview's samples on a mouse move are not the rings'
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
      expect(calls()['spawnRings']).toBe(194);
      expect(calls()['unscoped']).toBeGreaterThan(0);
      raycastStats.reset();
    });
  });

  describe('spawn preview on its route', () => {
    it('stands where and as its portal will: on the route start, facing along the route', () => {
      service.startPlacement('spawn');
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);

      const start = geoToLocal(STREET[0].lat, STREET[0].lon, 0);
      expect(preview().position.x).toBeCloseTo(start.x, 6);
      expect(preview().position.z).toBeCloseTo(start.z, 6);
      // West along the street: +x
      expect(preview().rotation.y).toBeCloseTo(Math.PI / 2, 6);
      expect(preview().scale.x).toBeCloseTo(STREET_POSE.scale, 6);
    });

    it('follows the cursor along a long segment: stands on its foot there, not on the segment\'s first node', () => {
      // The routes from STREET's first segment (51 m), on along STREET from either end
      const along = (from: number) => {
        let cost = 0;
        for (let i = from; i < STREET.length - 1; i++) {
          cost += haversineDistance(STREET[i].lat, STREET[i].lon, STREET[i + 1].lat, STREET[i + 1].lon);
        }
        return { path: STREET.slice(from), cost };
      };
      osm.segmentRoutes.mockImplementation(() => new SegmentRoutes(STREET[0], STREET[1], 1, (node) => along(STREET.indexOf(node))));
      service.startPlacement('spawn');

      // Beside the street, 20 m west of its first node in the scene
      service.updatePreviewPosition(CURSOR.lat + 0.0001, CURSOR.lon, 0);
      const foot = geoToLocal(CURSOR.lat, CURSOR.lon, 0);
      expect(preview().position.x).toBeCloseTo(foot.x, 6);
      expect(preview().position.z).toBeCloseTo(foot.z, 6);
      expect(preview().rotation.y).toBeCloseTo(Math.PI / 2, 6);

      // 10 m on west: the preview goes with it, the segment's routes stand
      service.updatePreviewPosition(CURSOR.lat + 0.0001, CURSOR.lon - 0.0001, 0);
      service.updatePreview(1);
      expect(preview().position.x).toBeCloseTo(foot.x + 10, 6);
      expect(preview().position.z).toBeCloseTo(foot.z, 6);
      expect(osm.segmentRoutes).toHaveBeenCalledTimes(1);
    });

    it('glides to a new pose over the next frames instead of jumping there, and places the pose on a click', () => {
      service.startPlacement('spawn');
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
      const start = geoToLocal(STREET[0].lat, STREET[0].lon, 0);

      // Off the streets now: the pose is at the cursor, facing the HQ
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE + 1;
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
      const cursor = geoToLocal(CURSOR.lat, CURSOR.lon, 0);
      expect(preview().position.x).toBeCloseTo(start.x, 6);

      // One frame: part of the way (+x is west, the cursor east of the route start), in position and heading
      service.updatePreview(1 / 60);
      expect(preview().position.x).toBeGreaterThan(start.x);
      expect(preview().position.x).toBeLessThan(cursor.x);
      expect(preview().rotation.y).toBeGreaterThan(STREET_POSE.heading);
      expect(preview().rotation.y).toBeLessThan(Math.PI);

      // A fraction of a second later it is there
      service.updatePreview(0.5);
      expect(preview().position.x).toBeCloseTo(cursor.x, 3);
      expect(preview().rotation.y).toBeCloseTo(Math.PI, 3);

      // Back on the street: a click right after the move places the route start, not what is shown
      distanceToStreet = 1;
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
      expect(service.handlePlacementClick()).toMatchObject({ mode: 'spawn', lat: CURSOR.lat, lon: CURSOR.lon });
    });

    it('stands at the cursor facing the HQ where no spawn may stand', () => {
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE + 1;
      service.startPlacement('spawn');
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);

      const cursor = geoToLocal(CURSOR.lat, CURSOR.lon, 0);
      expect(preview().position.x).toBeCloseTo(cursor.x, 6);
      expect(preview().position.z).toBeCloseTo(cursor.z, 6);
      // North of the HQ: facing south to it
      expect(preview().rotation.y).toBeCloseTo(Math.PI, 6);
      expect(preview().scale.x).toBe(1);
    });
  });

  describe('rotation with R', () => {
    const placeAtCursor = () => {
      service.startPlacement('spawn');
      service.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
    };

    it('turns within the opening while R is held and stops at the limit', () => {
      placeAtCursor();
      expect(STREET_TURN.max).toBeGreaterThan(0.1);

      expect(service.startRotating()).toBe(true);
      service.updatePreview(0.1);
      expect(turned()).toBeGreaterThan(0);
      expect(turned()).toBeLessThan(STREET_TURN.max);

      // Held on: it stops where the outermost enemies still get out
      service.updatePreview(5);
      expect(turned()).toBeCloseTo(STREET_TURN.max, 6);
      service.updatePreview(1);
      expect(turned()).toBeCloseTo(STREET_TURN.max, 6);
    });

    it('turns back with the next press once it stopped at a limit, not with the auto-repeat of the held key', () => {
      placeAtCursor();
      service.startRotating();
      service.updatePreview(5);
      service.stopRotating();

      service.startRotating();
      service.updatePreview(0.1);
      const back = turned();
      expect(back).toBeLessThan(STREET_TURN.max);

      // Auto-repeat while held: the same way on
      service.startRotating();
      service.updatePreview(0.1);
      expect(turned()).toBeLessThan(back);
      service.updatePreview(5);
      expect(turned()).toBeCloseTo(STREET_TURN.min, 6);
    });

    it('hands the turned heading to the click', () => {
      placeAtCursor();
      service.startRotating();
      service.updatePreview(0.1);
      service.stopRotating();
      const heading = preview().rotation.y;

      expect(service.handlePlacementClick()!.heading).toBeCloseTo(heading, 6);
    });

    it('keeps the turn on the route while the cursor moves along it', () => {
      placeAtCursor();
      service.startRotating();
      service.updatePreview(0.1);
      service.stopRotating();
      const turn = turned();

      service.updatePreviewPosition(CURSOR.lat + 0.00005, CURSOR.lon, 0);
      service.updatePreview(1);
      expect(turned()).toBeCloseTo(turn, 6);
    });

    it('leaves the heading to the route when the player does not turn the portal', () => {
      placeAtCursor();
      expect(service.handlePlacementClick()!.heading).toBeUndefined();
    });

    it('turns nothing where no spawn may stand', () => {
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE + 1;
      placeAtCursor();
      service.startRotating();
      service.updatePreview(1);
      expect(preview().rotation.y).toBeCloseTo(Math.PI, 6);
    });

    it('does not turn the HQ preview', () => {
      service.startPlacement('hq');
      service.updatePreviewPosition(HQ.lat, HQ.lon, 0);
      expect(service.startRotating()).toBe(false);
      service.updatePreview(1);
      expect(preview().rotation.y).toBe(0);
      expect(service.handlePlacementClick()!.heading).toBeUndefined();
    });

    it('forgets a turn and a held R when the placement ends', () => {
      placeAtCursor();
      service.startRotating();
      service.updatePreview(0.5);
      service.exitPlacementMode();

      placeAtCursor();
      service.updatePreview(1);
      expect(preview().rotation.y).toBeCloseTo(STREET_POSE.heading, 6);
      expect(service.handlePlacementClick()!.heading).toBeUndefined();
    });
  });
});
