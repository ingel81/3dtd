/**
 * What the desktop build (Electron, desktop/src/preload.js) exposes to the
 * game as `window.desktop`. The web build has no such object; the game asks
 * for it where it matters (the update hint, the run log) and does without it
 * everywhere else.
 */

/** A downloaded update, installed when the player quits. */
export interface DesktopUpdate {
  version: string;
  /** Its CHANGELOG.md section (markdown), empty without one. */
  notes?: string;
}

export interface DesktopBridge {
  /** Version of the installed app, the root package.json's. */
  readonly version: string;
  /** Calls `listener` once an update is downloaded (at once if it already is); returns an unsubscribe. */
  onUpdateReady(listener: (update: DesktopUpdate) => void): () => void;
  /** Quit, install the downloaded update and start the new version. */
  installUpdateNow(): void;
  /**
   * Write a run log into the app's `runs` folder. The page hands over the
   * file name and the JSONL text; where it lands is the app's business
   * (docs/RUN_LOG.md). Resolves false when it could not be written.
   */
  saveRun(fileName: string, text: string): Promise<boolean>;
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
    typeof candidate.installUpdateNow !== 'function' ||
    typeof candidate.saveRun !== 'function'
  ) {
    return null;
  }
  return candidate as DesktopBridge;
}
