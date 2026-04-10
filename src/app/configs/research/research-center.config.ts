/**
 * Research Center Building Configuration
 *
 * Level progression, slot counts, and building-specific constants.
 * All values are tuneable without code changes.
 */

export interface ResearchCenterLevelConfig {
  level: number;
  upgradeCost: number;           // Credits to reach this level (0 for base)
  researchSlots: number;         // Concurrent research slots at this level
  description: string;           // Human-readable description
}

/**
 * Research Center level progression.
 * Level 1 = base (placed at cost 75), Level 2-3 = upgrades.
 */
export const RESEARCH_CENTER_LEVELS: ResearchCenterLevelConfig[] = [
  { level: 1, upgradeCost: 0,   researchSlots: 1, description: 'Basic Research (1 Slot)' },
  { level: 2, upgradeCost: 120, researchSlots: 2, description: 'Expanded Research (2 Slots)' },
  { level: 3, upgradeCost: 220, researchSlots: 3, description: 'Advanced Research (3 Slots)' },
];

/**
 * Research Center global constants.
 */
export const RESEARCH_CENTER_CONFIG = {
  /** Cost to place the Research Center */
  baseCost: 75,
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

export function getNextLevelCost(currentLevel: number): number | null {
  const nextLevel = getResearchCenterLevel(currentLevel + 1);
  return nextLevel ? nextLevel.upgradeCost : null;
}
