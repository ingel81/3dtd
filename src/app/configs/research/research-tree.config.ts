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
 * Pacing (2026-10-02): a human run had the whole tree by W26 for 19,670
 * credits, 1.3 % of its income. Costs now follow the income of the wave a
 * research opens at (`minWave`), the tiers most: Tier 2 2,000 from W7, Tier 3
 * 8,000 from W15, Tier 4 30,000 from W25, Tier 5 100,000 from W38, about four
 * waves of income there. The tree is done at W38 at the earliest and usually
 * later; the last tier competes with upgrades. Tables in docs/WAVE_RUN_PLAN.md,
 * section 16.
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
    branch: 'ballistics',
    icon: 'gatling',
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
    branch: 'arcane',
    icon: 'iceStar',
    cost: 400,
    duration: 15,
    prerequisites: [],
    effects: [{ kind: 'unlock-tower', towerId: 'ice' }],
  },

  // The organic branch had two loose roots; this is its trunk. Cheap and quick
  // on purpose: it is a first step, not a decision, and it gives the tree a
  // readable shape instead of four equal doors at the start.
  'biology': {
    id: 'biology',
    name: 'Biology',
    description: 'Opens the organic branch: Tentacle and Poison',
    category: 'gate',
    branch: 'biology',
    icon: 'helix',
    cost: 120,
    duration: 8,
    prerequisites: [],
    effects: [],
  },

  'tentacle-biology': {
    id: 'tentacle-biology',
    name: 'Tentacle Biology',
    description: 'Unlocks the Tentacle Tower: close-range melee strikes',
    category: 'tower-unlock',
    branch: 'biology',
    icon: 'tentacle',
    cost: 450,
    duration: 15,
    prerequisites: ['biology'],
    effects: [{ kind: 'unlock-tower', towerId: 'tentacle' }],
  },

  'toxic-compounds': {
    id: 'toxic-compounds',
    name: 'Toxic Compounds',
    description: 'Unlocks the Poison Tower: splash projectiles with damage over time',
    category: 'tower-unlock',
    branch: 'biology',
    icon: 'hazardCone',
    cost: 450,
    duration: 15,
    prerequisites: ['biology'],
    effects: [{ kind: 'unlock-tower', towerId: 'poison' }],
  },

  // ==================== Tower Unlocks (Tier 1) ====================

  'siege-engineering': {
    id: 'siege-engineering',
    name: 'Siege Engineering',
    description: 'Unlocks the Cannon Tower: slow, heavy siege damage',
    category: 'tower-unlock',
    branch: 'ballistics',
    icon: 'catapult',
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
    branch: 'arcane',
    icon: 'flame',
    cost: 800,
    duration: 20,
    prerequisites: ['toxic-compounds'],
    minWave: 6,
    effects: [{ kind: 'unlock-tower', towerId: 'fire' }],
  },

  'arcane-studies': {
    id: 'arcane-studies',
    name: 'Arcane Studies',
    description: 'Unlocks the Magic Tower: strong vs ethereal enemies',
    category: 'tower-unlock',
    branch: 'arcane',
    icon: 'arcaneStar',
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
    branch: 'arcane',
    icon: 'bolt',
    cost: 1200,
    duration: 20,
    prerequisites: ['arcane-studies'],
    minWave: 9,
    effects: [{ kind: 'unlock-tower', towerId: 'lightning' }],
  },

  // ==================== Tower Unlocks (Tier 2) ====================

  // Rockets are explosive ordnance, so they follow the cannon's line, not the
  // gatling's rapid fire. They answer armored air (dragon, heavy: siege 1.75);
  // against the light swarms of waves 7 and 8 siege deals 0.5 and the
  // retrofitted gatling is the better gold, which is what the description says.
  'rocketry': {
    id: 'rocketry',
    name: 'Rocketry',
    description: 'Unlocks the Rocket Tower: heavy homing missiles against armored air',
    category: 'tower-unlock',
    branch: 'ballistics',
    icon: 'rocket',
    cost: 600,
    duration: 18,
    prerequisites: ['siege-engineering'],
    effects: [{ kind: 'unlock-tower', towerId: 'rocket' }],
  },

  // ==================== Tower Unlocks (Tier 3) ====================

  'chaos-rift': {
    id: 'chaos-rift',
    name: 'Chaos Rift',
    description: 'Unlocks the Chaos Tower: full damage against every armor, air and ground',
    category: 'tower-unlock',
    branch: 'arcane',
    icon: 'rift',
    cost: 8000,
    duration: 30,
    // Der späteste Tower: braucht den Panzer- und den Geister-Pfad. Über Storm
    // Mastery hängt Arcane Studies davor, Chaos kommt also nie vor dem ersten
    // echten Ethereal-Konter.
    prerequisites: ['siege-engineering', 'storm-mastery'],
    minWave: 20,
    effects: [{ kind: 'unlock-tower', towerId: 'chaos' }],
  },

  // ==================== Global Perks ====================

  'aa-retrofit': {
    id: 'aa-retrofit',
    name: 'AA Retrofit',
    description: 'Gatling towers gain air targeting capability: the broad answer to light air',
    category: 'global-perk',
    branch: 'ballistics',
    icon: 'flak',
    cost: 450,
    duration: 12,
    // Straight off gatling-tech: this used to require rocketry, so the broad
    // answer to air sat behind the specialist it outperforms against the light
    // swarms that open the air campaign.
    prerequisites: ['gatling-tech'],
    effects: [{ kind: 'enable-targeting', capability: 'air' }],
  },

  'nuclear-strike': {
    id: 'nuclear-strike',
    name: 'Nuclear Strike',
    description:
      'Unlocks the Missile Silo and the Nuclear Strike it launches: aim at the route, 6.5 s later everything '
      + 'within 25 m loses 60% of its max HP (bosses 20%). One charge, a new one every 3 waves',
    category: 'global-perk',
    branch: 'ballistics',
    icon: 'mushroom',
    cost: 4000,
    duration: 40,
    // Comes after the first boss (W10), when the campaign picks up
    prerequisites: ['advanced-weaponry'],
    minWave: 12,
    effects: [
      { kind: 'unlock-tower', towerId: 'missile-silo' },
      {
        kind: 'global-perk',
        perkId: 'nuclear-strike',
        description: 'Nuclear Strike ability: one charge, a new one every 3 completed waves',
      },
    ],
  },

  'mercenary-contract': {
    id: HERO.researchId,
    name: 'Mercenary Contract',
    description:
      `Lets you hire the ${HERO.name} once for ${HERO.cost} credits: a soldier you send along the enemy route. `
      + `He fights on his own within ${HERO.rangeM} m, switches between standard (physical), explosive (siege) `
      + `and rune (magic) rounds and levels up through his kills`,
    category: 'global-perk',
    branch: 'engineering',
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
    branch: 'arcane',
    icon: 'frostRune',
    cost: 1000,
    duration: 25,
    // After the ice line's second step, and not before W6
    prerequisites: ['arcane-studies'],
    minWave: 6,
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
    branch: 'engineering',
    icon: 'pulse',
    cost: 2500,
    duration: 30,
    // Out of the lightning research: comes with Storm Mastery's chain
    // lightning, before the tank column of W22 and the mech army of W28
    prerequisites: ['storm-mastery'],
    minWave: 12,
    effects: [{
      kind: 'global-perk',
      perkId: 'emp',
      description: 'EMP ability: one charge, a new one every 3 completed waves',
    }],
  },

  'orbital-laser': {
    id: 'orbital-laser',
    name: 'Orbital Laser',
    description:
      'Unlocks the Orbital Laser: aim at the route, 1 s later a beam burns 4 s along it toward the spawn, '
      + 'fire damage up to 60% of max HP (bosses 20%). One charge, a new one every 3 waves',
    category: 'global-perk',
    branch: 'ballistics',
    icon: 'laser',
    cost: 12000,
    duration: 45,
    // The late damage ability: after Master Engineering (T3 upgrades,
    // about W15 to W18), beyond the nuclear strike's Advanced Weaponry
    prerequisites: ['master-engineering'],
    minWave: 22,
    effects: [{
      kind: 'global-perk',
      perkId: 'orbital-laser',
      description: 'Orbital Laser ability: one charge, a new one every 3 completed waves',
    }],
  },

  // ==================== Upgrade Tiers ====================

  'advanced-weaponry': {
    id: 'advanced-weaponry',
    name: 'Advanced Weaponry',
    description: 'Enables Tier 2 upgrades for all towers (levels 6-10)',
    category: 'upgrade-tier',
    branch: 'ballistics',
    icon: 'sword',
    cost: 2000,
    duration: 35,
    prerequisites: ['siege-engineering', 'arcane-studies'],
    minWave: 7,
    effects: [{ kind: 'unlock-upgrade-tier', tier: 2 }],
  },

  'master-engineering': {
    id: 'master-engineering',
    name: 'Master Engineering',
    description: 'Enables Tier 3 upgrades for all towers (levels 11-15)',
    category: 'upgrade-tier',
    branch: 'engineering',
    icon: 'sliders',
    cost: 8000,
    duration: 60,
    prerequisites: ['advanced-weaponry'],
    minWave: 15,
    effects: [{ kind: 'unlock-upgrade-tier', tier: 3 }],
  },

  'advanced-engineering': {
    id: 'advanced-engineering',
    name: 'Advanced Engineering',
    description: 'Enables Tier 4 upgrades for all towers (levels 16-20)',
    category: 'upgrade-tier',
    branch: 'engineering',
    icon: 'cogRing',
    cost: 30000,
    duration: 90,
    prerequisites: ['master-engineering'],
    minWave: 25,
    effects: [{ kind: 'unlock-upgrade-tier', tier: 4 }],
  },

  'transcendent-tech': {
    id: 'transcendent-tech',
    name: 'Transcendent Tech',
    description: 'Enables Tier 5 upgrades for all towers (levels 21-25)',
    category: 'upgrade-tier',
    branch: 'engineering',
    icon: 'star',
    cost: 100000,
    duration: 150,
    prerequisites: ['advanced-engineering'],
    minWave: 38,
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
