/**
 * Status effect types that can be applied to enemies.
 *
 * freeze: frozen solid, the enemy halts (no movement, no walk cycle, no
 * walk/run switch) for its duration; `value` is unused. Slow and freeze on
 * the same enemy: freeze wins.
 * stun: the same halt, electric: its own look (sparks), and a source can
 * tell the two apart.
 */
export type StatusEffectType = 'slow' | 'freeze' | 'stun' | 'burn' | 'poison';

/**
 * Represents an active status effect on an enemy
 */
export interface StatusEffect {
  type: StatusEffectType;
  value: number; // Effect strength (e.g., 0.5 = 50% slow)
  duration: number; // Duration in game-time ms
  /** GameStateManager.gameTimeMs at the moment the effect was applied. */
  startTime: number;
  sourceId?: string; // Tower ID for stacking logic
  /**
   * Damage-over-time effects (poison, burn): game-time ms since the last tick.
   * Carried over when the effect is refreshed, so a source that refreshes
   * every sub-step (the fire beam) does not keep resetting the tick phase.
   */
  tickAccumMs?: number;
}
