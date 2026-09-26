/**
 * What a player may do with a tower (docs/COOP_PLAN.md, D7). One rule for
 * the whole game: the commands check it in the simulation, where a refused
 * command is logged and does nothing, and the UI asks the same rule before
 * it lets a player select a tower. Loosening it later (upgrading a
 * partner's tower, say) means swapping the rule, not touching commands.
 */
export type TowerAction = 'select' | 'upgrade' | 'sell' | 'targeting' | 'hold-fire' | 'man';

export interface TowerPolicy {
  may(playerId: string, tower: { readonly ownerId: string }, action: TowerAction): boolean;
}

/**
 * The standard: a player manages their own towers and no one else's. Anyone
 * may select a partner's tower to look at it, read only (TODO E39).
 */
export const OWNER_ONLY: TowerPolicy = {
  may: (playerId, tower, action) => action === 'select' || tower.ownerId === playerId,
};
