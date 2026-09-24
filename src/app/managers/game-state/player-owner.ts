import { LOCAL_PLAYER_ID } from './command-log';

/**
 * Whose a per-player part of the simulation is (research, abilities, hero;
 * docs/COOP_PLAN.md, C2): its events carry the player, and `local` says
 * whether that is the player at this client, the one the UI shows.
 */
export interface PlayerOwner {
  readonly playerId: string;
  local(): boolean;
}

/** The single player, at this client. */
export const LOCAL_OWNER: PlayerOwner = { playerId: LOCAL_PLAYER_ID, local: () => true };
