import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_LINGER_MS, MapAssetLibrary } from './map-asset-library';

describe('MapAssetLibrary while views come and go', () => {
  afterEach(() => vi.useRealTimers());

  it('stays for the next view of its map, goes once none draws from it for a while; one of its own owner stays', () => {
    vi.useFakeTimers();
    const shared = MapAssetLibrary.shared('linger-test/');
    const dispose = vi.spyOn(shared, 'dispose');
    // The editor's view, then the test run's view while the editor's goes, then back
    shared.retain();
    shared.retain();
    shared.release();
    vi.advanceTimersByTime(LIBRARY_LINGER_MS * 2);
    shared.release();
    vi.advanceTimersByTime(LIBRARY_LINGER_MS / 2);
    shared.retain();
    vi.advanceTimersByTime(LIBRARY_LINGER_MS * 2);
    expect(dispose).not.toHaveBeenCalled();
    // Back to the globes: no view comes
    shared.release();
    vi.advanceTimersByTime(LIBRARY_LINGER_MS);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(MapAssetLibrary.shared('linger-test/')).not.toBe(shared);
    MapAssetLibrary.shared('linger-test/').dispose();

    const own = new MapAssetLibrary('own-test/');
    const ownDispose = vi.spyOn(own, 'dispose');
    own.retain();
    own.release();
    vi.advanceTimersByTime(LIBRARY_LINGER_MS * 2);
    expect(ownDispose).not.toHaveBeenCalled();
  });
});
