import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed; the key handling needs no engine
vi.mock('../../three-engine', () => ({}));
vi.mock('../camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./route-animation.service', () => ({ RouteAnimationService: class RouteAnimationService {} }));

import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { IntroCameraFlightService } from './intro-camera-flight.service';
import { CameraControlService } from '../camera-control.service';
import { RouteAnimationService } from './route-animation.service';

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
