/**
 * The custom map the page shows now, in the editor or as a world; null for
 * a real place, DevWorld or the globes. The shared MapAssetLibrary keeps a
 * map's models and material pixels while its map stays in front, so the
 * switch between the editor and a test run of it loads nothing again, and
 * lets them go when another comes (MapAssetLibrary.retain, release).
 * Without imports, so the world session sets it without the library's code.
 */
let front: string | null = null;
const listeners = new Set<(mapId: string | null) => void>();

export function mapInFront(): string | null {
  return front;
}

/** `mapId` (null: none) is the map in front from now; the listeners hear a change */
export function bringMapToFront(mapId: string | null): void {
  if (mapId === front) return;
  front = mapId;
  for (const listener of [...listeners]) listener(mapId);
}

/** `listener` hears the map in front change; returns the unsubscribe */
export function onMapInFront(listener: (mapId: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
