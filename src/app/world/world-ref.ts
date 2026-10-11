/**
 * Which world a run plays on. Saved games, replay files, run logs, the coop
 * world package, the URL and bot runs all carry this one field, and the
 * world provider registry turns it back into a provider.
 *
 * A tiles world's place is not part of the ref: the run's origin, HQ and
 * spawns already say where it is.
 */
export type WorldRef =
  | { kind: 'tiles'; source: 'cesium' | 'google' }
  | { kind: 'devworld'; terrain: string; seed: number; buildings: string; spawns: number }
  | { kind: 'custom-map'; mapId: string; contentHash: string; name?: string };

export type WorldKind = WorldRef['kind'];

/** True when both refs name the same world (a map with other content is another world) */
export function sameWorld(a: WorldRef, b: WorldRef): boolean {
  switch (a.kind) {
    case 'tiles':
      return b.kind === 'tiles' && a.source === b.source;
    case 'devworld':
      return (
        b.kind === 'devworld' &&
        a.terrain === b.terrain &&
        a.seed === b.seed &&
        a.buildings === b.buildings &&
        a.spawns === b.spawns
      );
    case 'custom-map':
      return b.kind === 'custom-map' && a.mapId === b.mapId && a.contentHash === b.contentHash;
  }
}

/** Short label for logs and the menu */
export function worldLabel(ref: WorldRef): string {
  switch (ref.kind) {
    case 'tiles':
      return `tiles ${ref.source}`;
    case 'devworld':
      return `devworld ${ref.terrain}/${ref.seed}`;
    case 'custom-map':
      return `map ${ref.name ?? ref.mapId}`;
  }
}

/** URL parameter naming a world other than the default: `?world=map:<id>` */
export const WORLD_URL_PARAM = 'world';

/**
 * The custom map a link asks for (`?world=map:<id>`), null for none. The
 * content hash comes from the stored map when it is opened; the link does
 * not carry it.
 */
export function customMapRefFromSearch(search: string): WorldRef | null {
  const value = new URLSearchParams(search).get(WORLD_URL_PARAM);
  const id = value?.startsWith('map:') ? value.slice(4).trim() : '';
  return id ? { kind: 'custom-map', mapId: id, contentHash: '' } : null;
}

/** The `?world=` value of a ref, null for the worlds without one (tiles, DevWorld has `?devworld`) */
export function worldUrlValue(ref: WorldRef): string | null {
  return ref.kind === 'custom-map' ? `map:${ref.mapId}` : null;
}

/** The name a world of its own shows where a real place shows its address; null for the tiles */
export function worldPlaceName(ref: WorldRef): string | null {
  switch (ref.kind) {
    case 'tiles':
      return null;
    case 'devworld':
      return 'Dev world';
    case 'custom-map':
      return ref.name ?? ref.mapId;
  }
}

/** The DevWorld a file of before the WorldRef meant: the defaults of `?devworld` */
export const LEGACY_DEV_WORLD_REF: WorldRef = { kind: 'devworld', terrain: 'flat', seed: 42, buildings: 'dense', spawns: 1 };

/**
 * The world a file without `world` was played on (a save, replay, run log or
 * coop package of before the field): DevWorld when its origin is the
 * synthetic (0, 0), the 3D tiles of `tilesSource` otherwise.
 */
export function legacyWorldRef(origin: { lat: number; lon: number }, tilesSource: 'cesium' | 'google'): WorldRef {
  return origin.lat === 0 && origin.lon === 0 ? LEGACY_DEV_WORLD_REF : { kind: 'tiles', source: tilesSource };
}

/**
 * Whether a run of `a` can stand on `b`: a save, a replay or a coop room.
 * The 3D tiles are the same place through either source (after the corridor
 * froze they are picture only); the other worlds must be the same world.
 * A file of before the content hash (empty) matches any content of its map.
 */
export function worldsMatch(a: WorldRef, b: WorldRef): boolean {
  if (a.kind === 'tiles' || b.kind === 'tiles') return a.kind === b.kind;
  if (a.kind === 'custom-map' && b.kind === 'custom-map' && (a.contentHash === '' || b.contentHash === '')) {
    return a.mapId === b.mapId;
  }
  return sameWorld(a, b);
}

/** A WorldRef read from a file: the shape checked, null for anything else */
export function worldRefShape(data: unknown): WorldRef | null {
  if (typeof data !== 'object' || data === null) return null;
  const ref = data as Record<string, unknown>;
  switch (ref['kind']) {
    case 'tiles':
      return ref['source'] === 'cesium' || ref['source'] === 'google' ? { kind: 'tiles', source: ref['source'] } : null;
    case 'devworld':
      return typeof ref['terrain'] === 'string' && Number.isFinite(ref['seed']) && typeof ref['buildings'] === 'string'
        && Number.isInteger(ref['spawns'])
        ? { kind: 'devworld', terrain: ref['terrain'], seed: ref['seed'] as number, buildings: ref['buildings'], spawns: ref['spawns'] as number }
        : null;
    case 'custom-map':
      return typeof ref['mapId'] === 'string' && typeof ref['contentHash'] === 'string'
        ? {
          kind: 'custom-map', mapId: ref['mapId'], contentHash: ref['contentHash'],
          ...(typeof ref['name'] === 'string' ? { name: ref['name'] } : {}),
        }
        : null;
    default:
      return null;
  }
}
