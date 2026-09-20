import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { Group, Vector2 } from 'three';

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
import { WaveDirector } from '../../director/wave-director';
import { StateSnapshotService } from '../../director/state-snapshot.service';
import { BotClientService } from '../../bots/bot-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { UIStore } from '../../store/ui.store';
import { OsmStreetService } from '../location/osm-street.service';
import {
  portalCorridorWidth,
  portalLaneOffset,
  portalTurnRange,
  spawnPortalPose,
} from '../../three-engine/renderers/marker/spawn-portal-pose';
import { MAX_MANUAL_SPAWN_DISTANCE, MIN_MANUAL_SPAWN_DISTANCE } from '../../configs/map-constants.config';
import { makeGeoToLocal, fakePortalPreview } from '../../../test/portal-preview-fixture';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StreetNetwork } from '../location/osm-street.service';
import { GameRng } from '../../utils/game-rng';
import { RunLogFacade } from '../../run-log/run-log.facade';

const HQ = { lat: 48.9, lon: 9.2 };
const BOUNDS = { minLat: HQ.lat - 0.01, maxLat: HQ.lat + 0.01, minLon: HQ.lon - 0.01, maxLon: HQ.lon + 0.01 };
/** Where the cursor points: 500 m north of the HQ, next to a straight street (map-placement.service.spec.ts) */
const CURSOR = { lat: HQ.lat + 0.005, lon: HQ.lon };
const STREET = [
  { id: 1, lat: CURSOR.lat, lon: HQ.lon + 0.0002 },
  { id: 2, lat: CURSOR.lat, lon: HQ.lon - 0.0005 },
  { id: 3, lat: CURSOR.lat, lon: HQ.lon - 0.001 },
];
/** Turn of the preview while R is held (map-placement.service.ts TURN_SPEED): 15 degrees a second */
const TURN_SPEED = Math.PI / 12;

const geoToLocal = makeGeoToLocal(HQ);

/** The portal on STREET as it will stand, and how far R may turn it */
const STREET_POINTS = STREET.map((node) => {
  const p = geoToLocal(node.lat, node.lon, 0);
  return { x: p.x, z: p.z };
});
const STREET_POSE = spawnPortalPose(STREET_POINTS, 0, portalCorridorWidth(STREET[0]))!;
const STREET_TURN = portalTurnRange(STREET_POINTS, STREET_POSE, portalLaneOffset(STREET[0]));

/**
 * Playtest 534 (docs/archive/REVIEW_FIX_2026-09-14.md), second half, replayed: the
 * game is paused, the spawn preview of the real MapPlacementService stands on
 * its route start and is turned with R held, and the per-frame engine update
 * of the game loop facade runs as it does every frame.
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
          useValue: {
            findNearestStreetPoint: () => ({ distance: 1, street: { nodes: [{ id: STREET[0].id }] }, nodeIndex: 0 }),
            haversineDistance: () => (MIN_MANUAL_SPAWN_DISTANCE + MAX_MANUAL_SPAWN_DISTANCE) / 2,
            // The routes from the cursor's segment (SegmentRoutes): along STREET from its start
            segmentRoutes: () => ({ routeFrom: () => STREET }),
          },
        },
      ],
    });
    mapPlacement = runInInjectionContext(placementInjector, () => new MapPlacementService());
    mapPlacement.initialize(
      {
        getOverlayGroup: () => overlay,
        getTerrainHeightAtGeo: () => 0,
        getRenderer: () => ({ getSize: (target: Vector2) => target.set(1600, 900) }),
        sync: { geoToLocalSimple: geoToLocal },
      } as unknown as ThreeTilesEngine,
      { bounds: BOUNDS } as unknown as StreetNetwork,
      { ...HQ },
    );

    const store = {
      phase: signal('setup'),
      spawnPoints: signal([{}]),
      waveNumber: signal(0),
      directorEnabled: signal(false),
      waveExplanation: signal(null),
      directorError: signal(null),
      paused: signal(true),
    };
    const injector = Injector.create({
      providers: [
        { provide: EngineStore, useValue: {} },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
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
        { provide: WaveDirector, useValue: {} },
        { provide: StateSnapshotService, useValue: {} },
        { provide: BotClientService, useValue: { botEnabled: () => false } },
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
        rng: new GameRng(1),
      } as unknown as GameStateManager,
    );
  });

  it('534: with the game paused, R held turns the spawn preview in every frame, up to the limit of its opening', () => {
    mapPlacement.startPlacement('spawn');
    mapPlacement.updatePreviewPosition(CURSOR.lat, CURSOR.lon, 0);
    const preview = overlay.children.find((o) => o.name === 'placementPreview')!;
    const turned = () => preview.rotation.y - STREET_POSE.heading;
    // On the route start, facing along the route
    expect(turned()).toBeCloseTo(0, 6);

    // R down (InputHandlerService.handleKeyDown), then one frame of 250 ms
    expect(mapPlacement.startRotating()).toBe(true);
    facade.onEngineUpdate(250);
    expect(gameUpdate).toHaveBeenCalledTimes(1);
    const step = TURN_SPEED * 0.25;
    expect(STREET_TURN.max).toBeGreaterThan(step);
    expect(turned()).toBeCloseTo(step, 6);

    // Held on for 10 s of frames: it stops at the limit of the turn range
    for (let i = 0; i < 40; i++) facade.onEngineUpdate(250);
    expect(turned()).toBeCloseTo(STREET_TURN.max, 6);
  });
});
