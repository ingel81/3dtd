import { describe, expect, it, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { EngineInitializationService } from './engine-initialization.service';
import { IntroLoadingGate, type IntroLoadingGateDeps } from '../world/intro-loading-gate';
import { OverpassError } from '../../world/osm/overpass-client';

/** Hands the NgZone a pass-through and every other service an empty object: the steps need none of them */
class StubInjector extends Injector {
  override get(token: unknown): unknown {
    return token === NgZone ? { run: (fn: () => unknown) => fn() } : {};
  }
}

const create = () => runInInjectionContext(new StubInjector(), () => new EngineInitializationService());

/**
 * The loading steps after the corridor rework (tmp/archive-2026-09/fix1/reports/bootsteps.md):
 * the step "Waiting for 3D Tiles" had no wait of its own any more and ran
 * after the corridor build, whose step holds that wait.
 */
describe('EngineInitializationService loading steps', () => {
  it('has no step of its own for the 3D tiles, and the same steps, all pending, after a reset', () => {
    const init = create();
    const ids = ['location', 'engine', 'streets', 'hq', 'spawns', 'routes', 'grid', 'view', 'corridor', 'flight'];
    expect(init.loadingSteps().map((s) => s.id)).toEqual(ids);

    // One list for both: a step done on one load is pending again on the next
    void init.setStepCurrent('engine');
    void init.setStepDone('streets', '3 Streets');
    init.resetLoadingSteps();
    expect(init.loadingSteps().map((s) => s.id)).toEqual(ids);
    expect(init.loadingSteps().every((s) => s.status === 'pending' && s.meta === undefined)).toBe(true);
  });

  it('ends loading only once tiles, streets and heights are all done', () => {
    const init = create();
    const heights = signal(true);
    init.osmLoading.set(false);
    init.tilesLoading.set(false);

    init.checkAllLoaded(heights);
    expect(init.loading()).toBe(true);

    heights.set(false);
    init.tilesLoading.set(true);
    init.checkAllLoaded(heights);
    expect(init.loading()).toBe(true);

    init.tilesLoading.set(false);
    init.checkAllLoaded(heights);
    expect(init.loading()).toBe(false);
  });

  /**
   * The corridor build waits for the tiles of its region, not for the first
   * tiles the engine reports. Should those still be missing once it froze,
   * the screen waits under the flight step, and it never shows a step that
   * is not current or done.
   */
  it('keeps one step current after the corridor while the first tiles are missing, and ends with all done', () => {
    const init = create();
    for (const step of init.loadingSteps().slice(0, -1)) void init.setStepDone(step.id);
    init.osmLoading.set(false);
    init.tilesLoading.set(true);
    const readiness = vi.fn(() => 0);
    const gate = new IntroLoadingGate({
      engineInit: init,
      heightUpdate: { heightsLoading: signal(false) },
      pathRoute: { getCachedPaths: () => new Map([['spawn-1', []]]) },
      introFlight: { prepare: () => true, readiness, prepareTick: vi.fn() },
      recheck: vi.fn(),
    } as unknown as IntroLoadingGateDeps);
    const statuses = () => init.loadingSteps().map((s) => s.status);

    expect(gate.hold()).toBe(false);
    expect(statuses().filter((s) => s === 'current')).toHaveLength(1);
    expect(init.loadingSteps().find((s) => s.status === 'current')?.id).toBe('flight');

    init.tilesLoading.set(false);
    readiness.mockReturnValue(1);
    expect(gate.hold()).toBe(false);
    expect(statuses().every((s) => s === 'done')).toBe(true);
    gate.dispose();
  });
});

describe('EngineInitializationService street load', () => {
  const load = (fail: Error) => {
    const service = create();
    const world = { streets: { loadStreets: vi.fn(async () => Promise.reject(fail)) } };
    service.configure({} as HTMLCanvasElement, { lat: 48.78, lon: 9.18 }, world as never);
    return service.loadStreets(48.78, 9.18);
  };

  it('says a failed load failed, and a load ended for a world that went or a place chosen instead only cancelled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(load(new OverpassError('The map servers for the streets are busy or out of reach.', 'busy')))
      .resolves.toMatchObject({ count: 0, failed: true, cancelled: false });
    await expect(load(new OverpassError('The OSM download was cancelled', 'cancelled')))
      .resolves.toMatchObject({ count: 0, failed: false, cancelled: true });
    vi.restoreAllMocks();
  });
});
