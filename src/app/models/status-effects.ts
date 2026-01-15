/**
 * Status effect types that can be applied to enemies
 */
export type StatusEffectType = 'slow' | 'freeze' | 'burn';

/**
 * Represents an active status effect on an enemy
 */
export interface StatusEffect {
  type: StatusEffectType;
  value: number; // Effect strength (e.g., 0.5 = 50% slow)
  duration: number; // Duration in milliseconds
  startTime: number; // performance.now() when effect was applied
  sourceId?: string; // Tower ID for stacking logic
}
