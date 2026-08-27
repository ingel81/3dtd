/**
 * Wave Templates — Phase 5.11 Range-Based (Frontend mirror of templates.py).
 *
 * Each template defines the CHARACTER of a wave (enemy mix, curriculum gate,
 * capability requirement, spawn pattern) plus RANGES for 4 dynamic parameters:
 * count, spawn_delay_ms, hp_mult, variation.
 *
 * The NN produces template_idx + 4 factors in [0,1]; the decoder
 * interpolates each factor into the template's designer-set range.
 *
 * Slots 0-18 are active. Slots 19-31 are reserved for future expansion
 * without retraining (blocked by slot-availability mask).
 *
 * This file is the source of truth. `npm run ai-schema` mirrors it into
 * `training-backend/generated/ai-schema.json`, which the Python backend reads —
 * there is no hand-maintained `templates.py` any more.
 */

import { type ArmorType } from '../../configs/combat/combat.types';

export type TemplateSpawnPattern = 'interleaved' | 'sequential' | 'clustered' | null;
export type TemplateCapability = 'antiAir' | 'antiEthereal' | null;
export type NumberRange = readonly [number, number];

export interface Template {
  id: string;
  name: string;
  description: string;
  enemies: readonly (readonly [string, number])[];
  countRange: NumberRange;
  spawnDelayRange: NumberRange;
  hpMultRange: NumberRange;
  variationRange: NumberRange;
  minWave: number;
  spawnPattern: TemplateSpawnPattern;
  requiresCapability: TemplateCapability;
  bossOnly: boolean;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'zombie_horde',
    name: 'Zombie Horde',
    description: 'Pure zombie horde — unarmored intro, from easy to mega-swarm',
    // zombie-v2 stays a garnish rather than half the horde: at the top of the
    // count range (2000) it is measurably more expensive to render than the
    // classic zombie, and this template is the mega-swarm slot.
    enemies: [['zombie', 0.9], ['zombie-v2', 0.1]],
    countRange: [20, 2000],
    spawnDelayRange: [15, 400],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.05, 0.40],
    minWave: 1,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'rat_tide',
    name: 'Rat Tide',
    description: 'Pure rat flood — 100 to 5000 rats',
    enemies: [['rat', 1.0]],
    countRange: [100, 5000],
    spawnDelayRange: [10, 200],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.30],
    minWave: 8,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'penguin_rush',
    name: 'Penguin Rush',
    description: 'Fast penguins with rat fillers',
    enemies: [['penguin', 0.9], ['rat', 0.1]],
    countRange: [30, 500],
    spawnDelayRange: [10, 300],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.35],
    minWave: 5,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'light_mix',
    name: 'Light Mix',
    description: 'Wallsmashers + spiders',
    enemies: [['wallsmasher', 0.5], ['spider', 0.5]],
    countRange: [30, 400],
    spawnDelayRange: [30, 500],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.40],
    minWave: 4,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'spider_swarm',
    name: 'Spider Swarm',
    description: 'Pure spider flood',
    enemies: [['spider', 1.0]],
    countRange: [50, 800],
    spawnDelayRange: [20, 350],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.35],
    minWave: 8,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'wallsmasher_crew',
    name: 'Wallsmasher Crew',
    description: 'Pure wallsmashers — HP focus',
    enemies: [['wallsmasher', 1.0]],
    countRange: [15, 200],
    spawnDelayRange: [50, 600],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.10, 0.40],
    minWave: 6,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'bat_swarm',
    name: 'Bat Swarm',
    description: 'Pure bat swarm — needs Anti-Air',
    enemies: [['bat', 1.0]],
    countRange: [30, 600],
    spawnDelayRange: [15, 300],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.30],
    minWave: 7,
    spawnPattern: null,
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'hornet_strike',
    name: 'Hornet Strike',
    description: 'Hornets + bats — needs Anti-Air',
    enemies: [['hornet', 0.7], ['bat', 0.3]],
    countRange: [20, 300],
    spawnDelayRange: [30, 400],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.10, 0.40],
    minWave: 9,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'tank_column',
    name: 'Tank Column',
    description: 'Tanks + zombie soldiers',
    enemies: [['tank', 0.6], ['zombie-soldier', 0.4]],
    countRange: [10, 150],
    spawnDelayRange: [80, 800],
    hpMultRange: [0.5, 8.0],
    variationRange: [0.10, 0.35],
    minWave: 10,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'bear_pack',
    name: 'Bear Pack',
    description: 'Pure bear pack',
    enemies: [['bear', 1.0]],
    countRange: [8, 120],
    spawnDelayRange: [60, 600],
    hpMultRange: [0.5, 7.0],
    variationRange: [0.10, 0.35],
    minWave: 12,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'mech_army',
    name: 'Mech Army',
    description: 'Pure mechs — late-game stress test',
    enemies: [['mech', 1.0]],
    countRange: [5, 100],
    spawnDelayRange: [100, 900],
    hpMultRange: [0.5, 10.0],
    variationRange: [0.10, 0.40],
    minWave: 20,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'dragon_elite',
    name: 'Dragon Elite',
    description: 'Dragons + hornets — needs Anti-Air',
    enemies: [['dragon', 0.6], ['hornet', 0.4]],
    countRange: [5, 100],
    spawnDelayRange: [80, 800],
    hpMultRange: [0.5, 8.0],
    variationRange: [0.10, 0.40],
    minWave: 15,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'mammoth_siege',
    name: 'Mammoth Siege',
    description: 'Mammoths + wallsmashers',
    enemies: [['mammoth', 0.7], ['wallsmasher', 0.3]],
    countRange: [8, 120],
    spawnDelayRange: [100, 1000],
    hpMultRange: [0.5, 10.0],
    variationRange: [0.10, 0.40],
    minWave: 14,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'ghost_surge',
    name: 'Ghost Surge',
    description: 'Ghosts + wraiths — needs Magic/Ice',
    enemies: [['ghost', 0.8], ['wraith', 0.2]],
    countRange: [20, 350],
    spawnDelayRange: [30, 400],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.10, 0.40],
    minWave: 12,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'wraith_storm',
    name: 'Wraith Storm',
    description: 'Pure wraiths — needs Magic/Ice',
    enemies: [['wraith', 1.0]],
    countRange: [15, 300],
    spawnDelayRange: [20, 350],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.05, 0.35],
    minWave: 18,
    spawnPattern: null,
    requiresCapability: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'chaos_wave',
    name: 'Chaos Wave',
    description: 'Chaotic 4-type mix — needs Anti-Air',
    enemies: [['zombie', 0.3], ['tank', 0.3], ['hornet', 0.2], ['bear', 0.2]],
    countRange: [25, 500],
    spawnDelayRange: [40, 500],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.15, 0.50],
    minWave: 15,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'armor_gauntlet',
    name: 'Armor Gauntlet',
    description: 'All 4 armor categories at once',
    enemies: [['rat', 0.25], ['tank', 0.25], ['mammoth', 0.25], ['ghost', 0.25]],
    countRange: [30, 600],
    spawnDelayRange: [40, 500],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.15, 0.45],
    minWave: 20,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'boss_herbert',
    name: 'Boss: Herbert',
    description: 'Herbert boss with support waves',
    enemies: [['herbert', 0.0334], ['tank', 0.4833], ['zombie', 0.4833]],
    countRange: [10, 100],
    spawnDelayRange: [100, 1200],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 20,
    spawnPattern: 'clustered',
    requiresCapability: null,
    bossOnly: true,
  },
  {
    // Stone Golem squad — fortified, slow, very tough. Curriculum slot W15.
    // minWave matches mammoth_siege (14): both are fortified DPS checks, and
    // the curriculum reaches this template one wave later.
    id: 'golem_squad',
    name: 'Golem Squad',
    description: 'Stone Golems — fortified DPS check, slow but very tough',
    enemies: [['stone-golem', 1.0]],
    countRange: [5, 60],
    spawnDelayRange: [200, 1500],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 14,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
];

