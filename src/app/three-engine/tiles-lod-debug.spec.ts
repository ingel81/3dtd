import { describe, expect, it, vi } from 'vitest';
import type { TilesRenderer } from '3d-tiles-renderer';
import { QUIET_MS, SettleHold, createTilesLodDebug, waitForQuietTiles, type QuietTilesOptions } from './tiles-lod-debug';

/**
 * The tiles' LOD handle for `__tiles.stats()` and `__corridor.probeLod()`:
 * what it reads off the renderer, the error targets it sets, and the hold
 * on the settled tile loads, which hands one on when it is let go.
 */
describe('createTilesLodDebug', () => {
  function fakeRenderer() {
    const a = {};
    const b = {};
    const bytes = new Map<object, number>([[a, 3 * 2 ** 20], [b, 2 ** 19]]);
    return {
      errorTarget: 20,
      isLoading: false,
      stats: { queued: 0, downloading: 0, parsing: 0 },
      activeTiles: new Set([a, b]),
      visibleTiles: new Set([a]),
      lruCache: {
        cachedBytes: 50 * 2 ** 20,
        itemSet: new Map([[a, 0], [b, 0], [{}, 0]]),
        isFull: () => false,
        getMemoryUsage: (item: object) => bytes.get(item) ?? 0,
      },
      dispatchEvent: vi.fn(),
    };
  }

  it('reads the counts, the cache and both error targets', () => {
    const tiles = fakeRenderer();
    tiles.stats = { queued: 2, downloading: 3, parsing: 1 };
    const debug = createTilesLodDebug(tiles as unknown as TilesRenderer, { region: () => ({ errorTarget: 5 }), holdSettled: () => undefined });

    expect(debug.snapshot()).toEqual({
      regionErrorTarget: 5, cameraErrorTarget: 20, active: 2, visible: 1, activeMB: 3.5,
      cachedTiles: 3, cachedMB: 50, cacheFull: false, queued: 2, downloading: 3, parsing: 1,
    });
  });

  it('is busy while the renderer loads or a job waits', () => {
    const tiles = fakeRenderer();
    const debug = createTilesLodDebug(tiles as unknown as TilesRenderer, { region: () => null, holdSettled: () => undefined });
    expect(debug.busy()).toBe(false);
    tiles.isLoading = true;
    expect(debug.busy()).toBe(true);
    tiles.isLoading = false;
    tiles.stats.queued = 1;
    expect(debug.busy()).toBe(true);
  });

  it('sets the region target on the region in use and the camera target on the renderer, and asks for an update', () => {
    const tiles = fakeRenderer();
    let region: { errorTarget: number } | null = null;
    const debug = createTilesLodDebug(tiles as unknown as TilesRenderer, { region: () => region, holdSettled: () => undefined });

    expect(debug.setRegionErrorTarget(0)).toBe(false);
    expect(debug.snapshot().regionErrorTarget).toBeNull();

    region = { errorTarget: 5 };
    expect(debug.setRegionErrorTarget(2.5)).toBe(true);
    expect(region.errorTarget).toBe(2.5);
    debug.setCameraErrorTarget(1e6);
    expect(tiles.errorTarget).toBe(1e6);
    debug.requestUpdate();
    expect(tiles.dispatchEvent).toHaveBeenCalledTimes(3);
    expect(tiles.dispatchEvent).toHaveBeenCalledWith({ type: 'needs-update' });
  });
});

/**
 * The wait the corridor build takes before it measures. "Nothing is loading"
 * is not "everything is loaded": before the renderer has traversed once,
 * nothing is queued either, and in a background tab rAF never runs it. The
 * caller says with `ready` what it is actually waiting for.
 */
describe('waitForQuietTiles', () => {
  const FRAME_MS = 50;

  function run(busy: () => boolean, options?: QuietTilesOptions, timeoutMs = 10_000) {
    let clock = 0;
    const promise = waitForQuietTiles(
      { busy }, timeoutMs, async () => { clock += FRAME_MS; }, () => clock, options,
    );
    return { promise, clock: () => clock };
  }

  it('ends once nothing has loaded for QUIET_MS', async () => {
    const wait = run(() => false);
    expect(await wait.promise).toMatchObject({ timedOut: false, stopped: false });
    expect(wait.clock()).toBeGreaterThanOrEqual(QUIET_MS);
  });

  it('keeps waiting while the caller says its tiles are not there, and nudges the renderer', async () => {
    let ready = false;
    let nudges = 0;
    const wait = run(() => false, {
      ready: () => ready,
      nudge: () => { if (++nudges >= 3) ready = true; },
    });

    expect(await wait.promise).toMatchObject({ timedOut: false, stopped: false });
    expect(nudges).toBe(3);
    // Three nudges a second apart, then the quiet spell
    expect(wait.clock()).toBeGreaterThan(2 * 1000 + QUIET_MS);
  });

  it('times out when the tiles never come', async () => {
    const wait = run(() => false, { ready: () => false }, 2000);
    expect(await wait.promise).toMatchObject({ timedOut: true, stopped: false });
    expect(wait.clock()).toBeGreaterThanOrEqual(2000);
  });

  it('stops when the caller says so', async () => {
    expect(await run(() => true, { stop: () => true }).promise).toMatchObject({ stopped: true });
  });
});

describe('SettleHold', () => {
  it('lets settles through while off', () => {
    const settle = vi.fn();
    const hold = new SettleHold(settle);
    expect(hold.intercept()).toBe(false);
    expect(hold.held).toBe(false);
  });

  it('keeps settles back while held and hands one on when let go', () => {
    const settle = vi.fn();
    const hold = new SettleHold(settle);
    hold.hold(true);
    expect(hold.intercept()).toBe(true);
    expect(hold.intercept()).toBe(true);
    expect(settle).not.toHaveBeenCalled();

    hold.hold(false);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(hold.held).toBe(false);
    expect(hold.intercept()).toBe(false);
  });

  it('hands nothing on when no settle came while held', () => {
    const settle = vi.fn();
    const hold = new SettleHold(settle);
    hold.hold(true);
    hold.hold(false);
    expect(settle).not.toHaveBeenCalled();
  });
});
