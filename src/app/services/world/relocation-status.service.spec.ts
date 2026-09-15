import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { RelocationStatusService } from './relocation-status.service';

/**
 * The hint while HQ or spawn move: a step, painted before the work that
 * blocks the main thread, then the steps of the corridor build with their
 * percentage until it ends.
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
    status = runInInjectionContext(Injector.create({ providers: [] }), () => new RelocationStatusService());
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

  it('follows the steps of the corridor build with their percentage, then takes the hint away', () => {
    status.show('Moving HQ', 'Finding the route');
    const hint = status.follow();
    const set = vi.spyOn(status.status, 'set');

    hint.report({ step: 'Measuring the corridor', percent: 33 });
    expect(status.status()).toEqual({ title: 'Moving HQ', step: 'Measuring the corridor', percent: 33 });
    // The same again changes nothing
    hint.report({ step: 'Measuring the corridor', percent: 33 });
    expect(set).toHaveBeenCalledTimes(1);
    hint.report({ step: 'Building the corridor', percent: null });
    expect(status.status()).toEqual({ title: 'Moving HQ', step: 'Building the corridor', percent: null });

    hint.end();
    expect(status.status()).toBeNull();
  });

  it('leaves the hint of a later move alone', () => {
    status.show('Moving HQ', 'Finding the route');
    const hint = status.follow();

    status.show('Moving HQ', 'Loading streets');
    hint.report({ step: 'Measuring the corridor', percent: 50 });
    hint.end();

    expect(status.status()).toEqual({ title: 'Moving HQ', step: 'Loading streets', percent: null });
  });

  it('shows nothing when no hint stands', () => {
    const hint = status.follow();
    hint.report({ step: 'Measuring the corridor', percent: 10 });
    expect(status.status()).toBeNull();
  });
});
