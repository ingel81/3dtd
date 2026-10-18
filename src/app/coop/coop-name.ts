import { readText, writeText } from '../utils/storage';

/** The name the player gave last time, kept in this browser; read before a game exists (the globes' Coop) */
export const COOP_NAME_KEY = '3dtd-coop-name';

export function readCoopName(): string | null {
  return readText(COOP_NAME_KEY);
}

/** False when storage is blocked: the caller keeps the name for the session */
export function writeCoopName(name: string): boolean {
  return writeText(COOP_NAME_KEY, name);
}