/** Permanent output-slot count (must match MAX_TEMPLATE_SLOTS in backend). */
export const MAX_TEMPLATE_SLOTS = 32;

/** Number of currently defined templates — slots beyond this are reserved. */
export const NUM_ACTIVE_TEMPLATES = TEMPLATES.length;

/** Template cooldown: template blocked for N waves after use. */
export const TEMPLATE_COOLDOWN_WAVES = 2;

/** Global wave-duration safety cap (count × spawn_delay ≤ 3 min). */
export const MAX_WAVE_DURATION_MS = 180_000;
export const MIN_SPAWN_DELAY_MS = 5;

/** DPS-scaled range caps (Phase 5.11b). Mirrored into the generated schema. */
export const DPS_RAMP_FLOOR = 0.10;
export const DPS_RAMP_COUNT = 500.0;
export const DPS_RAMP_HP_MULT = 1000.0;

/**
 * Fairness gate — how far a wave may exceed what the defense can actually kill.
 *
 * The DPS ramp scales a wave against the *template's* range, so its floor is
 * relative: 10% of zombie_horde's 20-2000 span is still 218 enemies, which at
 * wave 1 (100 credits = two archers = 50 DPS) is unkillable by an order of
 * magnitude. Every run died in the first few waves and the net never saw the
 * curriculum past wave 11.
 *
 * This gate is absolute instead: estimate the HP the defense can chew through
 * over the wave, allow the wave to carry `HEADROOM` times that much — the
 * overshoot is exactly the leak that produces the 1-5% damage the reward wants
 * — and clamp the count to fit.
 *
 * It is a floor on fairness, not the difficulty knob. On a well-built defense
 * it does not bind at all; the ramp and the net's own factors stay in charge.
 */
