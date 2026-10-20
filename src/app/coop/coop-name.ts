import { readText, writeText } from '../utils/storage';

/** The name the player gave last time, kept in this browser; read before a game exists (the globes' Coop) */
export const COOP_NAME_KEY = '3dtd-coop-name';

/**
 * The name of a player who gave none. It goes to the other players as it
 * is, so it is a name and the same in every language (docs/I18N_PLAN.md 4.6).
 */
export const PLAYER_NAME_FALLBACK = 'Player';

export function readCoopName(): string | null {
  return readText(COOP_NAME_KEY);
}

/** False when storage is blocked: the caller keeps the name for the session */
export function writeCoopName(name: string): boolean {
  return writeText(COOP_NAME_KEY, name);
}
