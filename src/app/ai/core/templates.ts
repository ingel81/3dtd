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
 * Slots 0-17 are active. Slots 18-31 are reserved for future expansion
 * without retraining (blocked by slot-availability mask).
 */

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
    enemies: [['zombie', 0.5], ['zombie-v2', 0.5]],
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
    // Stone Golem squad — fortified, slow, very tough. Used by the static
    // fallback curriculum (W15). minWave: 999 keeps it invisible to the
    // current AI (which hasn't been trained on this slot — see TODO 2.2);
    // re-training will lower this gate.
    id: 'golem_squad',
    name: 'Golem Squad',
    description: 'Stone Golems — fortified DPS check, slow but very tough',
    enemies: [['stone-golem', 1.0]],
    countRange: [5, 60],
    spawnDelayRange: [200, 1500],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 999,
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

/** DPS-scaled range caps (Phase 5.11b) — keep in sync with config.py. */
export const DPS_RAMP_FLOOR = 0.10;
export const DPS_RAMP_COUNT = 500.0;
export const DPS_RAMP_HP_MULT = 1000.0;

export function getTemplate(idx: number): Template | null {
  if (idx < 0 || idx >= NUM_ACTIVE_TEMPLATES) return null;
  return TEMPLATES[idx];
}

/** Linear interpolation within a [min, max] range. t ∈ [0,1]. */
export function lerpRange(range: NumberRange, t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/**
 * Compute the template availability mask for the given wave + capabilities.
 * Returns array of length MAX_TEMPLATE_SLOTS; true = allowed, false = blocked.
 */
export function getAvailableTemplateMask(
  currentWave: number,
  hasAntiAir: boolean,
  hasAntiEthereal: boolean,
  recentTemplateIndices: readonly number[],
): boolean[] {
  const mask = new Array<boolean>(MAX_TEMPLATE_SLOTS).fill(false);
  const recent = new Set(recentTemplateIndices.slice(-TEMPLATE_COOLDOWN_WAVES));

  for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
    const t = TEMPLATES[i];
    if (currentWave < t.minWave) continue;
    if (t.requiresCapability === 'antiAir' && !hasAntiAir) continue;
    if (t.requiresCapability === 'antiEthereal' && !hasAntiEthereal) continue;
    if (recent.has(i)) continue;
    if (t.bossOnly && currentWave % 10 !== 0) continue;
    mask[i] = true;
  }

  if (!mask.some(x => x)) {
    for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
      const t = TEMPLATES[i];
      if (currentWave < t.minWave) continue;
      if (t.requiresCapability === 'antiAir' && !hasAntiAir) continue;
      if (t.requiresCapability === 'antiEthereal' && !hasAntiEthereal) continue;
      if (t.bossOnly) continue;
      mask[i] = true;
      break;
    }
  }
  if (!mask.some(x => x)) mask[0] = true;

  return mask;
}