export const FAIRNESS_HEADROOM = 1.25;

/**
 * Seconds of fire the defense gets beyond the spawn window — enemies keep
 * walking (and dying) after the last one spawns. A coarse stand-in for path
 * length, which the training backend has no view of.
 */
export const FAIRNESS_ENGAGEMENT_SECONDS = 30;

/** The gate never clamps below this; a wave of one enemy is not a wave. */
export const FAIRNESS_MIN_COUNT = 5;

/**
 * Largest enemy count the defense can plausibly fight, or null if unbounded.
 *
 * Mirrors `schema.fair_max_count` in the training backend — inference has to
 * apply the same gate the net was trained under, or the shipped game hands out
 * waves the training run never produced.
 *
 * Uses armor-weighted effective DPS rather than raw DPS: an archer counts fully
 * against unarmored and barely at all (0.15x) against ethereal, and a wave of
 * wraiths has to be judged by the latter. Ground and air are read separately so
 * a defense that cannot shoot upward gets no credit for a bat swarm.
 *
 * Closed form, since the wave's duration depends on the count itself:
 *
 *     killable = dps * (count * delaySeconds + ENGAGEMENT) * HEADROOM
 *     want:  count * hpPerEnemy <= killable
 *
 * A non-positive denominator means the defense out-damages the spawn rate, so
 * nothing needs capping.
 */
export function fairMaxCount(
  template: Template,
  hpMult: number,
  spawnDelayMs: number,
  effectiveDps: { ground?: Record<string, number>; air?: Record<string, number> } | undefined,
  killThroughput: { ground: number; air: number } | undefined,
  enemyArmor: (enemyId: string) => ArmorType,
  enemyIsAir: (enemyId: string) => boolean,
  enemyBaseHp: (enemyId: string) => number,
): number | null {
  const ground = effectiveDps?.ground ?? {};
  const air = effectiveDps?.air ?? {};

  let totalShare = 0;
  let weightedDps = 0;
  let weightedHp = 0;
  let weightedThroughput = 0;
  for (const [enemy, share] of template.enemies) {
    if (share <= 0) continue;
    const isAir = enemyIsAir(enemy);
    const dpsSource = isAir ? air : ground;
    weightedDps += share * (dpsSource[enemyArmor(enemy)] ?? 0);
    weightedThroughput += share * (isAir ? (killThroughput?.air ?? 0) : (killThroughput?.ground ?? 0));
    weightedHp += share * enemyBaseHp(enemy) * hpMult;
    totalShare += share;
  }
  if (totalShare <= 0) return null;

  const dps = weightedDps / totalShare;
  const hpPerEnemy = weightedHp / totalShare;
  const throughput = weightedThroughput / totalShare;
  // No effective damage at all: the capability mask owns that case. Shrinking
  // an unwinnable wave only makes it a smaller unwinnable wave.
  if (dps <= 0 || hpPerEnemy <= 0) return null;

  // Kills per second, not damage per second.
  //
  // Damage alone said a defense doing 76 DPS could clear 848 rats of 3.4 HP —
  // twice over. It could not: a tower engages one target per shot and throws
  // away the surplus, so two archers kill two rats a second regardless of how
  // much damage each shot carries. Against tanky enemies the damage term binds
  // instead, and throughput is irrelevant. Whichever is scarcer wins.
  const dpsLimited = dps / hpPerEnemy;
  const killsPerSecond = throughput > 0 ? Math.min(dpsLimited, throughput) : dpsLimited;
  if (killsPerSecond <= 0) return null;

  // Closed form, since the wave's duration depends on the count:
  //   killable = killsPerSecond * (count * delaySeconds + ENGAGEMENT) * HEADROOM
  //   want:  count <= killable
  const budget = killsPerSecond * FAIRNESS_HEADROOM;
  const denominator = 1 - budget * (Math.max(0, spawnDelayMs) / 1000);
  if (denominator <= 0) return null;

  return Math.max(
    FAIRNESS_MIN_COUNT,
    Math.floor((budget * FAIRNESS_ENGAGEMENT_SECONDS) / denominator),
  );
}

