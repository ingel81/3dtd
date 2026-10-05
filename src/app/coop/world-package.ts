import type { GeoPosition, RouteWaypoint } from '../models/game.types';
import type { WaveSourceId } from '../director/wave-source';
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
  /** run-log/config-hash.ts: the balance of the host, without its wave source (that is `waveSource`) */
  configHash: string;
  /** The wave source the host plays; the joiner plays it too (absent from hosts before it) */
  waveSource?: WaveSourceId;
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
  head: { gameVersion: string; configHash: string; waveSource?: WaveSourceId },
): WorldPackage {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    format: FORMAT,
    version: WORLD_PACKAGE_VERSION,
    gameVersion: head.gameVersion,
    configHash: head.configHash,
    ...(head.waveSource ? { waveSource: head.waveSource } : {}),
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { world: null, refusal: 'not-a-world' };
  }
  const data = worldPackageShape(parsed);
  if (!data) return { world: null, refusal: 'not-a-world' };
  if (data.version !== WORLD_PACKAGE_VERSION) return { world: null, refusal: 'version' };
  if (data.gameVersion !== here.gameVersion) return { world: null, refusal: 'other-game' };
  if (data.configHash !== here.configHash) return { world: null, refusal: 'other-balance' };
  return { world: data as WorldPackage, refusal: null };
}

/**
 * `data` as a world package when it has the shape of one (format, places,
 * routes, heights), null otherwise; version, game and balance are the
 * caller's to judge. A save game carries one too (TODO E110).
 */
export function worldPackageShape(data: unknown): WorldPackage | null {
  const world = data as Partial<WorldPackage> | null;
  if (
    world?.format !== FORMAT || !Array.isArray(world.paths) || !Array.isArray(world.heights)
    || !Array.isArray(world.spawns) || !world.origin || !world.hq || typeof world.worldKey !== 'string'
  ) {
    return null;
  }
  return worldShapeOk(world as WorldPackage) ? (world as WorldPackage) : null;
}

/** Routes, waypoints and grid cells a package holds at most: far above a real place */
const MAX_ROUTES = 64;
const MAX_WAYPOINTS = 200_000;
const MAX_HEIGHT_ROWS = 5_000_000;

const finiteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const placeOk = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) return false;
  const { lat, lon, height } = v as Record<string, unknown>;
  return finiteNumber(lat) && Math.abs(lat) <= 90 && finiteNumber(lon) && Math.abs(lon) <= 180
    && (height === undefined || finiteNumber(height));
};

/**
 * The package's routes, spawns and heights in the shape the world build
 * reads: a host's package with NaN places or a height row of another shape
 * would stop the guest's simulation.
 */
function worldShapeOk(data: WorldPackage): boolean {
  if (!placeOk(data.origin) || !placeOk(data.hq)) return false;
  if (data.spawns.length > MAX_ROUTES || !data.spawns.every((s) => placeOk(s) && typeof s.id === 'string')) return false;
  if (data.paths.length > MAX_ROUTES) return false;
  let waypoints = 0;
  for (const route of data.paths) {
    if (!Array.isArray(route) || typeof route[0] !== 'string' || !Array.isArray(route[1])) return false;
    waypoints += route[1].length;
    if (waypoints > MAX_WAYPOINTS || !route[1].every(placeOk)) return false;
  }
  return data.heights.length <= MAX_HEIGHT_ROWS
    && data.heights.every((row) => Array.isArray(row) && row.length === 3 && row.every(finiteNumber));
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
