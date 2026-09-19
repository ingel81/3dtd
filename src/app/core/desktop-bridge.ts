/**
 * What the desktop build (Electron, desktop/src/preload.js) exposes to the
 * game as `window.desktop`. The web build has no such object; the game asks
 * for it in one place, the update hint, and renders nothing without it.
 */

/** A downloaded update, installed when the player quits. */
export interface DesktopUpdate {
  version: string;
}

export interface DesktopBridge {
  /** Version of the installed app, the root package.json's. */
  readonly version: string;
  /** Calls `listener` once an update is downloaded (at once if it already is); returns an unsubscribe. */
  onUpdateReady(listener: (update: DesktopUpdate) => void): () => void;
  /** Quit, install the downloaded update and start the new version. */
  installUpdateNow(): void;
}

/**
 * The bridge of the desktop build, or null in a browser. Checks the shape
 * rather than trusting any `desktop` property a page script might have set.
 */
export function readDesktopBridge(host: unknown = typeof window === 'undefined' ? undefined : window): DesktopBridge | null {
  const candidate = (host as { desktop?: unknown } | undefined)?.desktop as Partial<DesktopBridge> | undefined;
  if (
    !candidate ||
    typeof candidate.version !== 'string' ||
    typeof candidate.onUpdateReady !== 'function' ||
    typeof candidate.installUpdateNow !== 'function'
  ) {
    return null;
  }
  return candidate as DesktopBridge;
}
