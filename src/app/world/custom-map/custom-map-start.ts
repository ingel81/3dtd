import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { MAX_START_WAVE } from '../../sim/protocol/run-start';
import type { WorldCapabilities } from '../world-provider';
import type { WorldRef } from '../world-ref';
import type { CustomMapDocument } from './map-document';
import type { MapProblem } from './map-text';

/**
 * What the start of a custom map needs before its world is made, kept apart
 * from the world (custom-map-world.ts) so the page's first load does not
 * carry the world's code: the menu, the start order and the coop host read
 * these, the world itself comes with `import()` (WorldProviderRegistry).
 */

/** A map of its own: no real place, nothing streams, no credentials, nothing to roll again */
export const CUSTOM_MAP_CAPABILITIES: WorldCapabilities = {
  realPlace: false,
  streaming: false,
  ecef: false,
  credentials: false,
  regenerate: false,
  destructible: false,
  ownEnvironment: true,
  enemyRimLight: true,
  groundShadows: true,
  controls: 'environment',
};

/** A map as the game plays it: the document and the hash its WorldRef carries */
export interface LoadedCustomMap {
  doc: CustomMapDocument;
  contentHash: string;
  /** What reading the file set right or left out (map-repair.ts), in words: the game says it as the world opens */
  repaired?: readonly MapProblem[];
}

/**
 * How many of the map's spawns a run uses: `?spawns=N` in the link (1 to
 * MAX_SPAWN_PORTALS), else all of them up to that cap. The game shows a
 * portal for at most MAX_SPAWN_PORTALS; spawns past it stay unused.
 */
export function customMapSpawnLimit(search: string): number {
  const n = Number.parseInt(new URLSearchParams(search).get('spawns') ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_SPAWN_PORTALS) : MAX_SPAWN_PORTALS;
}

/** The link's parameter of the wave a test run starts at (the editor's "Test map" from wave N) */
export const START_WAVE_PARAM = 'fromWave';

/**
 * The wave a run on the map starts at: `?fromWave=N` in the link (2 to
 * MAX_START_WAVE), else 1. A test parameter of the editor for one player; a
 * coop guest opens the map without it and would not match the host's world.
 */
export function customMapStartWave(search: string): number {
  const n = Number.parseInt(new URLSearchParams(search).get(START_WAVE_PARAM) ?? '', 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, MAX_START_WAVE) : 1;
}

/**
 * The map opened before its world is made (WorldFactory.startHq loads,
 * create takes; the coop host packs it), by map id. Only the last one:
 * a page plays one map at a time, another world closes it (closeCustomMaps)
 */
const opened = new Map<string, LoadedCustomMap>();

/** Keeps the map openCustomMap loaded as the one opened (the one before goes) */
export function keepOpenedMap(mapId: string, map: LoadedCustomMap): void {
  opened.clear();
  opened.set(mapId, map);
}

/** The opened map goes with its world (WorldSession): the next world opens its own */
export function closeCustomMaps(): void {
  opened.clear();
}

/** The map `openCustomMap` loaded for this ref, null before */
export function openedCustomMap(ref: WorldRef & { kind: 'custom-map' }): LoadedCustomMap | null {
  return opened.get(ref.mapId) ?? null;
}
