import { AudioLoader } from 'three';

/**
 * Loads and caches the decoded music tracks, by URL. A load in flight is
 * shared between everyone who asks for the same track.
 */
export class MusicBufferLoader {
  private readonly loader = new AudioLoader();

  // Buffer cache: url → AudioBuffer (avoids reloading)
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly loadingPromises = new Map<string, Promise<AudioBuffer | null>>();

  /**
   * Buffer for `url`, or null when it fails to load. Never rejects: the
   * in-flight promise is shared between the preload and a phase change that
   * asks for the same track, and the phase change does not catch.
   */
  load(url: string): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(url);
    if (cached) return Promise.resolve(cached);

    const existing = this.loadingPromises.get(url);
    if (existing) return existing;

    const promise = new Promise<AudioBuffer | null>((resolve) => {
      this.loader.load(
        url,
        (buffer) => {
          this.bufferCache.set(url, buffer);
          resolve(buffer);
        },
        undefined,
        (err) => {
          console.warn(`[BackgroundMusic] Failed to load: ${url}`, err);
          resolve(null);
        },
      );
    }).finally(() => {
      // Runs after settling, never inside load(), so the entry goes even
      // when the loader calls back before the set() below.
      this.loadingPromises.delete(url);
    });

    this.loadingPromises.set(url, promise);
    return promise;
  }
}
