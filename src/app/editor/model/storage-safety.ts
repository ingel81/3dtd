/**
 * How safe the player's maps are where the editor keeps them. A browser may
 * clear IndexedDB when the disk runs short, maps and versions with it,
 * unless the site holds persistent storage (`navigator.storage.persist()`).
 * The desktop app writes every map to its map folder too.
 */
import { readDesktopBridge } from '../../core/desktop-bridge';

/** 'folder': the desktop map folder holds a copy; 'kept': persistent storage; 'evictable': the browser may clear them */
export type StorageSafety = 'folder' | 'kept' | 'evictable';

/** Editing this long without a download brings the reminder, when the browser may clear the maps */
export const DOWNLOAD_REMINDER_MS = 30 * 60_000;

/** The part of `navigator.storage` this needs */
export interface PersistentStorage {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

/**
 * Where the maps stand; with `ask` the browser is asked for persistent
 * storage when it has not granted it yet (Firefox shows a prompt, Chrome
 * decides on its own). Failures count as 'evictable'.
 */
export async function storageSafety(
  ask: boolean,
  storage: PersistentStorage | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage,
  folder = !!readDesktopBridge()?.maps,
): Promise<StorageSafety> {
  if (folder) return 'folder';
  try {
    if (!storage?.persisted) return 'evictable';
    if (await storage.persisted()) return 'kept';
    if (ask && storage.persist && (await storage.persist())) return 'kept';
  } catch {
    // An API that throws keeps nothing for sure
  }
  return 'evictable';
}
