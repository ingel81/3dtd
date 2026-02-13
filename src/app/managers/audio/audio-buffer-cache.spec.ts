import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { AudioBufferCache } from './audio-buffer-cache';

// Minimal AudioLoader mock that resolves immediately
function createMockLoader(resolveDelay = 0) {
  return {
    load: vi.fn((url: string, onLoad: (buffer: AudioBuffer) => void) => {
      const fakeBuffer = { duration: 1, length: 44100, sampleRate: 44100, numberOfChannels: 1 } as unknown as AudioBuffer;
      if (resolveDelay === 0) {
        onLoad(fakeBuffer);
      } else {
        setTimeout(() => onLoad(fakeBuffer), resolveDelay);
      }
    }),
  };
}

// Helper: access private fields for LRU verification
function getAccessTimestamps(cache: AudioBufferCache): Map<string, number> {
  return (cache as unknown as { accessTimestamps: Map<string, number> }).accessTimestamps;
}

function getAccessCounter(cache: AudioBufferCache): number {
  return (cache as unknown as { accessCounter: number }).accessCounter;
}

describe('AudioBufferCache', () => {
  let loader: ReturnType<typeof createMockLoader>;
  let cache: AudioBufferCache;

  beforeEach(() => {
    loader = createMockLoader();
    cache = new AudioBufferCache(loader as never);
  });

  describe('touchBuffer via getOrLoad', () => {
    it('should assign increasing timestamps on access', () => {
      cache.getOrLoad('a.mp3');
      cache.getOrLoad('b.mp3');
      cache.getOrLoad('c.mp3');

      const timestamps = getAccessTimestamps(cache);
      expect(timestamps.get('a.mp3')).toBe(1);
      expect(timestamps.get('b.mp3')).toBe(2);
      expect(timestamps.get('c.mp3')).toBe(3);
    });

    it('should update timestamp when re-accessing an existing entry', () => {
      cache.getOrLoad('a.mp3');
      cache.getOrLoad('b.mp3');
      // Re-access a.mp3
      cache.getOrLoad('a.mp3');

      const timestamps = getAccessTimestamps(cache);
      // a.mp3 was touched again, so it should have a higher counter than b.mp3
      expect(timestamps.get('a.mp3')!).toBeGreaterThan(timestamps.get('b.mp3')!);
      expect(getAccessCounter(cache)).toBe(3);
    });

    it('should not create duplicate cache entries on re-access', () => {
      cache.getOrLoad('a.mp3');
      cache.getOrLoad('a.mp3');
      cache.getOrLoad('a.mp3');

      expect(cache.size).toBe(1);
      expect(getAccessTimestamps(cache).size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('should evict the oldest non-loading buffer when exceeding limit', async () => {
      // Override MAX_CACHED_BUFFERS for testing
      (cache as unknown as { MAX_CACHED_BUFFERS: number }).MAX_CACHED_BUFFERS = 3;

      // Load 3 buffers (fills the cache)
      const entry1 = cache.getOrLoad('1.mp3');
      const entry2 = cache.getOrLoad('2.mp3');
      const entry3 = cache.getOrLoad('3.mp3');

      // Wait for all loads to complete (they resolve synchronously in our mock)
      await entry1.loading;
      await entry2.loading;
      await entry3.loading;

      expect(cache.size).toBe(3);

      // Touch 2.mp3 to make it more recent than 1.mp3
      cache.getOrLoad('2.mp3');

      // Load a 4th buffer - this triggers eviction after loading completes
      const entry4 = cache.getOrLoad('4.mp3');
      await entry4.loading;

      // 1.mp3 should have been evicted (oldest non-loading)
      expect(cache.size).toBe(3);
      const timestamps = getAccessTimestamps(cache);
      expect(timestamps.has('1.mp3')).toBe(false);
      expect(timestamps.has('2.mp3')).toBe(true);
      expect(timestamps.has('3.mp3')).toBe(true);
      expect(timestamps.has('4.mp3')).toBe(true);
    });

    it('should not evict entries that are still loading', async () => {
      // Use a delayed loader so entries stay in loading state
      const delayedLoader = createMockLoader(100);
      const delayedCache = new AudioBufferCache(delayedLoader as never);
      (delayedCache as unknown as { MAX_CACHED_BUFFERS: number }).MAX_CACHED_BUFFERS = 2;

      // Start loading 3 entries (none will have completed yet)
      delayedCache.getOrLoad('1.mp3');
      delayedCache.getOrLoad('2.mp3');
      delayedCache.getOrLoad('3.mp3');

      // All 3 should still be in cache since they're all loading
      expect(delayedCache.size).toBe(3);
      expect(getAccessTimestamps(delayedCache).size).toBe(3);
    });
  });

  describe('Map-based LRU ordering', () => {
    it('should correctly identify oldest entry among many', () => {
      (cache as unknown as { MAX_CACHED_BUFFERS: number }).MAX_CACHED_BUFFERS = 5;

      // Load entries in order
      for (let i = 1; i <= 5; i++) {
        cache.getOrLoad(`${i}.mp3`);
      }

      // Touch entries 1, 3, 5 to make them recent
      cache.getOrLoad('1.mp3');
      cache.getOrLoad('3.mp3');
      cache.getOrLoad('5.mp3');

      const timestamps = getAccessTimestamps(cache);
      // Entry 2 should have the lowest timestamp (oldest untouched)
      const entry2Time = timestamps.get('2.mp3')!;
      const entry4Time = timestamps.get('4.mp3')!;
      // 2 and 4 were not re-touched; 2 is older than 4
      expect(entry2Time).toBeLessThan(entry4Time);
      // Re-touched entries should have higher timestamps
      expect(timestamps.get('1.mp3')!).toBeGreaterThan(entry4Time);
      expect(timestamps.get('3.mp3')!).toBeGreaterThan(entry4Time);
      expect(timestamps.get('5.mp3')!).toBeGreaterThan(entry4Time);
    });
  });
});
