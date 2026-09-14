import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { MEASURING_STEP, RelocationStatusService, StationProgress } from './relocation-status.service';

/**
 * The hint while the HQ moves: a step, painted before the work that blocks
 * the main thread, then the corridor measurement in whole percent until it
 * ends.
 */
describe('RelocationStatusService', () => {
  let frames: FrameRequestCallback[];
  let status: RelocationStatusService;
  const runFrame = () => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    const injector = Injector.create({
      providers: [{ provide: NgZone, useValue: { runOutsideAngular: (fn: () => unknown) => fn() } }],
    });
    status = runInInjectionContext(injector, () => new RelocationStatusService());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows a step and clears it', () => {
    status.show('Moving HQ', 'Finding the route');
    expect(status.status()).toEqual({ title: 'Moving HQ', step: 'Finding the route', percent: null });
    status.clear();
    expect(status.status()).toBeNull();
  });

  it('resolves painted() after the second frame, when the browser has painted once', async () => {
    let resolved = false;
    void status.painted().then(() => { resolved = true; });
    runFrame();
    await Promise.resolve();
    expect(resolved).toBe(false);
    runFrame();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('follows the measurement in whole percent until it ends, then clears and reports', () => {
    let progress: StationProgress | null = { done: 0, total: 300 };
    const done = vi.fn();
    status.show('Moving HQ', 'Finding the route');

    status.followCorridor(() => progress, done);
    expect(status.status()).toEqual({ title: 'Moving HQ', step: MEASURING_STEP, percent: 0 });

    progress = { done: 101, total: 300 };
    runFrame();
    expect(status.status()?.percent).toBe(33);
    expect(done).not.toHaveBeenCalled();

    progress = null;
    runFrame();
    expect(status.status()).toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });

  it('ends at once when the measurement is already over', () => {
    const done = vi.fn();
    status.show('Moving HQ', 'Finding the route');
    status.followCorridor(() => null, done);
    expect(status.status()).toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('stops following, without reporting, when another move shows its hint', () => {
    const done = vi.fn();
    status.show('Moving HQ', 'Finding the route');
    status.followCorridor(() => ({ done: 1, total: 10 }), done);

    status.show('Moving HQ', 'Loading streets');
    runFrame();

    expect(status.status()).toEqual({ title: 'Moving HQ', step: 'Loading streets', percent: null });
    expect(done).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});
