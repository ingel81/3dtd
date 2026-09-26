/**
 * What 3d-tiles-renderer (0.5.2) keeps on a TilesRenderer and its
 * declarations leave out. The one place that reaches past the typings: check
 * these fields when the library is updated.
 */
export interface TilesRendererInternals {
  /** Traversals run; TilesRendererBase bumps it once per update, not when UpdateOnChangePlugin skips one */
  frameCount: number;
  isLoading: boolean;
  /** Tiles waiting for a download slot, downloading and parsing, counted per frame */
  stats: { queued: number; downloading: number; parsing: number };
  lruCache: {
    cachedBytes: number;
    itemSet: Map<unknown, unknown>;
    isFull(): boolean;
    getMemoryUsage(item: unknown): number;
  };
}

/** `tiles` (a TilesRenderer) with the fields its typings omit. */
export function tilesInternals(tiles: object): TilesRendererInternals {
  return tiles as TilesRendererInternals;
}

/** Tiles queued, downloading or parsing. */
export function tilesPending(tiles: object): number {
  const { queued, downloading, parsing } = tilesInternals(tiles).stats;
  return queued + downloading + parsing;
}
