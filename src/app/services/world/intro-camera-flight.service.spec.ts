import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed; the key handling needs no engine
vi.mock('../../three-engine', () => ({}));
vi.mock('../camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./route-animation.service', () => ({ RouteAnimationService: class RouteAnimationService {} }));

import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { IntroCameraFlightService } from './intro-camera-flight.service';
import { CameraControlService } from '../camera-control.service';
import { RouteAnimationService } from './route-animation.service';
import { UIStore } from '../../store/ui.store';
import type { Vector3 } from 'three';

function press(key: string, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

/**
 * Keys during the intro flight: Esc skips it, every other game key is held
 * back, typing in a field and an Esc a dialog took stay theirs.
 */
describe('IntroCameraFlightService keys', () => {
  let service: IntroCameraFlightService;
  let resetCamera: ReturnType<typeof vi.fn>;

  /** The flight as beginRun() leaves it, without a route or an engine */
  const startFlight = () => {
    (service as unknown as { running: boolean }).running = true;
    service.active.set(true);
  };

  beforeEach(() => {
    resetCamera = vi.fn();
    const injector = Injector.create({
      providers: [
        { provide: CameraControlService, useValue: { resetCamera } },
        { provide: RouteAnimationService, useValue: { setHoldUntilReleased: vi.fn() } },
        { provide: UIStore, useValue: { replayMode: () => false } },
        { provide: NgZone, useValue: { run: (fn: () => void) => fn() } },
      ],
    });
    service = runInInjectionContext(injector, () => new IntroCameraFlightService());
  });

  it('leaves every key to the game while no flight plays', () => {
    const event = press('Escape');
    expect(service.handleKeyDown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(resetCamera).not.toHaveBeenCalled();
  });

  it('Esc skips the flight and jumps to the game view', () => {
    startFlight();
    const event = press('Escape');
    expect(service.handleKeyDown(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(service.isRunning()).toBe(false);
    expect(service.active()).toBe(false);
    expect(resetCamera).toHaveBeenCalledTimes(1);
  });

  it('holds the other game keys back and keeps flying', () => {
    startFlight();
    for (const key of ['Home', 'n', ' ', 'w', '1', 'h', 'u']) {
      const event = press(key);
      expect(service.handleKeyDown(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(service.isRunning()).toBe(true);
    expect(resetCamera).not.toHaveBeenCalled();
  });

  it('leaves typing in a field and an Esc a dialog took alone', () => {
    startFlight();
    expect(service.handleKeyDown(press('a', document.createElement('input')))).toBe(false);
    const taken = press('Escape');
    taken.preventDefault();
    expect(service.handleKeyDown(taken)).toBe(false);
    expect(service.isRunning()).toBe(true);
  });
});

/**
 * A world's own flight (a custom map's intro): flown instead of the tour,
 * swung into from the start view, then pulled back into the overview.
 */
describe('IntroCameraFlightService world shot', () => {
  it('flies the shot, then lands in the overview', async () => {
    const { PerspectiveCamera } = await import('three');
    const camera = new PerspectiveCamera(50, 1, 1, 10000);
    camera.position.set(0, 400, -150);
    camera.lookAt(0, 0, 0);
    const controls = { enabled: true };
    const shot = {
      seconds: 10,
      poseAt: (t: number, position: Vector3, look: Vector3) => {
        position.set(100 + t * 10, 50, 0);
        look.set(0, 0, 0);
      },
    };
    const engine = {
      world: { introShot: () => shot, introTour: () => null },
      getCamera: () => camera,
      getControls: () => controls,
      getRenderer: () => ({ domElement: document.createElement('canvas') }),
    };
    const injector = Injector.create({
      providers: [
        { provide: CameraControlService, useValue: { getOverview: () => ({ position: { x: 0, y: 300, z: -200 }, target: { x: 0, y: 0, z: 0 } }) } },
        { provide: RouteAnimationService, useValue: { setHoldUntilReleased: vi.fn() } },
        { provide: UIStore, useValue: { replayMode: () => false } },
        { provide: NgZone, useValue: { run: (fn: () => void) => fn() } },
      ],
    });
    const service = runInInjectionContext(injector, () => new IntroCameraFlightService());
    service.initialize(engine as never);

    service.start(new Map([['s', [{ lat: 0, lon: 0 }, { lat: 0.01, lon: 0 }]]]));
    expect(service.isRunning()).toBe(true);
    expect(service.debugState().phase).toBe('shot');
    expect(controls.enabled).toBe(false);

    // Past the swing in (enterSec 3): on the shot's pose
    for (let i = 0; i < 50; i++) service.update(100);
    expect(service.debugState().phase).toBe('shot');
    expect(camera.position.x).toBeCloseTo(150, 0);
    expect(camera.position.y).toBeCloseTo(50, 5);

    // Past its 10 s: the outro, then the overview
    for (let i = 0; i < 60; i++) service.update(100);
    expect(service.debugState().phase).toBe('outro');
    for (let i = 0; i < 40; i++) service.update(100);
    expect(service.isRunning()).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.toArray()).toEqual([0, 300, -200]);
  });
});
