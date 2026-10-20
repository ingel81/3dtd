import { packOffThread } from './map-pack';
import type { CustomMapDocument } from './map-document';
import { MapStore } from './map-store';
import { unpackOffThread, type UnpackedFile } from './map-unpack';
import { mapErrorMessage } from './map-text';
import type { Messages } from '../../i18n/messages/en';

/**
 * A custom map handed from one player to another (coop: the host sends the
 * map the room plays, docs/COOP_PLAN.md). The file the host packs is the one
 * a guest stores: packing is deterministic, and the guest checks the content
 * hash before it keeps anything.
 */

/**
 * The `.3dtdmap` bytes of a map to hand on, packed in a worker (an OSM
 * world takes over a second): the file the map store would write
 */
export async function packMapOffThread(doc: CustomMapDocument): Promise<Uint8Array> {
  return (await packOffThread(doc)).file;
}

/**
 * Whether this browser has the map another player plays, with that very
 * content (stored, shared before, or shipped): then none of its pieces need
 * to come
 */
export async function hasMapHere(expected: { mapId: string; hash: string }, store: MapStore = new MapStore()): Promise<boolean> {
  const here = await store.load(expected.mapId).catch(() => null);
  return here?.summary.contentHash === expected.hash;
}

/**
 * Keep a map another player sent, so this page can open it as
 * `?world=map:<id>`: the file must be a map, with the id and content hash
 * named. It is kept as 'shared': a map here with that id and content is left
 * as it is, an earlier shared version is replaced (the host changed the
 * map), an own map of that id with other content is never overwritten, nor
 * is a shipped one hidden. Returns why it was not kept (a storage that
 * fails included), null when the map is here now; `sharedMapText` words it.
 */
export async function storeSharedMap(
  bytes: Uint8Array,
  expected: { mapId: string; hash: string },
  store: MapStore = new MapStore(),
): Promise<SharedMapRefusal | null> {
  let unpacked: UnpackedFile;
  try {
    unpacked = await unpackOffThread(bytes, { hash: true });
  } catch (error) {
    return { kind: 'not-whole', error };
  }
  const { doc, preview, contentHash: hash } = unpacked;
  try {
    if (doc.meta.id !== expected.mapId || hash !== expected.hash) {
      return { kind: 'differs' };
    }
    const here = await store.load(expected.mapId).catch(() => null);
    if (here?.summary.contentHash === expected.hash) return null;
    if (here?.summary.origin === 'own') {
      return { kind: 'own-same-id', name: here.doc.meta.name, id: expected.mapId };
    }
    if (here?.summary.origin === 'shipped' || (await store.isShipped(expected.mapId))) {
      return { kind: 'shipped-changed', name: doc.meta.name, id: expected.mapId };
    }
    await store.saveShared(doc, preview, bytes, hash);
    return null;
  } catch (error) {
    return { kind: 'not-kept', error };
  }
}

/** Why a map another player sent was not kept (storeSharedMap) */
export type SharedMapRefusal =
  | { kind: 'not-whole' | 'not-kept'; error: unknown }
  | { kind: 'differs' }
  | { kind: 'own-same-id' | 'shipped-changed'; name: string; id: string };

/** The refusal in the language of `t` */
export function sharedMapText(t: Messages, refusal: SharedMapRefusal): string {
  const w = t.coop.notes;
  switch (refusal.kind) {
    case 'not-whole': return w.mapNotWhole(mapErrorMessage(t, refusal.error));
    case 'not-kept': return w.mapNotKept(mapErrorMessage(t, refusal.error));
    case 'differs': return w.mapDiffers;
    case 'own-same-id': return w.mapOwnSameId(refusal.name, refusal.id);
    case 'shipped-changed': return w.mapShippedChanged(refusal.name, refusal.id);
  }
}
