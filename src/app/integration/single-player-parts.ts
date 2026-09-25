import { LOCAL_PLAYER_ID } from '../managers/game-state/command-log';
import { OWNER_ONLY } from '../coop/tower-policy';

/**
 * The player side of the GameStateManager for a spec that hands the
 * GameCommandsHandler a partial stand-in: one player, LOCAL_PLAYER_ID, who
 * owns every tower (docs/COOP_PLAN.md, C2). What `gsm` brings itself wins.
 */
export function singlePlayer<T extends object>(gsm: T): T {
  const credits = (gsm as { credits?: () => number }).credits;
  const research = (gsm as { researchManager?: unknown }).researchManager;
  const abilities = (gsm as { abilityManager?: unknown }).abilityManager;
  const hero = (gsm as { heroManager?: unknown }).heroManager;
  return {
    players: [LOCAL_PLAYER_ID],
    actingPlayerId: LOCAL_PLAYER_ID,
    localPlayerId: LOCAL_PLAYER_ID,
    towerPolicy: OWNER_ONLY,
    runAs: <R>(_playerId: string, fn: () => R): R => fn(),
    mayCheat: () => true,
    creditsOf: () => credits?.() ?? 0,
    selectableTower: (id: string | null) => id,
    researchOf: () => research,
    abilityOf: () => abilities,
    heroOf: () => hero,
    ...gsm,
  };
}
