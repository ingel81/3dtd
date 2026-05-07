/**
 * Status effect types that can be applied to enemies
 */
export type StatusEffectType = 'slow' | 'freeze' | 'burn' | 'poison';

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
}
