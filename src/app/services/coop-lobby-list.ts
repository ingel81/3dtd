import { computed, signal } from '@angular/core';
import type { ConfigService } from '../core/services/config.service';
import { DEFAULT_RELAY_PORT } from '../coop/relay-address';
import { DEV_HOSTS } from '../coop/coop-access';
import { readDesktopBridge } from '../core/desktop-bridge';
import {
  activeLobby,
  addLobby,
  allLobbies,
  builtInLobbies,
  readStoredLobbies,
  removeLobby,
  withOldRelay,
  type Lobby,
  type StoredLobbies,
} from '../coop/lobbies';
import { readText, removeKey, writeJson } from '../utils/storage';

/** The player's own relay from before the lobbies (D58), kept in this browser; none means automatic */
const RELAY_KEY = '3dtd-coop-relay';
/** localStorage: the lobbies the player added and the active one (D58) */
const LOBBIES_KEY = '3dtd-coop-lobbies';

/**
 * The online lobbies (D58): the site's, then the ones the player added, and
 * the active one, kept in this browser.
 */
export class CoopLobbyList {
  /** The lobbies the player added and the active one (D58) */
  private readonly stored = signal<StoredLobbies>(readLobbies());

  /** Every online lobby: the site's, then the player's */
  readonly lobbies = computed<readonly Lobby[]>(() => {
    const site = builtInLobbies(this.config.coopLobbies(), this.config.coopRelay(), readDesktopBridge() !== null);
    // The dev game without a lobby of its own: `npm run coop-server` on this machine
    if (site.length === 0 && DEV_HOSTS.has(window.location.hostname)) {
      site.push({ url: `ws://localhost:${DEFAULT_RELAY_PORT}`, name: 'This machine', builtIn: true });
    }
    return allLobbies(site, this.stored());
  });

  /** The lobby "Online" plays over; null without any (then online is off) */
  readonly lobby = computed(() => activeLobby(this.lobbies(), this.stored()));

  constructor(private readonly config: ConfigService) {}

  /** Add an online lobby and make it the active one; false when the address is no ws:// or wss:// one */
  add(name: string, url: string): boolean {
    const next = addLobby(this.stored(), name, url);
    if (!next) return false;
    this.store(next);
    return true;
  }

  remove(url: string): void {
    this.store(removeLobby(this.stored(), url));
  }

  select(url: string): void {
    this.store({ ...this.stored(), active: url });
  }

  private store(next: StoredLobbies): void {
    this.stored.set(next);
    // Storage blocked: the list holds for this session
    writeJson(LOBBIES_KEY, next);
  }
}

/** The stored lobby list, with a server set before the list (`3dtd-coop-relay`) taken over once */
function readLobbies(): StoredLobbies {
  const stored = readStoredLobbies(readText(LOBBIES_KEY));
  const merged = withOldRelay(stored, readText(RELAY_KEY));
  // The old key goes only once the list holds its server
  if (merged !== stored && writeJson(LOBBIES_KEY, merged)) removeKey(RELAY_KEY);
  return merged;
}
