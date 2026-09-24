import type { GeoPosition, RouteWaypoint } from '../models/game.types';
import type { SpawnPoint } from '../managers/wave.manager';

/** Bumped whenever the shape changes; another version is refused. */
export const WORLD_PACKAGE_VERSION = 1;
const FORMAT = '3dtd-world';

/**
 * The world of a coop room as the host built it (docs/COOP_PLAN.md, C1):
 * everything the simulation stands on that came from Overpass, the route
 * search or the tiles. A joiner builds its world from this instead of asking
 * those again, which could answer differently (another Overpass reply,
 * other tiles loaded, another corridor measured).
 *
 * The routes carry what the corridor build measured (widths, bridges,
 * tunnels, passages); the cells follow from them. The heights are the
 * cells' as the host's build froze them. The tiles stay each client's own:
 * after the freeze they are picture only.
 */
export interface WorldPackage {
  format: typeof FORMAT;
  version: number;
  /** BUILD_VERSION of the host; a joiner must run the same */
  gameVersion: string;
  /** run-log/config-hash.ts: the balance of the host */
  configHash: string;
  /** GameStateManager.worldKey of the host's world; the joiner's must come out the same */
  worldKey: string;
  /** The local frame's origin (CoordinateSync) */
  origin: GeoPosition;
  hq: GeoPosition;
  spawns: SpawnPoint[];
  /** Spawn id and its route, as the corridor build left it */
  paths: [string, RouteWaypoint[]][];
  /** GlobalRouteGrid.exportHeights: [cell key, height, 1 stable / 2 filled] */
  heights: [number, number, number][];
}

/** What the package is made from; the GameStateManager of a finished world has it all. */
export interface WorldSource {
  origin: GeoPosition;
  hq: GeoPosition;
  spawns: readonly SpawnPoint[];
  paths: ReadonlyMap<string, readonly RouteWaypoint[]>;
  heights: [number, number, number][];
  worldKey: string;
}

/** Pack the world; everything is copied, the package stays valid whatever the game does next. */
export function buildWorldPackage(
  world: WorldSource,
  head: { gameVersion: string; configHash: string },
): WorldPackage {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    format: FORMAT,
    version: WORLD_PACKAGE_VERSION,
    gameVersion: head.gameVersion,
    configHash: head.configHash,
    worldKey: world.worldKey,
    origin: copy(world.origin),
    hq: copy(world.hq),
    spawns: copy([...world.spawns]),
    paths: copy([...world.paths.entries()].map(([id, path]) => [id, [...path]])),
    heights: world.heights.map(([key, y, state]) => [key, y, state]),
  };
}

/** Why a package cannot be joined here, null when it can. */
export type WorldPackageRefusal = 'not-a-world' | 'version' | 'other-game' | 'other-balance';

/** Parse `text` and check it against the game running here. */
export function readWorldPackage(
  text: string,
  here: { gameVersion: string; configHash: string },
): { world: WorldPackage; refusal: null } | { world: null; refusal: WorldPackageRefusal } {
  let data: Partial<WorldPackage>;
  try {
    data = JSON.parse(text) as Partial<WorldPackage>;
  } catch {
    return { world: null, refusal: 'not-a-world' };
  }
  if (
    data?.format !== FORMAT || !Array.isArray(data.paths) || !Array.isArray(data.heights)
    || !Array.isArray(data.spawns) || !data.origin || !data.hq || typeof data.worldKey !== 'string'
  ) {
    return { world: null, refusal: 'not-a-world' };
  }
  if (data.version !== WORLD_PACKAGE_VERSION) return { world: null, refusal: 'version' };
  if (data.gameVersion !== here.gameVersion) return { world: null, refusal: 'other-game' };
  if (data.configHash !== here.configHash) return { world: null, refusal: 'other-balance' };
  return { world: data as WorldPackage, refusal: null };
}

/** What the player reads when a room's world does not load. */
export function worldPackageRefusalText(refusal: WorldPackageRefusal | 'other-world'): string {
  switch (refusal) {
    case 'not-a-world': return 'The host sent no 3DTD world.';
    case 'version': return 'The host runs another version of the coop world format.';
    case 'other-game': return 'The host runs another version of the game. Both need the same one.';
    case 'other-balance': return 'The host plays with other tower or enemy values.';
    case 'other-world': return 'The world built here came out different from the host\'s.';
  }
}

/** The routes of a package as the spawn id map the game keeps. */
export function packagePaths(world: WorldPackage): Map<string, RouteWaypoint[]> {
  return new Map(world.paths);
}
