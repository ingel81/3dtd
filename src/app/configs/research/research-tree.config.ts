/**
 * Research Tree Configuration
 *
 * All research definitions for the tech tree.
 * To add a new research: add an entry to RESEARCH_TREE.
 * To rebalance: change cost/duration numbers.
 * To restructure tree: change prerequisites arrays.
 */

import { ResearchConfig, ResearchId } from './research.types';

/**
 * Complete tech tree — all available researches.
 *
 * Structure:
 * - Tower Unlocks (Tier 0): No prerequisites, unlock basic towers
 * - Tower Unlocks (Tier 1): Require Tier 0, unlock advanced towers
 * - Tower Unlocks (Tier 2): Require Tier 1, unlock specialized towers
 * - Global Perks: Require specific researches, grant global effects
 * - Upgrade Tiers: Require multiple unlocks, enable higher upgrade levels
 */
export const RESEARCH_TREE: Record<ResearchId, ResearchConfig> = {
  // ==================== Tower Unlocks (Tier 0) ====================

  'gatling-tech': {
    id: 'gatling-tech',
    name: 'Gatling Technology',
    description: 'Unlocks the Dual-Gatling Tower — rapid-fire pierce damage',
    category: 'tower-unlock',
    icon: 'speed',
    cost: 40,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'dual-gatling' }],
  },

  'ice-magic': {
    id: 'ice-magic',
    name: 'Ice Magic',
    description: 'Unlocks the Ice Tower — slows enemies, targets air and ground',
    category: 'tower-unlock',
    icon: 'splash',
    cost: 40,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'ice' }],
  },

  'tentacle-biology': {
    id: 'tentacle-biology',
    name: 'Tentacle Biology',
    description: 'Unlocks the Tentacle Tower — close-range melee strikes',
    category: 'tower-unlock',
    icon: 'bug',
    cost: 45,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'tentacle' }],
  },

  'toxic-compounds': {
    id: 'toxic-compounds',
    name: 'Toxic Compounds',
    description: 'Unlocks the Poison Tower — DoT splash projectiles',
    category: 'tower-unlock',
    icon: 'flask',
    cost: 45,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'poison' }],
  },

  // ==================== Tower Unlocks (Tier 1) ====================

  'siege-engineering': {
    id: 'siege-engineering',
    name: 'Siege Engineering',
    description: 'Unlocks the Cannon Tower — slow, heavy siege damage',
    category: 'tower-unlock',
    icon: 'build',
    cost: 50,
    duration: 20,
    prerequisites: ['gatling-tech'],
    effects: [{ kind: 'unlock-tower', towerId: 'cannon' }],
  },

  'fire-alchemy': {
    id: 'fire-alchemy',
    name: 'Fire Alchemy',
    description: 'Unlocks the Fire Tower — continuous flame beam',
    category: 'tower-unlock',
    icon: 'flame',
    cost: 55,
    duration: 20,
    prerequisites: ['toxic-compounds'],
    effects: [{ kind: 'unlock-tower', towerId: 'fire' }],
  },

  'arcane-studies': {
    id: 'arcane-studies',
    name: 'Arcane Studies',
    description: 'Unlocks the Magic Tower — strong vs ethereal enemies',
    category: 'tower-unlock',
    icon: 'bolt',
    cost: 65,
    duration: 20,
    prerequisites: ['ice-magic'],
    effects: [{ kind: 'unlock-tower', towerId: 'magic' }],
  },

  // ==================== Tower Unlocks (Tier 2) ====================

  'rocketry': {
    id: 'rocketry',
    name: 'Rocketry',
    description: 'Unlocks the Rocket Tower — air-only homing missiles',
    category: 'tower-unlock',
    icon: 'arrowUp',
    cost: 60,
    duration: 18,
    prerequisites: ['gatling-tech'],
    effects: [{ kind: 'unlock-tower', towerId: 'rocket' }],
  },

  // ==================== Global Perks ====================

  'aa-retrofit': {
    id: 'aa-retrofit',
    name: 'AA Retrofit',
    description: 'Gatling towers gain air targeting capability',
    category: 'global-perk',
    icon: 'arrowUp',
    cost: 45,
    duration: 12,
    prerequisites: ['rocketry'],
    effects: [{ kind: 'enable-targeting', capability: 'air' }],
  },

  // ==================== Upgrade Tiers ====================

  'advanced-weaponry': {
    id: 'advanced-weaponry',
    name: 'Advanced Weaponry',
    description: 'Enables Tier 2 upgrades for all towers',
    category: 'upgrade-tier',
    icon: 'shield',
    cost: 130,
    duration: 35,
    prerequisites: ['siege-engineering', 'arcane-studies'],
    effects: [{ kind: 'unlock-upgrade-tier', tier: 2 }],
  },

  'master-engineering': {
    id: 'master-engineering',
    name: 'Master Engineering',
    description: 'Enables Tier 3 upgrades for all towers',
    category: 'upgrade-tier',
    icon: 'shield',
    cost: 240,
    duration: 60,
    prerequisites: ['advanced-weaponry'],
    effects: [{ kind: 'unlock-upgrade-tier', tier: 3 }],
  },

  'advanced-engineering': {
    id: 'advanced-engineering',
    name: 'Advanced Engineering',
    description: 'Enables Tier 4 upgrades for all towers (levels 16-20)',
    category: 'upgrade-tier',
    icon: 'cog',
    cost: 380,
    duration: 90,
    prerequisites: ['master-engineering'],
    effects: [{ kind: 'unlock-upgrade-tier', tier: 4 }],
  },

  'transcendent-tech': {
    id: 'transcendent-tech',
    name: 'Transcendent Tech',
    description: 'Enables Tier 5 upgrades for all towers (levels 21-25)',
    category: 'upgrade-tier',
    icon: 'bolt',
    cost: 600,
    duration: 150,
    prerequisites: ['advanced-engineering'],
    effects: [{ kind: 'unlock-upgrade-tier', tier: 5 }],
  },
};

// ==================== Helper Functions ====================

export function getResearch(id: ResearchId): ResearchConfig | undefined {
  return RESEARCH_TREE[id];
}

export function getResearchesByCategory(category: ResearchConfig['category']): ResearchConfig[] {
  return Object.values(RESEARCH_TREE).filter(r => r.category === category);
}

export function getAllResearches(): ResearchConfig[] {
  return Object.values(RESEARCH_TREE);
}

export function getAllResearchIds(): ResearchId[] {
  return Object.keys(RESEARCH_TREE);
}

/**
 * Find which research unlocks a specific tower.
 * Returns undefined if the tower doesn't need research (e.g., archer).
 */
export function getResearchForTower(towerId: string): ResearchConfig | undefined {
  return Object.values(RESEARCH_TREE).find(r =>
    r.effects.some(e => e.kind === 'unlock-tower' && e.towerId === towerId)
  );
}