export function getTemplate(idx: number): Template | null {
  if (idx < 0 || idx >= NUM_ACTIVE_TEMPLATES) return null;
  return TEMPLATES[idx];
}

/** Linear interpolation within a [min, max] range. t ∈ [0,1]. */
export function lerpRange(range: NumberRange, t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/**
 * Template availability mask for a wave. Length MAX_TEMPLATE_SLOTS;
 * true = the model may pick this slot.
 *
 * Inside the curriculum the mask collapses to the single pinned template. That
 * is deliberate and it is what keeps training honest: the backend samples under
 * this same mask, so the sampled action is always the wave that ships. The
 * previous design masked freely and then overwrote the choice in the decoder,
 * which trained the template head on decisions that never happened.
 *
 * Past the curriculum the designer gates apply: `minWave`, capability
 * requirements, the reuse cooldown and the boss cadence.
 *
 * `forcedTemplateId` comes from the wave curriculum. It is passed in rather
 * than imported so this module stays free of a dependency on
 * `wave-curriculum.config`, which already imports TEMPLATES from here.
 *
 * Mirrors `schema.get_available_template_mask` in the training backend.
 */
export function getAvailableTemplateMask(
  currentWave: number,
  hasAntiAir: boolean,
  hasAntiEthereal: boolean,
  recentTemplateIndices: readonly number[],
  forcedTemplateId: string | null = null,
): boolean[] {
  const mask = new Array<boolean>(MAX_TEMPLATE_SLOTS).fill(false);

  const forcedId = forcedTemplateId;
  if (forcedId) {
    const forcedIdx = TEMPLATES.findIndex((t) => t.id === forcedId);
    if (forcedIdx >= 0) {
      mask[forcedIdx] = true;
      return mask;
    }
    // An unknown curriculum id is a config bug; fall through to free choice
    // rather than returning an all-false mask.
  }

  const recent = new Set(recentTemplateIndices.slice(-TEMPLATE_COOLDOWN_WAVES));
  const passesGates = (t: Template, allowBoss: boolean): boolean => {
    if (currentWave < t.minWave) return false;
    if (t.requiresCapability === 'antiAir' && !hasAntiAir) return false;
    if (t.requiresCapability === 'antiEthereal' && !hasAntiEthereal) return false;
    if (t.bossOnly) return allowBoss && currentWave % 10 === 0;
    return true;
  };

  for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
    if (!passesGates(TEMPLATES[i], true)) continue;
    if (recent.has(i)) continue;
    mask[i] = true;
  }

  // Fallbacks: the cooldown must never be able to starve the mask, and an
  // all-false mask would make the masked softmax produce NaN.
  if (!mask.some((x) => x)) {
    for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
      if (passesGates(TEMPLATES[i], false)) {
        mask[i] = true;
        break;
      }
    }
  }
  if (!mask.some((x) => x)) mask[0] = true;

  return mask;
}
