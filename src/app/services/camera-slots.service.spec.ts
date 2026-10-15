import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { CameraSlotsService } from './camera-slots.service';
import { CameraControlService, type CameraView } from './camera-control.service';
import { LocationManagementService } from './location/location-management.service';
import { WorldContext } from '../world/world-context.service';
import { fakeWorldContext } from '../../test/world-context-fake';

const view = (x: number): CameraView => ({ position: { x, y: 200, z: 0 }, target: { x, y: 0, z: 100 } });

describe('CameraSlotsService (TODO E20)', () => {
  let service: CameraSlotsService;
  let now: CameraView | null;
  const glideTo = vi.fn(() => true);
  const hq = signal<{ lat: number; lon: number } | null>({ lat: 49.1, lon: 9.2 });
  let world: ReturnType<typeof fakeWorldContext>;

  beforeEach(() => {
    now = view(1);
    glideTo.mockClear();
    hq.set({ lat: 49.1, lon: 9.2 });
    world = fakeWorldContext();
    const injector = Injector.create({
      providers: [
        { provide: CameraControlService, useValue: { currentView: () => now, glideTo } },
        { provide: LocationManagementService, useValue: { hq } },
        { provide: WorldContext, useValue: world },
      ],
    });
    service = runInInjectionContext(injector, () => new CameraSlotsService());
  });

  it('saves the view now and glides back to it', () => {
    expect(service.store(2)).toBe(true);
    now = view(5);
    expect(service.recall(2)).toBe(true);
    expect(glideTo).toHaveBeenCalledWith(view(1));
  });

  it('has nothing to fly to in an empty slot or one out of range', () => {
    expect(service.recall(0)).toBe(false);
    expect(service.store(5)).toBe(false);
    expect(service.recall(-1)).toBe(false);
    expect(glideTo).not.toHaveBeenCalled();
  });

  it('reads empty on another HQ or world and keeps the views for a restart on the same place', () => {
    service.store(0);
    hq.set({ lat: 48.0, lon: 9.2 });
    expect(service.recall(0)).toBe(false);
    hq.set({ lat: 49.1, lon: 9.2 });
    expect(service.recall(0)).toBe(true);
    world.useCustomMap('demo-valley');
    expect(service.recall(0)).toBe(false);
  });

  it('saves nothing without a place', () => {
    hq.set(null);
    expect(service.store(0)).toBe(false);
    expect(service.saveState()).toBeNull();
  });

  it('hands its views to a save and takes a save back on the place it loaded', () => {
    expect(service.saveState()).toBeNull();
    service.store(1);
    const saved = service.saveState();
    expect(saved).toEqual([null, view(1), null, null, null]);

    service.restoreState([view(7)]);
    expect(service.views()).toEqual([view(7), null, null, null, null]);
    // A save without views empties them
    service.restoreState(undefined);
    expect(service.saveState()).toBeNull();
  });
});
