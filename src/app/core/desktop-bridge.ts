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

/** The player's map folder, desktop build only (Documents/3DTD/Maps, desktop/src/maps-folder.js) */
export interface DesktopMapFolder {
  /** Every .3dtdmap in the folder: name, size, modification time (ms) */
  list(): Promise<{ name: string; size: number; mtime: number }[]>;
  /** The file's bytes, or null */
  read(name: string): Promise<Uint8Array | null>;
  /** Writes the file; its modification time, or null when it could not */
  write(name: string, bytes: Uint8Array): Promise<{ mtime: number } | null>;
  /** True when the file is gone */
  remove(name: string): Promise<boolean>;
  /** Shows the folder in the system's file manager */
  reveal(): void;
  /** Calls `listener` with the file name of a map the player double-clicked; returns an unsubscribe */
  onOpen(listener: (name: string) => void): () => void;
}

/** A tool call of an AI agent for the open map editor (desktop/src/agent-mcp.js, docs/AGENT_MCP.md) */
export interface AgentCall {
  tool: string;
  args: Record<string, unknown>;
}

/** The editor's answer: data as JSON text, a picture with it, or an error */
export interface AgentAnswer {
  text: string;
  /** Base64 without the data: prefix */
  image?: { mimeType: string; data: string };
  isError?: boolean;
}

/** One call of an agent as the band shows it */
export interface AgentCallInfo {
  tool: string;
  /** What it does, for the player ("runs the script hill") */
  what: string;
  /** Since when it runs (ms since 1970), or when it ended */
  at: number;
  /** Ended calls: whether it went through */
  ok?: boolean;
}

/** Whether AI agents may edit maps, where they connect, who came and what it does */
export interface AgentStatus {
  enabled: boolean;
  /** The MCP address while it is on */
  url: string | null;
  /** Why it could not start */
  error?: string;
  /** The player pressed Stop: every call is refused until Resume */
  held?: boolean;
  /** The agent that last reached the server: its name (the MCP client's) and when (ms since 1970) */
  client?: { name: string | null; lastSeen: number } | null;
  /** The call running now and the one before */
  current?: AgentCallInfo | null;
  last?: AgentCallInfo | null;
}

/** AI agents editing maps over MCP, desktop build only (docs/AGENT_MCP.md) */
export interface AgentBridge {
  /**
   * The open editor answers the agent's calls: `handler` calls `reply` once with plain data. What
   * it returns is ignored: a zone.js promise does not survive the context bridge. Returns an
   * unsubscribe. One handler at a time
   */
  onCall(handler: (call: AgentCall, reply: (answer: AgentAnswer) => void) => void): () => void;
  status(): Promise<AgentStatus>;
  /** The settings switch "Allow AI agents to edit maps" */
  setEnabled(on: boolean): Promise<AgentStatus>;
  /** Calls `listener` with the status at once and on every change (a call starts or ends); returns an unsubscribe */
  onStatus?(listener: (status: AgentStatus) => void): () => void;
  /** Stop in the agent band: the call running now ends, every call after is refused; resolves the new status */
  stop?(): Promise<AgentStatus>;
  /** The agent may go on */
  resume?(): Promise<AgentStatus>;
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
  /** The window's fullscreen, as F11 switches it; resolves the new state. Missing before 0.5.1 (TODO A3) */
  toggleFullscreen?(): Promise<boolean>;
  /** Whether the window is fullscreen. Missing before 0.5.1 */
  isFullscreen?(): Promise<boolean>;
  /** Quit the app; a downloaded update installs on the way out. Missing before 0.5.1 */
  quit?(): void;
  /** The map folder; missing in apps before the custom maps */
  readonly maps?: DesktopMapFolder;
  /** AI agents over MCP; missing in apps before E171 */
  readonly agent?: AgentBridge;
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

/** The AI agent side of the desktop bridge, or null in a browser and in older apps. */
export function readAgentBridge(host?: unknown): AgentBridge | null {
  const agent = readDesktopBridge(host)?.agent as Partial<AgentBridge> | undefined;
  if (!agent || typeof agent.onCall !== 'function' || typeof agent.status !== 'function' || typeof agent.setEnabled !== 'function') return null;
  return agent as AgentBridge;
}
