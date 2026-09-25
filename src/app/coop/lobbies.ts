/**
 * The online lobbies a player can play over (docs/COOP_PLAN.md, D58): the
 * site's own from runtime-config.json, plus any the player added. One is
 * active; the dock shows only its name. Framework-free and pure; CoopService
 * keeps the player's part in localStorage.
 */
import { relayLabel, validRelayUrl } from './relay-address';

export interface Lobby {
  /** Its address, which is also what tells two lobbies apart */
  url: string;
  name: string;
  /** From runtime-config.json: the player cannot remove it */
  builtIn: boolean;
}

/** What the player added and chose, as stored */
export interface StoredLobbies {
  custom: { name: string; url: string }[];
  /** The url of the active lobby; null for the first one */
  active: string | null;
}

export const NO_STORED_LOBBIES: StoredLobbies = { custom: [], active: null };

/** Longest lobby name kept */
const NAME_MAX = 40;

/**
 * The site's lobbies: `coopLobbies` of runtime-config.json, else its single
 * `coopRelay`. An entry with `"desktopOnly": true` takes only the desktop
 * app (D59); a browser leaves it out, it would be refused there.
 */
export function builtInLobbies(coopLobbies: unknown, coopRelay: string | null, desktop = true): Lobby[] {
  const lobbies: Lobby[] = [];
  if (Array.isArray(coopLobbies)) {
    for (const entry of coopLobbies) {
      const url = validRelayUrl((entry as { url?: unknown } | null)?.url as string);
      if (!url || lobbies.some((l) => l.url === url)) continue;
      if ((entry as { desktopOnly?: unknown }).desktopOnly === true && !desktop) continue;
      lobbies.push({ url, name: lobbyName((entry as { name?: unknown }).name, url), builtIn: true });
    }
  }
  const relay = validRelayUrl(coopRelay);
  if (relay && !lobbies.some((l) => l.url === relay)) lobbies.push({ url: relay, name: relayLabel(relay), builtIn: true });
  return lobbies;
}

/** Stored JSON as lobbies the player added and the active one; anything odd is dropped */
export function readStoredLobbies(json: string | null): StoredLobbies {
  if (!json) return NO_STORED_LOBBIES;
  try {
    const data = JSON.parse(json) as { custom?: unknown; active?: unknown };
    const custom = Array.isArray(data.custom)
      ? data.custom.flatMap((entry) => {
        const url = validRelayUrl((entry as { url?: unknown } | null)?.url as string);
        return url ? [{ url, name: lobbyName((entry as { name?: unknown }).name, url) }] : [];
      })
      : [];
    return { custom, active: typeof data.active === 'string' ? data.active : null };
  } catch {
    return NO_STORED_LOBBIES;
  }
}

/** The site's lobbies first, then the player's, each address once */
export function allLobbies(builtIn: readonly Lobby[], stored: StoredLobbies): Lobby[] {
  const list = [...builtIn];
  for (const { url, name } of stored.custom) {
    if (!list.some((l) => l.url === url)) list.push({ url, name, builtIn: false });
  }
  return list;
}

/** The chosen lobby, or the first when the chosen one is gone; null without any */
export function activeLobby(list: readonly Lobby[], stored: StoredLobbies): Lobby | null {
  return list.find((l) => l.url === stored.active) ?? list[0] ?? null;
}

/** Add a lobby; null when the address is no ws:// or wss:// one */
export function addLobby(stored: StoredLobbies, name: string, url: string): StoredLobbies | null {
  const valid = validRelayUrl(url);
  if (!valid) return null;
  const custom = [...stored.custom.filter((l) => l.url !== valid), { url: valid, name: lobbyName(name, valid) }];
  return { custom, active: valid };
}

export function removeLobby(stored: StoredLobbies, url: string): StoredLobbies {
  return { custom: stored.custom.filter((l) => l.url !== url), active: stored.active === url ? null : stored.active };
}

/**
 * The player's own server from before the lobby list (`3dtd-coop-relay`), as a
 * lobby of theirs, so nobody loses the address they had set.
 */
export function withOldRelay(stored: StoredLobbies, oldRelay: string | null): StoredLobbies {
  const url = validRelayUrl(oldRelay);
  if (!url || stored.custom.some((l) => l.url === url)) return stored;
  return { custom: [...stored.custom, { url, name: relayLabel(url) }], active: stored.active ?? url };
}

function lobbyName(value: unknown, url: string): string {
  const name = typeof value === 'string' ? value.trim().slice(0, NAME_MAX) : '';
  return name || relayLabel(url);
}
