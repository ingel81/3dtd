/**
 * Wave Templates — Phase 5.10 (Frontend mirror of training-backend/templates.py)
 *
 * Designer-curated wave compositions. The NN picks a template_idx + strength + count,
 * the decoder expands the template into a concrete wave config.
 *
 * The 18 active slots (0-17) must stay in 1:1 sync with the backend.
 * Slots 18-31 are reserved for future templates (added without retraining).
 *
 * To add a template: append here AND in templates.py at the same slot index.
 */

export type TemplateSpawnPattern = 'interleaved' | 'sequential' | 'clustered' | null;
export type TemplateCapability = 'antiAir' | 'antiEthereal' | null;

export interface Template {
  id: string;
  name: string;
  description: string;
  enemies: readonly (readonly [string, number])[];
  baseCount: number;
  baseSpawnDelayMs: number;
  baseHpMult: number;
  minWave: number;
  spawnPattern: TemplateSpawnPattern;
  requiresCapability: TemplateCapability;
  bossOnly: boolean;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'zombie_horde',
    name: 'Zombie Horde',
    description: 'Langsame Unarmored-Welle mit ein paar Ratten als Füller',
    enemies: [['zombie', 0.8], ['rat', 0.2]],
    baseCount: 40,
    baseSpawnDelayMs: 300,
    baseHpMult: 1.0,
    minWave: 1,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'rat_tide',
    name: 'Rat Tide',
    description: 'Mega-Swarm reiner Ratten mit sehr hoher Dichte',
    enemies: [['rat', 1.0]],
    baseCount: 400,
    baseSpawnDelayMs: 80,
    baseHpMult: 1.0,
    minWave: 8,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'penguin_rush',
    name: 'Penguin Rush',
    description: 'Schnelle Pinguine mit Ratten als Ablenkung',
    enemies: [['penguin', 0.9], ['rat', 0.1]],
    baseCount: 80,
    baseSpawnDelayMs: 150,
    baseHpMult: 1.0,
    minWave: 5,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'light_mix',
    name: 'Light Mix',
    description: 'Wallsmasher und Spider — Einführung in Light-Armor',
    enemies: [['wallsmasher', 0.5], ['spider', 0.5]],
    baseCount: 60,
    baseSpawnDelayMs: 400,
    baseHpMult: 1.0,
    minWave: 4,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'spider_swarm',
    name: 'Spider Swarm',
    description: 'Reine Spider-Flut',
    enemies: [['spider', 1.0]],
    baseCount: 120,
    baseSpawnDelayMs: 250,
    baseHpMult: 1.0,
    minWave: 8,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'wallsmasher_crew',
    name: 'Wallsmasher Crew',
    description: 'Reine Wallsmasher — HP-fokussiertes Light-Team',
    enemies: [['wallsmasher', 1.0]],
    baseCount: 40,
    baseSpawnDelayMs: 500,
    baseHpMult: 1.0,
    minWave: 6,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'bat_swarm',
    name: 'Bat Swarm',
    description: 'Reiner Bat-Schwarm — erfordert Anti-Air',
    enemies: [['bat', 1.0]],
    baseCount: 100,
    baseSpawnDelayMs: 150,
    baseHpMult: 1.0,
    minWave: 7,
    spawnPattern: null,
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'hornet_strike',
    name: 'Hornet Strike',
    description: 'Hornets mit Bat-Support — Fortgeschrittener Air-Mix',
    enemies: [['hornet', 0.7], ['bat', 0.3]],
    baseCount: 50,
    baseSpawnDelayMs: 250,
    baseHpMult: 1.0,
    minWave: 9,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'tank_column',
    name: 'Tank Column',
    description: 'Tanks und Zombie-Soldiers — Heavy-Ground-Einführung',
    enemies: [['tank', 0.6], ['zombie-soldier', 0.4]],
    baseCount: 25,
    baseSpawnDelayMs: 500,
    baseHpMult: 1.0,
    minWave: 10,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'bear_pack',
    name: 'Bear Pack',
    description: 'Reines Bear-Rudel',
    enemies: [['bear', 1.0]],
    baseCount: 20,
    baseSpawnDelayMs: 400,
    baseHpMult: 1.0,
    minWave: 12,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'mech_army',
    name: 'Mech Army',
    description: 'Reine Mechs — Late-Game Heavy-Welle',
    enemies: [['mech', 1.0]],
    baseCount: 15,
    baseSpawnDelayMs: 600,
    baseHpMult: 1.0,
    minWave: 20,
    spawnPattern: null,
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'dragon_elite',
    name: 'Dragon Elite',
    description: 'Dragons mit Hornet-Begleitung — Heavy+Light Air',
    enemies: [['dragon', 0.6], ['hornet', 0.4]],
    baseCount: 15,
    baseSpawnDelayMs: 600,
    baseHpMult: 1.0,
    minWave: 15,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'mammoth_siege',
    name: 'Mammoth Siege',
    description: 'Mammoths mit Wallsmasher — Fortified-Belagerung',
    enemies: [['mammoth', 0.7], ['wallsmasher', 0.3]],
    baseCount: 20,
    baseSpawnDelayMs: 700,
    baseHpMult: 1.0,
    minWave: 14,
    spawnPattern: 'interleaved',
    requiresCapability: null,
    bossOnly: false,
  },
  {
    id: 'ghost_surge',
    name: 'Ghost Surge',
    description: 'Ghosts mit Wraith-Anteil — benötigt Magic/Ice',
    enemies: [['ghost', 0.8], ['wraith', 0.2]],
    baseCount: 40,
    baseSpawnDelayMs: 250,
    baseHpMult: 1.0,
    minWave: 12,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'wraith_storm',
    name: 'Wraith Storm',
    description: 'Reine Wraiths — benötigt Magic/Ice',
    enemies: [['wraith', 1.0]],
    baseCount: 35,
    baseSpawnDelayMs: 200,
    baseHpMult: 1.0,
    minWave: 18,
    spawnPattern: null,
    requiresCapability: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'chaos_wave',
    name: 'Chaos Wave',
    description: 'Chaotisch gemischte Welle aus 4 Typen',
    enemies: [['zombie', 0.3], ['tank', 0.3], ['hornet', 0.2], ['bear', 0.2]],
    baseCount: 50,
    baseSpawnDelayMs: 350,
    baseHpMult: 1.0,
    minWave: 15,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'armor_gauntlet',
    name: 'Armor Gauntlet',
    description: 'Alle 4 Armor-Kategorien gleichzeitig — Allround-Test',
    enemies: [['rat', 0.25], ['tank', 0.25], ['mammoth', 0.25], ['ghost', 0.25]],
    baseCount: 60,
    baseSpawnDelayMs: 400,
    baseHpMult: 1.0,
    minWave: 20,
    spawnPattern: 'interleaved',
    requiresCapability: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'boss_herbert',
    name: 'Boss: Herbert',
    description: 'Herbert-Boss mit Tank- und Zombie-Support',
    enemies: [['herbert', 0.0334], ['tank', 0.4833], ['zombie', 0.4833]],
    baseCount: 30,
    baseSpawnDelayMs: 800,
    baseHpMult: 1.0,
    minWave: 20,
    spawnPattern: 'clustered',
    requiresCapability: null,
    bossOnly: true,
  },
];

/** Permanent output-slot count (must match MAX_TEMPLATE_SLOTS in backend). */
export const MAX_TEMPLATE_SLOTS = 32;

/** Number of currently defined templates — slots beyond this are reserved. */
export const NUM_ACTIVE_TEMPLATES = TEMPLATES.length;

/** Scaling ranges — must match backend config.py. */
export const STRENGTH_MIN = 0.5;
export const STRENGTH_MAX = 2.0;
export const COUNT_MIN = 0.3;
export const COUNT_MAX = 6.0;

/** Template cooldown: template blocked for N waves after use. */
export const TEMPLATE_COOLDOWN_WAVES = 2;

export function getTemplate(idx: number): Template | null {
  if (idx < 0 || idx >= NUM_ACTIVE_TEMPLATES) return null;
  return TEMPLATES[idx];
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

  // Fallback: ensure at least one template is allowed
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
