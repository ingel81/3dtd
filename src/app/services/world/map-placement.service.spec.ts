import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Color, Group, Mesh, MeshBasicMaterial, MeshPhongMaterial, PlaneGeometry, Vector3 } from 'three';
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

const HQ = { lat: 48.9, lon: 9.2 };
/** The box the streets were loaded for: 0.01 degree around the HQ. */
const BOUNDS = { minLat: HQ.lat - 0.01, maxLat: HQ.lat + 0.01, minLon: HQ.lon - 0.01, maxLon: HQ.lon + 0.01 };
const GREEN = new Color(0x22c55e);
const RED = new Color(0xff0000);

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

describe('MapPlacementService', () => {
  let service: MapPlacementService;
  let overlay: Group;
  let distanceToHq: number;
  /** Distance from the cursor to the nearest street of the loaded network, m */
  let distanceToStreet: number;
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
    const osm = {
      findNearestStreetPoint: vi.fn(() => ({ distance: distanceToStreet })),
      haversineDistance: vi.fn(() => distanceToHq),
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

  describe('preview colour', () => {
    it('shows a spawn portal green where it may stand and red where not, as the hint and the click decide', () => {
      service.startPlacement('spawn');

      service.updatePreviewPosition(HQ.lat + 0.005, HQ.lon, 0);
      expect(service.validationReason()).toBeNull();
      expect(frameColor().equals(GREEN)).toBe(true);

      distanceToHq = MIN_MANUAL_SPAWN_DISTANCE / 2;
      service.updatePreviewPosition(HQ.lat + 0.001, HQ.lon, 0);
      expect(service.validationReason()).toBe('Too close to HQ');
      expect(frameColor().equals(RED)).toBe(true);
      expect(service.handlePlacementClick()).toBeNull();

      distanceToHq = MIN_MANUAL_SPAWN_DISTANCE * 2;
      service.updatePreviewPosition(HQ.lat + 0.005, HQ.lon, 0);
      expect(frameColor().equals(GREEN)).toBe(true);
      expect(service.handlePlacementClick()).toMatchObject({ mode: 'spawn', lat: HQ.lat + 0.005 });
    });

    it('shows the HQ preview in the same green', () => {
      service.startPlacement('hq');
      service.updatePreviewPosition(HQ.lat, HQ.lon, 0);
      expect(frameColor().equals(GREEN)).toBe(true);
    });
  });

  describe('where a spawn may stand', () => {
    const inside = { lat: HQ.lat + 0.005, lon: HQ.lon };
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

    it('keeps the wider tolerance for the HQ, which needs no street to start on', () => {
      distanceToStreet = MAX_SPAWN_STREET_DISTANCE + 1;
      expect(service.validatePosition('hq', inside.lat, inside.lon)).toEqual({ valid: true });
    });
  });

  describe('rotation with R', () => {
    // North of the HQ: the preview faces south to it, heading pi
    const spawnAt = { lat: HQ.lat + 0.005, lon: HQ.lon };

    it('turns the spawn preview while R is held and hands the heading to the click', () => {
      service.startPlacement('spawn');
      service.updatePreviewPosition(spawnAt.lat, spawnAt.lon, 0);
      expect(preview().rotation.y).toBeCloseTo(Math.PI, 6);

      expect(service.startRotating()).toBe(true);
      service.updateRotation(0.25);
      service.stopRotating();
      service.updateRotation(1);
      const turned = Math.PI + Math.PI / 4;
      expect(preview().rotation.y).toBeCloseTo(turned, 6);

      // The cursor moves on: the preview keeps the player's heading
      service.updatePreviewPosition(spawnAt.lat + 0.0005, spawnAt.lon, 0);
      expect(preview().rotation.y).toBeCloseTo(turned, 6);
      expect(service.handlePlacementClick()!.heading).toBeCloseTo(turned, 6);
    });

    it('leaves the heading to the route when the player does not turn the portal', () => {
      service.startPlacement('spawn');
      service.updatePreviewPosition(spawnAt.lat, spawnAt.lon, 0);
      expect(service.handlePlacementClick()!.heading).toBeUndefined();
    });

    it('does not turn the HQ preview', () => {
      service.startPlacement('hq');
      service.updatePreviewPosition(HQ.lat, HQ.lon, 0);
      expect(service.startRotating()).toBe(false);
      service.updateRotation(1);
      expect(preview().rotation.y).toBe(0);
      expect(service.handlePlacementClick()!.heading).toBeUndefined();
    });

    it('forgets a turn and a held R when the placement ends', () => {
      service.startPlacement('spawn');
      service.updatePreviewPosition(spawnAt.lat, spawnAt.lon, 0);
      service.startRotating();
      service.updateRotation(0.5);
      service.exitPlacementMode();

      service.startPlacement('spawn');
      service.updatePreviewPosition(spawnAt.lat, spawnAt.lon, 0);
      service.updateRotation(1);
      expect(preview().rotation.y).toBeCloseTo(Math.PI, 6);
      expect(service.handlePlacementClick()!.heading).toBeUndefined();
    });
  });
});
