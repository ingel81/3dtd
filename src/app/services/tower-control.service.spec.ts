import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EnvironmentInjector, Injector, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { PerspectiveCamera } from 'three';

// The services the tower control drives, as bare tokens
vi.mock('../sim/client/sim-client.service', () => ({ SimClient: class SimClient {} }));
vi.mock('./tower-selection.service', () => ({ TowerSelectionService: class TowerSelectionService {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({ EngineInitializationService: class EngineInitializationService {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));
vi.mock('./ability-targeting.service', () => ({ AbilityTargetingService: class AbilityTargetingService {} }));
vi.mock('./hero-control.service', () => ({ HeroControlService: class HeroControlService {} }));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./keyboard-pan.service', () => ({ KeyboardPanService: class KeyboardPanService {} }));
vi.mock('./input-handler.service', () => ({ InputHandlerService: class InputHandlerService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({ IntroCameraFlightService: class IntroCameraFlightService {} }));
vi.mock('./boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class UIStore {} }));
vi.mock('../store/tower-defense.store', () => ({ TowerDefenseStore: class TowerDefenseStore {} }));

import { TowerControlService } from './tower-control.service';
import { SimClient } from '../sim/client/sim-client.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { createMainEventBus } from '../sim/client/view-events';
import { TowerSelectionService } from './tower-selection.service';
import { ShotPrediction } from './shot-prediction';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { HeroControlService } from './hero-control.service';
import { CameraControlService } from './camera-control.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { InputHandlerService } from './input-handler.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { BossIntroService } from './boss-intro.service';
import { UIStore } from '../store/ui.store';
import { TowerDefenseStore } from '../store/tower-defense.store';

/**
 * Getting out of a manned tower when a new run begins (review f16). On a new
 * place SimClient.newRun drops the leave command with the old run's queue;
 * the simulation's own tower:manned comes with the new world's first packet,
 * after the new place framed the camera, or not at all.
 */
describe('TowerControlService: a new run', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  function setup() {
    const bus = createMainEventBus();
    const camera = new PerspectiveCamera(60);
    camera.position.set(1, 2, 3);
    const controls = { enabled: true };
    const canvas = document.createElement('canvas');
    canvas.requestPointerLock = () => undefined as never;
    const engine = {
      getCamera: () => camera,
      getControls: () => controls,
      getRenderer: () => ({ domElement: canvas }),
      towerBadges: { hideFor: vi.fn() },
      spatialAudio: { setFeedbackMinDistance: vi.fn() },
    };
    const tower = { id: 'tower-1', typeConfig: { name: 'Cannon' }, manualAim: { heading: 0, pitch: 0 }, triggerHeld: false };
    const off = signal(false);
    const injector = Injector.create({
      parent: TestBed.inject(EnvironmentInjector),
      providers: [
        TowerControlService,
        { provide: SimClient, useValue: { bus } },
        { provide: SimMirror, useValue: { mannedTower: () => tower } },
        { provide: TowerSelectionService, useValue: {} },
        { provide: ShotPrediction, useValue: { clear: () => undefined } },
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        { provide: TowerPlacementService, useValue: {} },
        { provide: MapPlacementService, useValue: {} },
        { provide: AbilityTargetingService, useValue: {} },
        { provide: HeroControlService, useValue: {} },
        { provide: CameraControlService, useValue: {} },
        { provide: KeyboardPanService, useValue: {} },
        { provide: InputHandlerService, useValue: {} },
        { provide: IntroCameraFlightService, useValue: { active: off } },
        { provide: BossIntroService, useValue: { active: off } },
        { provide: UIStore, useValue: { photoMode: off, replayMode: off, mapPlacementMode: signal(null) } },
        { provide: TowerDefenseStore, useValue: { mannedTowerId: signal<string | null>(null), loading: off, error: signal(null) } },
        { provide: LiveAnnouncer, useValue: { announce: () => undefined } },
      ],
    });
    const control = injector.get(TowerControlService);
    return { bus, camera, controls, control };
  }

  it('puts the camera back at once, and the late tower:manned of the old run leaves the new view alone', () => {
    const { bus, camera, controls } = setup();
    bus.emit({ type: 'tower:manned', towerId: 'tower-1', playerId: 'local', local: true });
    expect(controls.enabled).toBe(false);
    // On the tower's eye point
    camera.position.set(9, 9, 9);

    bus.emit({ type: 'game:reset' });
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
    expect(controls.enabled).toBe(true);

    // The new place frames its camera; then the old run's leave arrives
    camera.position.set(100, 0, 0);
    bus.emit({ type: 'tower:manned', towerId: null, playerId: 'local', local: true });
    expect(camera.position.toArray()).toEqual([100, 0, 0]);
  });
});
