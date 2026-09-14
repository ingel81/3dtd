import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { Group, Mesh, MeshBasicMaterial, MeshPhongMaterial, PlaneGeometry, Vector3 } from 'three';

// Only their DI tokens are needed, as in game-loop-facade.service.spec.ts
vi.mock('../boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('../replay.service', () => ({ ReplayService: class ReplayService {} }));
import { BossIntroService } from '../boss-intro.service';
import { ReplayService } from '../replay.service';

import { GameLoopFacadeService } from './game-loop-facade.service';
import { EngineStore } from '../../store/engine.store';
import { CameraControlService } from '../camera-control.service';
import { TowerPlacementService } from '../tower-placement.service';
import { MapPlacementService } from '../world/map-placement.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { WaveDebugService } from '../debug/wave-debug.service';
import { SoundDebugService } from '../debug/sound-debug.service';
import { DebugWindowService } from '../debug/debug-window.service';
import { EnemyDebugService } from '../debug/enemy-debug.service';
import { WaveDirectorService } from '../../ai/core/wave-director.service';
import { AIDataCollectorService } from '../../ai/core/ai-data-collector.service';
import { TrainingClientService } from '../../ai/training/training-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { UIStore } from '../../store/ui.store';
import { OsmStreetService } from '../location/osm-street.service';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StreetNetwork } from '../location/osm-street.service';

const HQ = { lat: 48.9, lon: 9.2 };

/** 0.001 degree = 100 m, +X west, +Z north, like the engine's frame (map-placement.service.spec.ts). */
function geoToLocal(lat: number, lon: number, height: number): Vector3 {
  return new Vector3((HQ.lon - lon) * 1e5, height, (lat - HQ.lat) * 1e5);
}

/** A stand-in for the portal preview, as in map-placement.service.spec.ts */
function fakePortalPreview(color: number): Group {
  const group = new Group();
  group.add(new Mesh(new PlaneGeometry(), new MeshPhongMaterial({ color })));
  group.add(new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ color })));
  return group;
}

/**
 * Playtest 534 (docs/REVIEW_FIX_2026-09-14.md), second half, replayed: the
 * game is paused, the spawn preview of the real MapPlacementService is
 * turned with R held, and the per-frame engine update of the game loop
 * facade runs as it does every frame.
 */
describe('Turning the spawn preview in the pause, playtest 534 replayed', () => {
  let facade: GameLoopFacadeService;
  let mapPlacement: MapPlacementService;
  let overlay: Group;
  let gameUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    overlay = new Group();
    const placementInjector = Injector.create({
      providers: [
        { provide: UIStore, useValue: { mapPlacementMode: signal<'hq' | 'spawn' | null>(null) } },
        {
          provide: MarkerVisualizationService,
          useValue: { createPortalPreview: fakePortalPreview, createDiamondMarker: vi.fn(), disposePreviewMarker: vi.fn() },
        },
        {
          provide: OsmStreetService,
          useValue: { findNearestStreetPoint: () => ({ distance: 1 }), haversineDistance: () => 700 },
        },
      ],
    });
    mapPlacement = runInInjectionContext(placementInjector, () => new MapPlacementService());
    mapPlacement.initialize(
      { getOverlayGroup: () => overlay, getTerrainHeightAtGeo: () => 0, sync: { geoToLocalSimple: geoToLocal } } as unknown as ThreeTilesEngine,
      { bounds: {} } as unknown as StreetNetwork,
      { ...HQ },
    );

    const store = {
      phase: signal('setup'),
      spawnPoints: signal([{}]),
      waveNumber: signal(0),
      useStaticCurriculum: signal(false),
      useAIDirector: signal(false),
      aiExplanation: signal(null),
      aiError: signal(null),
      paused: signal(true),
    };
    const injector = Injector.create({
      providers: [
        { provide: EngineStore, useValue: {} },
        { provide: CameraControlService, useValue: { update: vi.fn() } },
        { provide: TowerPlacementService, useValue: { updateRotation: vi.fn(), tickBuildPreviewViz: vi.fn() } },
        { provide: MapPlacementService, useValue: mapPlacement },
        { provide: KeyboardPanService, useValue: { update: vi.fn() } },
        { provide: MarkerVisualizationService, useValue: { animateMarkers: vi.fn() } },
        { provide: RouteAnimationService, useValue: { update: vi.fn() } },
        { provide: IntroCameraFlightService, useValue: { update: vi.fn() } },
        { provide: WaveDebugService, useValue: {} },
        { provide: SoundDebugService, useValue: {} },
        { provide: DebugWindowService, useValue: {} },
        { provide: EnemyDebugService, useValue: {} },
        { provide: WaveDirectorService, useValue: {} },
        { provide: AIDataCollectorService, useValue: {} },
        { provide: TrainingClientService, useValue: { botEnabled: () => false } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: PerformanceProfilerService, useValue: { tick: vi.fn() } },
        { provide: StreetRenderingService, useValue: { continueStreetRender: vi.fn() } },
        { provide: UIStore, useValue: {} },
        { provide: BossIntroService, useValue: { update: vi.fn() } },
        { provide: ReplayService, useValue: { update: vi.fn() } },
        { provide: NgZone, useValue: { run: (fn: () => void) => fn() } },
      ],
    });
    facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    gameUpdate = vi.fn();
    facade.initialize(
      { getEngine: () => null } as unknown as FacadeComponentBridge,
      {
        getEventBus: () => ({ emit: vi.fn() }),
        paused: () => true,
        tilesEngine: null,
        gameTimeMs: 0,
        update: gameUpdate,
        getGlobalRouteGrid: () => ({
          isSpatialGridVizVisible: () => false,
          isAirSpatialGridVizVisible: () => false,
          updateVisualization: vi.fn(),
          updateAnimation: vi.fn(),
        }),
        towerManager: { tickSelectionViz: vi.fn(), syncVeteranBadges: vi.fn() },
      } as unknown as GameStateManager,
    );
  });

  it('534: with the game paused, R held still turns the spawn preview in every frame', () => {
    mapPlacement.startPlacement('spawn');
    mapPlacement.updatePreviewPosition(HQ.lat + 0.005, HQ.lon, 0);
    const preview = overlay.children.find((o) => o.name === 'placementPreview')!;
    // North of the HQ it faces south to it
    expect(preview.rotation.y).toBeCloseTo(Math.PI, 6);

    // R down (InputHandlerService.handleKeyDown), then one frame of 250 ms
    expect(mapPlacement.startRotating()).toBe(true);
    facade.onEngineUpdate(250);
    expect(gameUpdate).toHaveBeenCalledTimes(1);
    expect(preview.rotation.y).toBeCloseTo(Math.PI + Math.PI / 4, 6);
  });
});
