import { AudioLoader } from 'three';

/**
 * LRU buffer cache for audio files.
 * Handles loading, retry logic, and eviction of least-recently-used buffers.
 */
export class AudioBufferCache {
  private loader: AudioLoader;

  /** URL → cached buffer + loading promise */
  private bufferCache = new Map<string, { buffer: AudioBuffer | null; loading: Promise<AudioBuffer> | null }>();

  /** LRU tracking: oldest first */
  private bufferAccessOrder: string[] = [];

  /** Maximum number of cached buffers */
  private readonly MAX_CACHED_BUFFERS = 50;

  constructor(loader: AudioLoader) {
    this.loader = loader;
  }

  /**
   * Get or start loading a buffer for the given URL.
   * Returns the cache entry (buffer may still be loading).
   */
  getOrLoad(url: string): { buffer: AudioBuffer | null; loading: Promise<AudioBuffer> | null } {
    let cached = this.bufferCache.get(url);

    if (!cached) {
      cached = { buffer: null, loading: null };
      cached.loading = this.loadBuffer(url).then((buffer) => {
        cached!.buffer = buffer;
        cached!.loading = null;
        this.evictOldestBuffers();
        return buffer;
      });
      this.bufferCache.set(url, cached);
      this.touchBuffer(url);
    } else {
      this.touchBuffer(url);
    }

    return cached;
  }

  /** Number of cached buffers */
  get size(): number {
    return this.bufferCache.size;
  }

  /**
   * Load an audio buffer with retry logic.
   */
  private loadBuffer(url: string, retries = 3): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      const attemptLoad = (attemptsLeft: number) => {
        this.loader.load(
          url,
          (buffer) => resolve(buffer),
          undefined,
          (error) => {
            if (attemptsLeft > 0) {
              console.warn(`[AudioBufferCache] Failed to load ${url}, retrying... (${attemptsLeft} attempts left)`);
              setTimeout(() => attemptLoad(attemptsLeft - 1), 1000);
            } else {
              console.error('[AudioBufferCache] Failed to load after all retries:', url, error);
              reject(error);
            }
          }
        );
      };
      attemptLoad(retries);
    });
  }

  /**
   * LRU: Move URL to end of access order (most recently used).
   */
  private touchBuffer(url: string): void {
    const idx = this.bufferAccessOrder.indexOf(url);
    if (idx !== -1) {
      this.bufferAccessOrder.splice(idx, 1);
    }
    this.bufferAccessOrder.push(url);
  }

  /**
   * LRU: Evict oldest buffers if cache exceeds limit.
   */
  private evictOldestBuffers(): void {
    while (this.bufferAccessOrder.length > this.MAX_CACHED_BUFFERS) {
      const oldest = this.bufferAccessOrder.shift();
      if (oldest) {
        const cached = this.bufferCache.get(oldest);
        if (cached && !cached.loading) {
          this.bufferCache.delete(oldest);
        } else if (cached?.loading) {
          this.bufferAccessOrder.push(oldest);
          break;
        }
      }
    }
  }
}
