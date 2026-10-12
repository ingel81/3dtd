import type { BootStep } from './boot-step.model';

/** The loading plate's numbers, from the boot steps (EngineInitializationService.loadingSteps) */
export interface LoadingPlateView {
  /** Steps done of all, 0 to 100 */
  percent: number;
  done: number;
  total: number;
  /** The step under way, else the next one due; null when all are done */
  current: BootStep | null;
  /** Its place in the list, 1-based ("8 of 10"); total + 1 when all are done */
  position: number;
}

export function loadingPlateView(steps: readonly BootStep[]): LoadingPlateView {
  const total = steps.length;
  const done = steps.filter((step) => step.status === 'done').length;
  const current = steps.find((step) => step.status === 'current') ?? steps.find((step) => step.status === 'pending') ?? null;
  return {
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    done,
    total,
    current,
    position: current ? steps.indexOf(current) + 1 : total + 1,
  };
}

/**
 * The line under the plate while the custom maps' files load from the site
 * (map-data.ts, TODO E134): how many have come and how much from the
 * network. Null once all have come, or when none came from the network
 * (all from the cache: nothing worth saying).
 */
export function mapDataLine(p: { requested: number; done: number; fetched: number; bytes: number }): string | null {
  if (p.done >= p.requested || p.fetched === 0) return null;
  const mb = p.bytes / 1_000_000;
  return `Map data ${p.done} of ${p.requested} files, ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The map tiles while they stream in: how many stand, how many are still coming, and the share that stands */
export interface TilesProgress {
  loaded: number;
  pending: number;
  percent: number;
}

/**
 * The tiles' line under the plate (TileStats: `total` the tiles in use,
 * `downloading` and `parsing` the ones still coming). Null while none are
 * coming: the line shows only while the map streams in. The share grows
 * and can step back a little when the renderer asks for more.
 */
export function tilesProgress(stats: { total: number; downloading: number; parsing: number }): TilesProgress | null {
  const pending = stats.downloading + stats.parsing;
  if (pending === 0) return null;
  return { loaded: stats.total, pending, percent: Math.floor((stats.total / (stats.total + pending)) * 100) };
}
