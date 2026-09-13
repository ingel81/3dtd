import { AudioLoader } from 'three';

/**
 * LRU buffer cache for audio files.
 * Handles loading, retry logic, and eviction of least-recently-used buffers.
 */
export class AudioBufferCache {
  private loader: AudioLoader;

  /** URL → cached buffer + loading promise */
  private bufferCache = new Map<string, { buffer: AudioBuffer | null; loading: Promise<AudioBuffer | null> | null }>();

  /** LRU tracking: maps URL → access counter (higher = more recent) */
  private accessTimestamps = new Map<string, number>();
  private accessCounter = 0;

  /** Maximum number of cached buffers */
  private readonly MAX_CACHED_BUFFERS = 50;

  /** URL → failed load rounds and when the next round may start, see getOrLoad(). */
  private failures = new Map<string, { rounds: number; retryAt: number }>();

  /** A URL that failed all retries is not loaded again for this long. */
  private readonly RETRY_COOLDOWN_MS = 30_000;

  /** Failed rounds (each with its retries) after which a URL stays failed. */
  private readonly MAX_LOAD_ROUNDS = 3;

  constructor(loader: AudioLoader) {
    this.loader = loader;
  }

  /**
   * Get or start loading a buffer for the given URL.
   * Returns the cache entry (buffer may still be loading). Its load answers
   * null for a file that failed all retries, it does not reject.
   *
   * A load that fails all retries leaves no entry behind, so a later
   * registration loads the file again. Enemies register their sounds on
   * every spawn, so that happens only after RETRY_COOLDOWN_MS and at most
   * MAX_LOAD_ROUNDS times per URL; until then the entry has neither buffer
   * nor load, which every player treats as "cannot play".
   */
  getOrLoad(url: string): { buffer: AudioBuffer | null; loading: Promise<AudioBuffer | null> | null } {
    let cached = this.bufferCache.get(url);

    if (!cached) {
      if (this.isFailed(url)) return { buffer: null, loading: null };
      const entry: { buffer: AudioBuffer | null; loading: Promise<AudioBuffer | null> | null } = { buffer: null, loading: null };
      entry.loading = this.loadBuffer(url).then(
        (buffer) => {
          entry.buffer = buffer;
          entry.loading = null;
          this.failures.delete(url);
          this.evictOldestBuffers();
          return buffer;
        },
        () => {
          if (this.bufferCache.get(url) === entry) {
            this.bufferCache.delete(url);
            this.accessTimestamps.delete(url);
          }
          const rounds = (this.failures.get(url)?.rounds ?? 0) + 1;
          this.failures.set(url, { rounds, retryAt: Date.now() + this.RETRY_COOLDOWN_MS });
          return null;
        },
      );
      cached = entry;
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

  /** The URL failed and is waiting out its cooldown, or has used up its rounds. */
  private isFailed(url: string): boolean {
    const failure = this.failures.get(url);
    if (!failure) return false;
    return failure.rounds >= this.MAX_LOAD_ROUNDS || Date.now() < failure.retryAt;
  }

  /**
   * LRU: Mark URL as most recently used via incrementing counter.
   */
  private touchBuffer(url: string): void {
    this.accessTimestamps.set(url, ++this.accessCounter);
  }

  /**
   * LRU: Evict oldest buffers if cache exceeds limit.
   */
  private evictOldestBuffers(): void {
    while (this.accessTimestamps.size > this.MAX_CACHED_BUFFERS) {
      // Find the least-recently-used entry
      let oldestUrl = '';
      let oldestTime = Infinity;
      for (const [url, time] of this.accessTimestamps) {
        if (time < oldestTime) {
          const cached = this.bufferCache.get(url);
          // Don't evict entries that are still loading
          if (cached && !cached.loading) {
            oldestTime = time;
            oldestUrl = url;
          }
        }
      }
      if (!oldestUrl) break;
      this.bufferCache.delete(oldestUrl);
      this.accessTimestamps.delete(oldestUrl);
    }
  }
}
