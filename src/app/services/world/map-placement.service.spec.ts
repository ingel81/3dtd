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
  MIN_MANUAL_SPAWN_DISTANCE,
} from '../../configs/map-constants.config';

const HQ = { lat: 48.9, lon: 9.2 };
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
  const mapPlacementMode = signal<'hq' | 'spawn' | null>(null);

  beforeEach(() => {
    mapPlacementMode.set(null);
    overlay = new Group();
    distanceToHq = (MIN_MANUAL_SPAWN_DISTANCE + MAX_MANUAL_SPAWN_DISTANCE) / 2;
    const markerViz = {
      createPortalPreview: vi.fn(fakePortalPreview),
      createDiamondMarker: vi.fn(({ color }: { color: number }) => fakePortalPreview(color)),
      disposePreviewMarker: vi.fn(),
    };
    const osm = {
      findNearestStreetPoint: vi.fn(() => ({ distance: 1 })),
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
    service.initialize(engine as unknown as ThreeTilesEngine, { bounds: {} } as unknown as StreetNetwork, { ...HQ });
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
});
