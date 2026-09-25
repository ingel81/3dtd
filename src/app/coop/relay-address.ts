/**
 * Where the coop relay is (docs/COOP_PLAN.md, review R6, R7). Not built into
 * the game: asked in this order, the first source that names one wins.
 *
 * 1. The invite link (`&relay=`): a guest goes to the host's relay without
 *    setting anything.
 * 2. The player's own setting in the coop dialog (for a LAN or an own server).
 * 3. `coopRelay` in runtime-config.json: the site's relay, changed without a
 *    new build.
 * 4. Automatic: behind https the page's own host at /coop (a reverse proxy in
 *    front of the relay), on a LAN address that host at the relay's port, and
 *    finally this machine (`npm run coop-server`).
 *
 * One of 1 to 3 is the only address tried; the automatic ones are tried in
 * turn. Framework-free and pure.
 */

/** The port `npm run coop-server` listens on */
export const DEFAULT_RELAY_PORT = 3003;

/** 'lan': a game on the local network, found or hosted by the desktop app (C4d) */
export type RelaySource = 'link' | 'setting' | 'config' | 'auto' | 'lan';

export interface RelaySources {
  /** `relay` from the page's URL, as it came */
  fromLink: string | null;
  /** The player's setting */
  fromSetting: string | null;
  /** runtime-config.json */
  fromConfig: string | null;
  /** The page: `location.protocol` ("https:") and `location.hostname` */
  page: { protocol: string; hostname: string };
}

export interface RelayCandidates {
  source: RelaySource;
  /** The addresses to try, in order */
  urls: string[];
}

/** A relay address as it may be used: ws:// or wss://, a host, no user or password; null otherwise. */
export function validRelayUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.hostname || url.username || url.password) return null;
  return url.href.replace(/\/$/, '');
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '']);

/** The relays to try, see the file comment. */
export function relayCandidates(sources: RelaySources): RelayCandidates {
  const link = validRelayUrl(sources.fromLink);
  if (link) return { source: 'link', urls: [link] };
  const setting = validRelayUrl(sources.fromSetting);
  if (setting) return { source: 'setting', urls: [setting] };
  const config = validRelayUrl(sources.fromConfig);
  if (config) return { source: 'config', urls: [config] };

  const { protocol, hostname } = sources.page;
  const local = `ws://localhost:${DEFAULT_RELAY_PORT}`;
  const urls: string[] = [];
  if (protocol === 'https:' && !LOCAL.has(hostname)) urls.push(`wss://${hostname}/coop`);
  else if (protocol === 'http:' && !LOCAL.has(hostname)) urls.push(`ws://${hostname}:${DEFAULT_RELAY_PORT}`);
  urls.push(local);
  return { source: 'auto', urls };
}

/**
 * Whether an invite link should name `relay`: not when it is this machine,
 * which is another machine for the guest; their own automatic choice finds
 * the host's LAN address or the site's relay instead.
 */
export function relayForLink(relay: string): string | null {
  try {
    return LOCAL.has(new URL(relay).hostname) ? null : relay;
  } catch {
    return null;
  }
}

/** "relay.example.com" or "192.168.1.5:3003", for the dialog */
export function relayLabel(relay: string): string {
  try {
    return new URL(relay).host;
  } catch {
    return relay;
  }
}
