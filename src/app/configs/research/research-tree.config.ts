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
const TREE = {
  // ==================== Tower Unlocks (Tier 0) ====================

  'gatling-tech': {
    id: 'gatling-tech',
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
    category: 'tower-unlock',
    branch: 'ballistics',
    icon: 'rocket',
    cost: 600,
    duration: 18,
    prerequisites: ['siege-engineering'],
    effects: [{ kind: 'unlock-tower', towerId: 'rocket' }],
  },

  // Flak after the cannon: a heavy gun, but its burst is for the light swarms (pierce 1.6 against light), in the
  // air as on the ground. Opens with the second air wave; against the first one AA Retrofit is there earlier.
  'flak-artillery': {
    id: 'flak-artillery',
    category: 'tower-unlock',
    branch: 'ballistics',
    icon: 'castle',
    cost: 1000,
    duration: 20,
    prerequisites: ['siege-engineering'],
    minWave: 8,
    effects: [{ kind: 'unlock-tower', towerId: 'bastion' }],
  },

  // The laser after the lightning: the same energy (lightning damage), focused on one target. Opens with the
  // heavy and the bosses of the teens, at the price of EMP, which opens with it behind the same research.
  'laser-optics': {
    id: 'laser-optics',
    category: 'tower-unlock',
    branch: 'arcane',
    icon: 'bulb',
    cost: 2500,
    duration: 25,
    prerequisites: ['storm-mastery'],
    minWave: 12,
    effects: [{ kind: 'unlock-tower', towerId: 'sentinel' }],
  },

  // Robot tentacles: the tentacle's reach in steel, with a saw on each arm. After the tentacle and the cannon's
  // engineering, opening with the bosses of the tens.
  'cybernetics': {
    id: 'cybernetics',
    category: 'tower-unlock',
    branch: 'biology',
    icon: 'cog',
    cost: 1500,
    duration: 20,
    prerequisites: ['tentacle-biology', 'siege-engineering'],
    minWave: 10,
    effects: [{ kind: 'unlock-tower', towerId: 'chainsaw' }],
  },

  // The grill after the flame: the Shawarma Slicer, a stream of slices on a line, for the long waves of the teens
  'rotisserie': {
    id: 'rotisserie',
    category: 'tower-unlock',
    branch: 'biology',
    icon: 'refresh',
    cost: 1200,
    duration: 20,
    prerequisites: ['fire-alchemy'],
    minWave: 9,
    effects: [{ kind: 'unlock-tower', towerId: 'shawarma' }],
  },

  // ==================== Tower Unlocks (Tier 3) ====================

  'chaos-rift': {
    id: 'chaos-rift',
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

  'scouting': {
    id: 'scouting',
    category: 'global-perk',
    branch: 'ballistics',
    icon: 'eye',
    cost: 3000,
    duration: 25,
    prerequisites: ['advanced-weaponry'],
    // Camouflaged enemies come from W22 on (run-plan.json)
    minWave: 16,
    effects: [{ kind: 'unlock-path', pathId: 'scout' }],
  },

  // A path for the starting tower out of the fire research: the regen counter
  // in the ballistic line, before the Regeneration waves (W28, W56)
  'incendiary-arrows': {
    id: 'incendiary-arrows',
    category: 'global-perk',
    branch: 'ballistics',
    icon: 'burst',
    cost: 2000,
    duration: 20,
    prerequisites: ['fire-alchemy'],
    minWave: 10,
    effects: [{ kind: 'unlock-path', pathId: 'incendiary' }],
  },

  // The archer's answer to armor, out of the siege line: the tower becomes a
  // ballista, after the first tank and bear waves (W9, W11) and before the
  // first mammoths (W14)
  'ballista-bolts': {
    id: 'ballista-bolts',
    category: 'global-perk',
    branch: 'ballistics',
    // A scope: siege engineering before it has the catapult
    icon: 'search',
    cost: 2500,
    duration: 25,
    prerequisites: ['siege-engineering'],
    minWave: 12,
    effects: [{ kind: 'unlock-path', pathId: 'sniper' }],
  },

  // The rocket stands idle in every ground wave; this lets it help there at
  // half damage, from the first tank waves on (W9, W11)
  'multirole-warheads': {
    id: 'multirole-warheads',
    category: 'global-perk',
    branch: 'ballistics',
    icon: 'target',
    cost: 1500,
    duration: 20,
    prerequisites: ['rocketry'],
    minWave: 9,
    effects: [{ kind: 'unlock-path', pathId: 'multirole' }],
  },

  // Out of the magic line, before the first wraiths (W17): lifts their
  // Phasing, so the ice tower's slow works on them again
  'binding-sigils': {
    id: 'binding-sigils',
    category: 'global-perk',
    branch: 'arcane',
    icon: 'sparkle',
    cost: 2500,
    duration: 25,
    prerequisites: ['arcane-studies'],
    minWave: 15,
    effects: [{ kind: 'unlock-path', pathId: 'seal' }],
  },

  // Out of the poison line, with the tank and bear waves (W9, W11): the
  // armor of what the poison tower hits counts one class lighter
  'caustic-compounds': {
    id: 'caustic-compounds',
    category: 'global-perk',
    branch: 'biology',
    icon: 'flask',
    cost: 2000,
    duration: 20,
    prerequisites: ['toxic-compounds'],
    minWave: 11,
    effects: [{ kind: 'unlock-path', pathId: 'corrode' }],
  },

  'nuclear-strike': {
    id: 'nuclear-strike',
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
      },
    ],
  },

  'mercenary-contract': {
    id: HERO.researchId,
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
    }],
  },

  'frost-bomb': {
    id: 'frost-bomb',
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
    }],
  },

  emp: {
    id: 'emp',
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
    }],
  },

  'orbital-laser': {
    id: 'orbital-laser',
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
    }],
  },

  // ==================== Upgrade Tiers ====================

  'advanced-weaponry': {
    id: 'advanced-weaponry',
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
    category: 'upgrade-tier',
    branch: 'engineering',
    icon: 'star',
    cost: 100000,
    duration: 150,
    prerequisites: ['advanced-engineering'],
    minWave: 38,
    effects: [{ kind: 'unlock-upgrade-tier', tier: 5 }],
  },
} satisfies Record<string, ResearchConfig>;

/** A research of the tree, by id; its name and description are the dictionary's (i18n `research`) */
export type ResearchTreeId = keyof typeof TREE;

export const RESEARCH_TREE: Record<ResearchId, ResearchConfig> = TREE;

// ==================== Helper Functions ====================

export function getResearch(id: ResearchId): ResearchConfig | undefined {
  return RESEARCH_TREE[id];
}

/**
 * Whether the researches in `completed` open tower path `pathId` (an `unlock-path` effect): the one rule
 * of the simulation (ResearchManager.isPathUnlocked, for the tower's owner) and of the tower panel.
 */
export function pathUnlockedBy(completed: Iterable<ResearchId>, pathId: string): boolean {
  for (const researchId of completed) {
    if (getResearch(researchId)?.effects.some((e) => e.kind === 'unlock-path' && e.pathId === pathId)) return true;
  }
  return false;
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
