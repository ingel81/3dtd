/**
 * AI Schema — the canonical, order-sensitive vocabulary of the Wave Director.
 *
 * Everything the neural net sees is positional: feature 7 is "how many Cannons
 * does the player have" only because `AI_TOWER_ORDER[1] === 'cannon'`. The same
 * orders must hold in the TypeScript encoder, in the Python training backend and
 * in the exported ONNX model, or the net reads garbage.
 *
 * This file is the single place those orders are declared. The Python side does
 * not re-declare them — `npm run ai-schema` emits
 * `training-backend/generated/ai-schema.json` from here and the backend loads
 * that. Changing any order or length here is a **schema break**: the exported
 * model and every checkpoint become incompatible and training must restart.
 *
 * Schema history:
 *   1 — Phase 5.11: 156 features (16 enemies, 9 towers, 7 damage types).
 *   2 — Training refresh 2026-08: 162 features. Adds `zombie-v2` + `stone-golem`
 *       (enemy order 16 → 18), `lightning` as a buildable tower (tower order
 *       9 → 10) and as a damage type (7 → 8).
 */

import { ARMOR_TYPES, type ArmorType, type DamageType } from '../../configs/combat/combat.types';
import { type EnemyTypeId } from '../../configs/enemy-types.config';
import { type TowerTypeId } from '../../configs/tower-types.config';

/** Bumped whenever a length or an order below changes. */
export const AI_SCHEMA_VERSION = 2;

/**
 * Enemy order — 18 entries. Append-only: new enemies go at the end so the
 * leading indices keep their meaning across schema versions.
 */
export const AI_ENEMY_ORDER: readonly EnemyTypeId[] = [
  'zombie', 'rat', 'penguin',
  'wallsmasher', 'bat', 'hornet', 'spider',
  'zombie-soldier', 'tank', 'bear', 'dragon', 'mech',
  'mammoth', 'herbert',
  'ghost', 'wraith',
  // --- schema v2 ---
  'zombie-v2', 'stone-golem',
];

/**
 * Combat-tower order — 10 entries. `research-center` is deliberately absent:
 * it deals no damage and its state is already covered by the research block
 * (`centerLevel`, `slotsUsed`, `maxSlots`).
 */
export const AI_TOWER_ORDER: readonly TowerTypeId[] = [
  'archer', 'cannon', 'magic', 'dual-gatling', 'rocket', 'ice', 'fire', 'tentacle', 'poison',
  // --- schema v2 ---
  'lightning',
];

/** Damage-type order — 8 entries, mirrors `DAMAGE_TYPES`. */
export const AI_DAMAGE_TYPE_ORDER: readonly DamageType[] = [
  'physical', 'pierce', 'siege', 'magic', 'fire', 'ice', 'poison',
  // --- schema v2 ---
  'lightning',
];

/** Armor-type order — 5 entries, mirrors `ARMOR_TYPES`. */
export const AI_ARMOR_ORDER: readonly ArmorType[] = ARMOR_TYPES;

/**
 * Relative threat weights (Zombie = 1.0), used to aggregate a wave into a
 * single "how bad was that" scalar for the history features. Not used for
 * reward shaping — the reward only looks at damage, progress and count.
 */
export const ENEMY_THREAT_RATING: Readonly<Record<string, number>> = {
  // Unarmored
  zombie: 1.0,              // Baseline: 80 HP, 5 m/s
  'zombie-v2': 0.9,         // Same 80 HP but slower (3 m/s)
  rat: 0.5,                 // Swarm, very low HP (5)
  penguin: 0.8,             // Very fast (9 m/s), fragile
  // Light
  wallsmasher: 3.5,         // High HP (200), fast
  bat: 1.5,                 // Air, low HP
  hornet: 2.0,              // Air + swarm
  spider: 2.0,              // Fast light swarm
  // Heavy
  'zombie-soldier': 3.0,    // Heavy ground, fast
  tank: 4.0,                // Armored tank, 250 HP
  bear: 3.5,                // Tanky ground
  dragon: 8.0,              // Air-elite, 450 HP
  mech: 6.0,                // Heavy, 500 HP
  // Fortified
  mammoth: 5.0,             // Very high HP (400), slow
  'stone-golem': 5.5,       // 480 HP, very slow — pure DPS check
  herbert: 50.0,            // Boss: 500 HP, 100% immunity
  // Ethereal
  ghost: 6.0,               // Ethereal, requires magic/ice
  wraith: 7.0,              // Ethereal-fast
};

/** DPS-profile resolution — bins along the path, once for ground, once for air. */
export const NUM_DPS_BINS = 20;

/**
 * Waves per training episode before the backend resets the run. Also the
 * denominator for the "how far into the episode are we" feature, which used to
 * divide by a hardcoded 20 and therefore saturated a fifth of the way in.
 */
export const AI_EPISODE_LENGTH = 100;

/**
 * Scalar feature count, derived so it can never drift from the orders above.
 *
 *   Base block          — 4 + 2 + T + 5 + 5 + 1 + 1 + 1 + 1 + 1 + 5 + D + A + 5 + 1
 *   Awareness block     — E + A + 5 + T + 4 + T + 5
 *   Effective-DPS block — 2 * A
 *
 * with T = towers, D = damage types, A = armor types, E = enemy types.
 */
const T = AI_TOWER_ORDER.length;
const D = AI_DAMAGE_TYPE_ORDER.length;
const A = AI_ARMOR_ORDER.length;
const E = AI_ENEMY_ORDER.length;

export const NUM_BASE_FEATURES = 4 + 2 + T + 5 + 5 + 1 + 1 + 1 + 1 + 1 + 5 + D + A + 5 + 1;
export const NUM_AWARENESS_FEATURES = E + A + 5 + T + 4 + T + 5;
export const NUM_EFFECTIVE_DPS_FEATURES = 2 * A;

/** Total scalar features fed to the dense branch of the net. */
export const NUM_SCALAR_FEATURES =
  NUM_BASE_FEATURES + NUM_AWARENESS_FEATURES + NUM_EFFECTIVE_DPS_FEATURES;

/** Total spatial features fed to the conv branch (ground + air DPS profile). */
export const NUM_SPATIAL_FEATURES = 2 * NUM_DPS_BINS;

/** Full input width of the model. */
export const ENCODED_STATE_SIZE = NUM_SCALAR_FEATURES + NUM_SPATIAL_FEATURES;

/** Normalisation ceilings — a value at the ceiling encodes as 1.0. */
export const AI_MAX_VALUES = {
  credits: 5000,
  lives: 100,
  wave: 50,
  gameTime: 3600, // 1 hour
  towerCount: 30,
  towerLevel: 5,
  waveDuration: 300, // 5 minutes
  winStreak: 10,
  waveThreat: 100, // Herbert (50) × 2 multipliers
  /** Highest upgrade tier the research tree can unlock. */
  upgradeTier: 5,
  /** Effective DPS per armor category that saturates a feature. */
  effectiveDpsPerArmor: 500,
  /** DPS per path bin that saturates a bin. */
  dpsPerBin: 500,
} as const;
