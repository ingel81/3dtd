/**
 * Research Center Building Configuration
 *
 * Level progression, slot counts, and building-specific constants.
 * All values are tuneable without code changes.
 */

export interface ResearchCenterLevelConfig {
  level: number;
  researchSlots: number;         // Concurrent research slots at this level
  description: string;           // Human-readable description
}

/**
 * Research Center level progression. Placed at
 * `TOWER_TYPES['research-center'].cost` (75); upgrading to the next level
 * costs the `research-slots` upgrade track on that tower type (120, then
 * 216 with its 1.8 costScaling), not a value in this file.
 */
export const RESEARCH_CENTER_LEVELS: ResearchCenterLevelConfig[] = [
  { level: 1, researchSlots: 1, description: 'Basic Research (1 Slot)' },
  { level: 2, researchSlots: 2, description: 'Expanded Research (2 Slots)' },
  { level: 3, researchSlots: 3, description: 'Advanced Research (3 Slots)' },
];

/**
 * Research Center global constants.
 */
export const RESEARCH_CENTER_CONFIG = {
  /** Maximum building level */
  maxLevel: 3,
  /** Percentage of credits refunded when cancelling active research (0.0 - 1.0) */
  cancellationRefundPercent: 0.5,
} as const;

// ==================== Helpers ====================

export function getResearchCenterLevel(level: number): ResearchCenterLevelConfig | undefined {
  return RESEARCH_CENTER_LEVELS.find(l => l.level === level);
}

export function getMaxResearchSlots(level: number): number {
  return getResearchCenterLevel(level)?.researchSlots ?? 1;
}
