import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { IntroLoadingGate, type IntroLoadingGateDeps } from './intro-loading-gate';
import { INTRO_GATE_MIN_READY, INTRO_GATE_SAMPLES_PER_FRAME, INTRO_GATE_TIMEOUT_MS } from '../../utils/flight-gate';

/**
 * On the first load the loading screen stays up after tiles, streets and
 * heights until the intro flight has reliable heights along most of its
 * route, or until a timeout after the first tiles. Meanwhile the route is
 * sampled once a frame.
 */
describe('IntroLoadingGate', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let cachedPaths: Map<string, unknown[]>;
  let deps: ReturnType<typeof fakeDeps>;
  let gate: IntroLoadingGate;

  function fakeDeps() {
    return {
      engineInit: {
        tilesLoading: signal(false),
        osmLoading: signal(false),
        getFirstTilesLoadedAt: vi.fn((): number | null => performance.now()),
        setStepDone: vi.fn(async (_id: string, _meta?: string) => undefined),
        setStepCurrent: vi.fn(async (_id: string) => undefined),
        updateStepMeta: vi.fn(),
      },
      heightUpdate: { heightsLoading: signal(false) },
      pathRoute: { getCachedPaths: vi.fn(() => cachedPaths) },
      introFlight: { prepare: vi.fn(() => true), readiness: vi.fn(() => 0), prepareTick: vi.fn() },
      recheck: vi.fn(),
    };
  }

  const runFrames = (times = 1) => {
    for (let i = 0; i < times; i++) {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    }
  };

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    cachedPaths = new Map([['spawn-1', []]]);
    deps = fakeDeps();
    gate = new IntroLoadingGate(deps as unknown as IntroLoadingGateDeps);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not hold while tiles, streets or heights are still loading', () => {
    for (const loading of [deps.engineInit.tilesLoading, deps.engineInit.osmLoading, deps.heightUpdate.heightsLoading]) {
      loading.set(true);
      expect(gate.hold()).toBe(false);
      loading.set(false);
    }
    expect(deps.introFlight.prepare).not.toHaveBeenCalled();
  });

  /**
   * The step "Waiting for 3D Tiles" is gone, its wait is the corridor
   * build's. Should the first tiles still be missing after the build, the
   * screen waits under this step instead of under none.
   */
  it('shows its step while only the first tiles are missing, not while streets or heights load', () => {
    deps.engineInit.tilesLoading.set(true);
    deps.heightUpdate.heightsLoading.set(true);
    expect(gate.hold()).toBe(false);
    expect(deps.engineInit.setStepCurrent).not.toHaveBeenCalled();

    deps.heightUpdate.heightsLoading.set(false);
    expect(gate.hold()).toBe(false);
    expect(deps.engineInit.setStepCurrent).toHaveBeenCalledWith('flight');
    expect(deps.introFlight.prepare).not.toHaveBeenCalled();
  });

  it('holds and samples the route a frame at a time until it is ready', () => {
    deps.introFlight.readiness.mockReturnValue(0.5);

    expect(gate.hold()).toBe(true);
    expect(deps.introFlight.prepare).toHaveBeenCalledWith(cachedPaths);
    expect(deps.engineInit.setStepCurrent).toHaveBeenCalledWith('flight');
    expect(deps.engineInit.updateStepMeta).toHaveBeenCalledWith('flight', '50 % of the route');

    // Asking again before the frame requests no second one.
    expect(gate.hold()).toBe(true);
    expect(frames.size).toBe(1);

    runFrames();
    expect(deps.introFlight.prepareTick).toHaveBeenCalledWith(INTRO_GATE_SAMPLES_PER_FRAME);
    expect(deps.recheck).toHaveBeenCalledTimes(1);

    deps.introFlight.readiness.mockReturnValue(INTRO_GATE_MIN_READY);
    expect(gate.hold()).toBe(false);
    expect(deps.engineInit.setStepDone).toHaveBeenLastCalledWith('flight', `${Math.floor(INTRO_GATE_MIN_READY * 100)} % of the route`);
    expect(deps.introFlight.prepare).toHaveBeenCalledTimes(1);
  });

  it('stays open once passed', () => {
    deps.introFlight.readiness.mockReturnValue(1);
    expect(gate.hold()).toBe(false);
    deps.introFlight.readiness.mockReturnValue(0);
    expect(gate.hold()).toBe(false);
    expect(deps.introFlight.readiness).toHaveBeenCalledTimes(1);
  });

  it('opens at the timeout after the first tiles', () => {
    deps.engineInit.getFirstTilesLoadedAt.mockReturnValue(performance.now() - INTRO_GATE_TIMEOUT_MS);
    expect(gate.hold()).toBe(false);
    expect(deps.engineInit.setStepDone).toHaveBeenCalledWith('flight', '0 % of the route');
  });

  it('counts the timeout from now when no tile has arrived yet', () => {
    deps.engineInit.getFirstTilesLoadedAt.mockReturnValue(null);
    expect(gate.hold()).toBe(true);
  });

  it('does not wait without a route or when the flight cannot be prepared', () => {
    cachedPaths = new Map();
    expect(gate.hold()).toBe(false);
    expect(deps.introFlight.prepare).not.toHaveBeenCalled();
    expect(deps.engineInit.setStepDone).toHaveBeenCalledWith('flight');

    gate.dispose();
    cachedPaths = new Map([['spawn-1', []]]);
    deps.introFlight.prepare.mockReturnValue(false);
    expect(gate.hold()).toBe(false);
    expect(deps.engineInit.setStepDone).toHaveBeenCalledTimes(2);
  });

  it('cancels its frame on dispose and holds again on the next load', () => {
    deps.introFlight.readiness.mockReturnValue(0.5);
    gate.hold();

    gate.dispose();
    expect(frames.size).toBe(0);

    expect(gate.hold()).toBe(true);
    expect(deps.introFlight.prepare).toHaveBeenCalledTimes(2);
  });
});
