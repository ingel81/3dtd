/**
 * Research Tree Configuration
 *
 * All research definitions for the tech tree.
 * To add a new research: add an entry to RESEARCH_TREE.
 * To rebalance: change cost/duration numbers.
 * To restructure tree: change prerequisites arrays.
 */

import { ResearchConfig, ResearchId } from './research.types';
import { HERO } from '../hero.config';

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
    description: 'Unlocks the Dual-Gatling Tower: rapid-fire pierce damage',
    category: 'tower-unlock',
    icon: 'speed',
    cost: 400,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'dual-gatling' }],
  },

  'ice-magic': {
    id: 'ice-magic',
    name: 'Ice Magic',
    description: 'Unlocks the Ice Tower: slows enemies, hits air and ground',
    category: 'tower-unlock',
    icon: 'splash',
    cost: 400,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'ice' }],
  },

  'tentacle-biology': {
    id: 'tentacle-biology',
    name: 'Tentacle Biology',
    description: 'Unlocks the Tentacle Tower: close-range melee strikes',
    category: 'tower-unlock',
    icon: 'bug',
    cost: 450,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'tentacle' }],
  },

  'toxic-compounds': {
    id: 'toxic-compounds',
    name: 'Toxic Compounds',
    description: 'Unlocks the Poison Tower: splash projectiles with damage over time',
    category: 'tower-unlock',
    icon: 'flask',
    cost: 450,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'poison' }],
  },

  // ==================== Tower Unlocks (Tier 1) ====================

  'siege-engineering': {
    id: 'siege-engineering',
    name: 'Siege Engineering',
    description: 'Unlocks the Cannon Tower: slow, heavy siege damage',
    category: 'tower-unlock',
    icon: 'build',
    cost: 500,
    duration: 20,
    prerequisites: ['gatling-tech'],
    effects: [{ kind: 'unlock-tower', towerId: 'cannon' }],
  },

  'fire-alchemy': {
    id: 'fire-alchemy',
    name: 'Fire Alchemy',
    description: 'Unlocks the Fire Tower: continuous flame beam, ground only',
    category: 'tower-unlock',
    icon: 'flame',
    cost: 550,
    duration: 20,
    prerequisites: ['toxic-compounds'],
    effects: [{ kind: 'unlock-tower', towerId: 'fire' }],
  },

  'arcane-studies': {
    id: 'arcane-studies',
    name: 'Arcane Studies',
    description: 'Unlocks the Magic Tower: strong vs ethereal enemies',
    category: 'tower-unlock',
    icon: 'bolt',
    cost: 650,
    duration: 20,
    prerequisites: ['ice-magic'],
    effects: [{ kind: 'unlock-tower', towerId: 'magic' }],
  },

  'storm-mastery': {
    id: 'storm-mastery',
    name: 'Storm Mastery',
    description: 'Unlocks the Lightning Tower: chain hitscan, anti-swarm/air',
    category: 'tower-unlock',
    icon: 'bolt',
    cost: 700,
    duration: 20,
    prerequisites: ['arcane-studies'],
    effects: [{ kind: 'unlock-tower', towerId: 'lightning' }],
  },

  // ==================== Tower Unlocks (Tier 2) ====================

  'rocketry': {
    id: 'rocketry',
    name: 'Rocketry',
    description: 'Unlocks the Rocket Tower: air-only homing missiles',
    category: 'tower-unlock',
    icon: 'arrowUp',
    cost: 600,
    duration: 18,
    prerequisites: ['gatling-tech'],
    effects: [{ kind: 'unlock-tower', towerId: 'rocket' }],
  },

  // ==================== Tower Unlocks (Tier 3) ====================

  'chaos-rift': {
    id: 'chaos-rift',
    name: 'Chaos Rift',
    description: 'Unlocks the Chaos Tower: full damage against every armor, air and ground',
    category: 'tower-unlock',
    icon: 'shuffle',
    cost: 1000,
    duration: 30,
    // Der späteste Tower: braucht den Panzer- und den Geister-Pfad. Über Storm
    // Mastery hängt Arcane Studies davor, Chaos kommt also nie vor dem ersten
    // echten Ethereal-Konter.
    prerequisites: ['siege-engineering', 'storm-mastery'],
    effects: [{ kind: 'unlock-tower', towerId: 'chaos' }],
  },

  // ==================== Global Perks ====================

  'aa-retrofit': {
    id: 'aa-retrofit',
    name: 'AA Retrofit',
    description: 'Gatling towers gain air targeting capability',
    category: 'global-perk',
    icon: 'arrowUp',
    cost: 450,
    duration: 12,
    prerequisites: ['rocketry'],
    effects: [{ kind: 'enable-targeting', capability: 'air' }],
  },

  'nuclear-strike': {
    id: 'nuclear-strike',
    name: 'Nuclear Strike',
    description:
      'Unlocks the Nuclear Strike: aim at the route, 1.5 s later everything within 25 m loses 60% of its max HP '
      + '(bosses 20%). One charge, a new one every 3 waves',
    category: 'global-perk',
    icon: 'radiation',
    cost: 1000,
    duration: 40,
    // Comes after the first boss (W10), when the curriculum picks up; no wave
    // lock of its own (PLAYER_AGENCY_CONCEPT.md, section 7)
    prerequisites: ['advanced-weaponry'],
    effects: [{
      kind: 'global-perk',
      perkId: 'nuclear-strike',
      description: 'Nuclear Strike ability: one charge, a new one every 3 completed waves',
    }],
  },

  'mercenary-contract': {
    id: HERO.researchId,
    name: 'Mercenary Contract',
    description:
      `Lets you hire the ${HERO.name} once for ${HERO.cost} credits: a soldier you send along the enemy route. `
      + `He fights on his own within ${HERO.rangeM} m, switches between standard (physical), explosive (siege) `
      + `and rune (magic) rounds and levels up through his kills`,
    category: 'global-perk',
    icon: 'user',
    cost: 600,
    duration: 30,
    // After the cannon, about when the first air waves come (W7/W8); the
    // numbers are derived in docs/HERO.md
    prerequisites: ['siege-engineering'],
    effects: [{
      kind: 'global-perk',
      perkId: HERO.perkId,
      description: `${HERO.name} can be hired (${HERO.cost} credits, once)`,
    }],
  },

  'frost-bomb': {
    id: 'frost-bomb',
    name: 'Frost Bomb',
    description:
      'Unlocks the Frost Bomb: aim at the route, 0.5 s later everything within 20 m freezes solid for 3 s '
      + '(bosses 1 s). One charge, a new one every 3 waves',
    category: 'global-perk',
    icon: 'snowflake',
    cost: 700,
    duration: 25,
    // After the ice line's second step, so it cannot come before W5 or so:
    // 400 + 650 + 700 gold of research on top of the towers
    prerequisites: ['arcane-studies'],
    effects: [{
      kind: 'global-perk',
      perkId: 'frost-bomb',
      description: 'Frost Bomb ability: one charge, a new one every 3 completed waves',
    }],
  },

  emp: {
    id: 'emp',
    name: 'EMP',
    description:
      'Unlocks the EMP: aim at the route, 0.5 s later machines within 30 m stop for 6 s, '
      + 'everything else for 1.5 s (bosses 0.75 s). One charge, a new one every 3 waves',
    category: 'global-perk',
    icon: 'bolt',
    cost: 800,
    duration: 30,
    // Out of the lightning research: comes with Storm Mastery's chain
    // lightning, before the tank column of W22 and the mech army of W28
    prerequisites: ['storm-mastery'],
    effects: [{
      kind: 'global-perk',
      perkId: 'emp',
      description: 'EMP ability: one charge, a new one every 3 completed waves',
    }],
  },

  // ==================== Upgrade Tiers ====================

  'advanced-weaponry': {
    id: 'advanced-weaponry',
    name: 'Advanced Weaponry',
    description: 'Enables Tier 2 upgrades for all towers (levels 6-10)',
    category: 'upgrade-tier',
    icon: 'shield',
    cost: 800,
    duration: 35,
    prerequisites: ['siege-engineering', 'arcane-studies'],
    effects: [{ kind: 'unlock-upgrade-tier', tier: 2 }],
  },

  'master-engineering': {
    id: 'master-engineering',
    name: 'Master Engineering',
    description: 'Enables Tier 3 upgrades for all towers (levels 11-15)',
    category: 'upgrade-tier',
    icon: 'shield',
    cost: 1500,
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
    cost: 2500,
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
    cost: 4000,
    duration: 150,
    prerequisites: ['advanced-engineering'],
    effects: [{ kind: 'unlock-upgrade-tier', tier: 5 }],
  },
};

// ==================== Helper Functions ====================

export function getResearch(id: ResearchId): ResearchConfig | undefined {
  return RESEARCH_TREE[id];
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
