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

/** A coop game found on the local network (desktop/src/lan-discovery.js) */
export interface LanGame {
  code: string;
  /** The host's name */
  host: string;
  players: number;
  gameVersion: string;
  protocol: number;
  /** The best of `endpoints`: in this machine's subnet if one is */
  address: string;
  port: number;
  /** Every address the host was heard on, best first */
  endpoints: { address: string; port: number }[];
}

/** Coop on the local network, desktop build only (docs/COOP_PLAN.md, C4d) */
export interface CoopLanBridge {
  /** Start this machine's relay; its port and this machine's addresses, or why not */
  host(): Promise<{ port: number; addresses: { name: string; address: string }[] } | { error: string }>;
  /** End this machine's relay */
  stop(): void;
  /** Look for games until the returned function is called; the whole list on every change */
  scan(listener: (games: LanGame[]) => void): () => void;
  /** Ask one address directly, during a scan; true when its relay answered */
  probe(ip: string): Promise<boolean>;
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
  /** Missing in apps older than C4d */
  readonly coopLan?: CoopLanBridge;
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

/** The LAN side of the desktop bridge, or null in a browser and in older apps. */
export function readCoopLan(host?: unknown): CoopLanBridge | null {
  const lan = readDesktopBridge(host)?.coopLan as Partial<CoopLanBridge> | undefined;
  if (
    !lan ||
    typeof lan.host !== 'function' ||
    typeof lan.stop !== 'function' ||
    typeof lan.scan !== 'function' ||
    typeof lan.probe !== 'function'
  ) {
    return null;
  }
  return lan as CoopLanBridge;
}
