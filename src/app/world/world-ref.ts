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
