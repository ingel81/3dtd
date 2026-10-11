import type { WorldRef } from '../world-ref';
import { openedCustomMap } from './custom-map-world';
import { contentHash, packMapFile, unpackMapFile } from './map-file';
import { MapStore } from './map-store';

/**
 * A custom map handed from one player to another (coop: the host sends the
 * map the room plays, docs/COOP_PLAN.md). The file the host packs is the one
 * a guest stores: packing is deterministic, and the guest checks the content
 * hash before it keeps anything.
 */

/** The `.3dtdmap` bytes of the map this page plays, null when it plays none (or has not opened it) */
export function packOpenedMap(ref: WorldRef): { bytes: Uint8Array; hash: string } | null {
  if (ref.kind !== 'custom-map') return null;
  const map = openedCustomMap(ref);
  if (!map) return null;
  return { bytes: packMapFile(map.doc), hash: map.contentHash };
}

/**
 * Keep a map another player sent, so this page can open it as
 * `?world=map:<id>`: the file must be a map, with the id and content hash
 * named. It is kept as 'shared': a map here with that id and content is left
 * as it is, an earlier shared version is replaced (the host changed the
 * map), an own map of that id with other content is never overwritten, nor
 * is a shipped one hidden. Returns why it was not kept (a storage that
 * fails included), null when the map is here now.
 */
export async function storeSharedMap(
  bytes: Uint8Array,
  expected: { mapId: string; hash: string },
  store: MapStore = new MapStore(),
): Promise<string | null> {
  let unpacked: ReturnType<typeof unpackMapFile>;
  try {
    unpacked = unpackMapFile(bytes);
  } catch (error) {
    return `The host's map did not arrive whole (${error instanceof Error ? error.message : String(error)}).`;
  }
  const { doc, preview } = unpacked;
  try {
    if (doc.meta.id !== expected.mapId || (await contentHash(doc)) !== expected.hash) {
      return 'The host\'s map did not arrive as the host has it.';
    }
    const here = await store.load(expected.mapId).catch(() => null);
    if (here?.summary.contentHash === expected.hash) return null;
    if (here?.summary.origin === 'own') {
      return `You have a map of your own called "${here.doc.meta.name}" under the same id (${expected.mapId}). `
        + 'Rename or remove it in the editor to join this room.';
    }
    if (here?.summary.origin === 'shipped' || (await store.isShipped(expected.mapId))) {
      return `The host plays a changed copy of the shipped map "${doc.meta.name}" under its id (${expected.mapId}). `
        + 'The host can save it under another name in the editor and open the room again.';
    }
    await store.saveShared(doc, preview, bytes);
    return null;
  } catch (error) {
    return `The host's map could not be kept here (${error instanceof Error ? error.message : String(error)}).`;
  }
}
