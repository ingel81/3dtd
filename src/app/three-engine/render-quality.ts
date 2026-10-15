/**
 * Quality levels of the picture (docs/RENDER_QUALITY.md, E154): Low,
 * Medium, High, Ultra and Auto. One table says what each level sets, in
 * three groups that never mix:
 *
 * - `general`: every world (render resolution with its dynamic range,
 *   antialiasing, whether bloom may run)
 * - `customMaps`: custom maps only (shadow map, detail and draw distance,
 *   impostors, grass, the map's particles and point lights)
 * - `tiles`: the 3D tiles only (their detail target)
 *
 * High is the picture as it was before the levels; on tiles exactly
 * (resolution up to DPR 2, MSAA, errorTarget 20). Auto picks a level from
 * the GPU's name, checks it with a short measurement once, and plays
 * custom maps a level lower than tiles: resolution costs them far more
 * (docs/BENCHMARKS.md, Bildkosten). On top of the level the player may set
 * parts of each world on their own (`QualityOverrides`, E156), each part
 * taking its values from another level's row; how plants move in the wind
 * is a setting of its own that no level changes. Pure: no Angular, no three.
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = QualityLevel | 'auto';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
export const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', ...QUALITY_LEVELS];

/** The world kinds the levels tell apart: a custom map, or tiles and everything else */
export type QualityWorld = 'tiles' | 'custom-map';

export interface GeneralQuality {
  /**
   * Render resolution as a share of the pixel ratio (min(DPR, `pixelRatioCap`)):
   * where it starts, and the range the dynamic resolution moves it in
   * (null: fixed)
   */
  scale: number;
  dynamic: { min: number; max: number } | null;
  pixelRatioCap: number;
  /** MSAA 4x on the scene, or FXAA after it (cheaper on weak GPUs) */
  antialias: 'msaa' | 'fxaa';
  /** Bloom may run where the effect switch has it on */
  bloom: boolean;
}

export interface CustomMapQuality {
  /** A further cap on the pixel ratio on custom maps: each pixel costs them several times what it costs tiles */
  pixelRatioCap: number;
  shadowMapSize: number;
  /** PCF spread of the shadow edge, texels */
  shadowRadius: number;
  /** Factor on the distances where objects switch detail and stop being drawn */
  lodBias: number;
  /** Trees and big rocks become flat impostors from this distance, m */
  impostorFrom: number;
  /** Grass blades around the camera (0: no grass) and up to which camera distance they show, m */
  grassBlades: number;
  grassDistance: number;
  /** Share of the map's particles (fire, smoke, embers, spray) */
  particles: number;
  /** Real point lights following the lamps nearest the focus at night */
  pointLights: number;
  /** Camera distances from which the ground reads one layer lookup, then only the layers' average colours, m */
  farSingle: number;
  farFlat: number;
  /** Camera distance up to which painted ground on steep slopes reads its side planes instead of stretching, m (0: none) */
  steepNear: number;
  /**
   * Switchable effects of the map renderer (map-effects.ts): water shows the
   * ground behind it bent, swell on seas, glowing lava veins with heat
   * shimmer, the land's own shadow beyond the cached shadow map
   */
  refraction: boolean;
  seaWaves: boolean;
  lavaGlow: boolean;
  shadowCascade: boolean;
  /** Share of the wind's sway on grass, trees and plants (the player's plant motion; every level 1) */
  plantSway: number;
}

export interface TilesQuality {
  /** TilesRenderer.errorTarget, px: lower loads finer tiles */
  errorTarget: number;
}

export interface QualityKnobs {
  level: QualityLevel;
  general: GeneralQuality;
  customMaps: CustomMapQuality;
  tiles: TilesQuality;
}

export const QUALITY_TABLE: Readonly<Record<QualityLevel, QualityKnobs>> = {
  low: {
    level: 'low',
    general: { scale: 0.6, dynamic: { min: 0.5, max: 0.8 }, pixelRatioCap: 1, antialias: 'fxaa', bloom: false },
    customMaps: {
      pixelRatioCap: 1, shadowMapSize: 1024, shadowRadius: 1.5, lodBias: 0.5, impostorFrom: 200,
      grassBlades: 0, grassDistance: 0, particles: 0.4, pointLights: 2,
      farSingle: 80, farFlat: 220, steepNear: 0, refraction: false, seaWaves: false, lavaGlow: false, shadowCascade: false, plantSway: 1,
    },
    tiles: { errorTarget: 32 },
  },
  medium: {
    level: 'medium',
    general: { scale: 0.8, dynamic: { min: 0.6, max: 1 }, pixelRatioCap: 1, antialias: 'fxaa', bloom: true },
    customMaps: {
      pixelRatioCap: 1, shadowMapSize: 2048, shadowRadius: 1.5, lodBias: 0.75, impostorFrom: 280,
      grassBlades: 35_000, grassDistance: 90, particles: 0.7, pointLights: 4,
      farSingle: 110, farFlat: 300, steepNear: 110, refraction: false, seaWaves: true, lavaGlow: false, shadowCascade: true, plantSway: 1,
    },
    tiles: { errorTarget: 24 },
  },
  high: {
    level: 'high',
    general: { scale: 1, dynamic: null, pixelRatioCap: 2, antialias: 'msaa', bloom: true },
    customMaps: {
      pixelRatioCap: 1.5, shadowMapSize: 4096, shadowRadius: 1.5, lodBias: 1, impostorFrom: 380,
      grassBlades: 70_000, grassDistance: 140, particles: 1, pointLights: 6,
      farSingle: 150, farFlat: 400, steepNear: 150, refraction: true, seaWaves: true, lavaGlow: true, shadowCascade: true, plantSway: 1,
    },
    tiles: { errorTarget: 20 },
  },
  ultra: {
    level: 'ultra',
    general: { scale: 1, dynamic: null, pixelRatioCap: 2, antialias: 'msaa', bloom: true },
    customMaps: {
      pixelRatioCap: 2, shadowMapSize: 4096, shadowRadius: 2.5, lodBias: 1.25, impostorFrom: 500,
      grassBlades: 100_000, grassDistance: 180, particles: 1, pointLights: 6,
      farSingle: 220, farFlat: 600, steepNear: 220, refraction: true, seaWaves: true, lavaGlow: true, shadowCascade: true, plantSway: 1,
    },
    tiles: { errorTarget: 12 },
  },
};

/** The most grass blades any level draws (the grass field's capacity) */
export const MAX_GRASS_BLADES = Math.max(...QUALITY_LEVELS.map((l) => QUALITY_TABLE[l].customMaps.grassBlades));

/** One level lower, Low stays Low */
export function lowerLevel(level: QualityLevel): QualityLevel {
  return QUALITY_LEVELS[Math.max(0, QUALITY_LEVELS.indexOf(level) - 1)];
}

/** One level higher, Ultra stays Ultra */
export function higherLevel(level: QualityLevel): QualityLevel {
  return QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, QUALITY_LEVELS.indexOf(level) + 1)];
}

/**
 * Parts of the picture the player sets on top of the level (E156), each for
 * one world. A step takes its part from that level's row of the table:
 * `tileDetail` the tiles' detail target (real places), `shadows` the shadow
 * map, `farDetail` detail and draw distance, impostors and where the ground
 * gets cheaper, `grass` blades and their distance (custom maps). A switch
 * turns one of the map's effects on or off (map-effects.ts).
 */
export interface QualityOverrides {
  tileDetail?: QualityLevel;
  shadows?: QualityLevel;
  farDetail?: QualityLevel;
  grass?: QualityLevel;
  refraction?: boolean;
  seaWaves?: boolean;
  lavaGlow?: boolean;
  shadowCascade?: boolean;
}

export type QualityStep = 'tileDetail' | 'shadows' | 'farDetail' | 'grass';
export type QualitySwitch = 'refraction' | 'seaWaves' | 'lavaGlow' | 'shadowCascade';
export type QualityOverride = QualityStep | QualitySwitch;

/** The custom-map knobs a step takes from its level's row */
const STEP_KNOBS: Record<Exclude<QualityStep, 'tileDetail'>, readonly (keyof CustomMapQuality)[]> = {
  shadows: ['shadowMapSize', 'shadowRadius'],
  farDetail: ['lodBias', 'impostorFrom', 'farSingle', 'farFlat', 'steepNear'],
  grass: ['grassBlades', 'grassDistance'],
};
const QUALITY_STEPS: readonly QualityStep[] = ['tileDetail', 'shadows', 'farDetail', 'grass'];
export const QUALITY_SWITCHES: readonly QualitySwitch[] = ['refraction', 'seaWaves', 'lavaGlow', 'shadowCascade'];

function isSwitch(key: QualityOverride): key is QualitySwitch {
  return QUALITY_SWITCHES.includes(key as QualitySwitch);
}

/** The world an override acts on */
export function overrideWorld(key: QualityOverride): QualityWorld {
  return key === 'tileDetail' ? 'tiles' : 'custom-map';
}

/** What `key` is at `level` without an override: the level itself for a step, the table's value for a switch */
export function levelValue(level: QualityLevel, key: QualityOverride): QualityLevel | boolean {
  return isSwitch(key) ? QUALITY_TABLE[level].customMaps[key] : level;
}

/** The overrides of `world` that set something else than `level` would: the player's own mix there */
export function mixedOverrides(level: QualityLevel, overrides: QualityOverrides, world: QualityWorld): QualityOverride[] {
  return (Object.keys(overrides) as QualityOverride[])
    .filter((key) => overrideWorld(key) === world && overrides[key] !== undefined && overrides[key] !== levelValue(level, key));
}

/** How plants move in the map's wind: not at all, calmer, as far as the map's wind takes them */
export type PlantMotion = 'off' | 'calm' | 'full';
export const PLANT_MOTIONS: readonly PlantMotion[] = ['off', 'calm', 'full'];
/** Share of the wind's sway per plant motion; the map keeps its own wind strength */
export const PLANT_SWAY: Readonly<Record<PlantMotion, number>> = { off: 0, calm: 0.4, full: 1 };

/** The knobs that play: `level`'s row with the player's overrides and plant motion on top */
export function knobsWith(level: QualityLevel, overrides: QualityOverrides, plantMotion: PlantMotion): QualityKnobs {
  const base = QUALITY_TABLE[level];
  const customMaps: CustomMapQuality = { ...base.customMaps, plantSway: PLANT_SWAY[plantMotion] };
  const knobs = customMaps as unknown as Record<keyof CustomMapQuality, number | boolean>;
  for (const step of Object.keys(STEP_KNOBS) as (keyof typeof STEP_KNOBS)[]) {
    const from = overrides[step];
    if (from) for (const key of STEP_KNOBS[step]) knobs[key] = QUALITY_TABLE[from].customMaps[key];
  }
  for (const key of QUALITY_SWITCHES) {
    const on = overrides[key];
    if (on !== undefined) customMaps[key] = on;
  }
  const tiles = overrides.tileDetail ? QUALITY_TABLE[overrides.tileDetail].tiles : base.tiles;
  return { ...base, customMaps, tiles };
}

/** What Auto settled on for this machine: from the GPU's name, then checked by a measurement */
export interface AutoQuality {
  /** The GPU the guess was made for; another GPU (a laptop on its other chip) guesses again */
  gpu: string;
  level: QualityLevel;
  /** The short measurement after the first start ran */
  measured: boolean;
}

/**
 * The level for a GPU by its name as WebGL reports it. A guess the first
 * start's measurement checks: integrated and software renderers Low, older
 * or small dedicated cards Medium, current dedicated cards High; Ultra only
 * through the measurement or by hand.
 */
export function levelForGpu(name: string): QualityLevel {
  const n = name.toLowerCase();
  if (!n || /swiftshader|llvmpipe|software|basic render/.test(n)) return 'low';
  // Intel's dedicated cards before its integrated ones
  if (/\barc(\(tm\))? (a7|b\d)/.test(n)) return 'high';
  if (/\barc\b/.test(n)) return 'medium';
  // Integrated: Intel's, AMD's Radeon Graphics without a model number, phone and tablet chips
  if (/intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|mali|adreno|powervr|apple gpu/.test(n)) return 'low';
  if (/apple m\d (pro|max|ultra)/.test(n)) return 'high';
  if (/apple m\d/.test(n)) return 'medium';
  // NVIDIA: GTX and MX, RTX x050; AMD: RX 400 to 5000
  if (/\bmx\s?\d|gtx|rtx\s?\d0?50\b|quadro|rx\s?[45]\d\d\b|rx\s?5[0-9]{3}/.test(n)) return 'medium';
  if (/rtx|rx\s?[6-9]\d{3}|radeon pro/.test(n)) return 'high';
  return 'medium';
}

/**
 * GPU time per frame the first start's measurement accepts at a level, ms
 * (the 90th percentile over a few seconds). Above `down` Auto steps a level
 * lower; below `up` (and below High) a level higher.
 */
export const AUTO_BUDGET = { down: 10, up: 3 } as const;

/** Auto's level after the first start's measurement of `gpuP90Ms` at `level` */
export function levelAfterMeasure(level: QualityLevel, gpuP90Ms: number): QualityLevel {
  if (gpuP90Ms > AUTO_BUDGET.down) return lowerLevel(level);
  if (gpuP90Ms < AUTO_BUDGET.up && QUALITY_LEVELS.indexOf(level) < QUALITY_LEVELS.indexOf('high')) return higherLevel(level);
  return level;
}

/**
 * The level that plays on `world`: the chosen one, or Auto's, a level lower
 * on custom maps
 */
export function resolveLevel(setting: QualitySetting, auto: QualityLevel, world: QualityWorld): QualityLevel {
  if (setting !== 'auto') return setting;
  return world === 'custom-map' ? lowerLevel(auto) : auto;
}

/** The pixel ratio a level draws at, at `scale` of its resolution (the dynamic resolution moves it) */
export function pixelRatioFor(knobs: QualityKnobs, world: QualityWorld, devicePixelRatio: number, scale = knobs.general.scale): number {
  let cap = knobs.general.pixelRatioCap;
  if (world === 'custom-map') cap = Math.min(cap, knobs.customMaps.pixelRatioCap);
  return Math.min(devicePixelRatio, cap) * scale;
}

/** localStorage: the chosen setting, Auto's result, the player's overrides and plant motion */
export const QUALITY_STORAGE_KEY = 'td_render_quality_v1';

export interface StoredQuality {
  setting: QualitySetting;
  auto: AutoQuality | null;
  overrides: QualityOverrides;
  plantMotion: PlantMotion;
}

/** The overrides of a stored value that are what they claim to be; the rest goes */
function parseOverrides(value: unknown): QualityOverrides {
  const out: QualityOverrides = {};
  if (!value || typeof value !== 'object') return out;
  const raw = value as Record<string, unknown>;
  for (const key of QUALITY_STEPS) if (QUALITY_LEVELS.includes(raw[key] as QualityLevel)) out[key] = raw[key] as QualityLevel;
  for (const key of QUALITY_SWITCHES) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  return out;
}

export function parseStoredQuality(raw: string | null): StoredQuality {
  const fallback: StoredQuality = { setting: 'auto', auto: null, overrides: {}, plantMotion: 'full' };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<StoredQuality> | null;
    if (!value || typeof value !== 'object') return fallback;
    const setting = QUALITY_SETTINGS.includes(value.setting as QualitySetting) ? (value.setting as QualitySetting) : 'auto';
    const a = value.auto;
    const auto = a && typeof a.gpu === 'string' && QUALITY_LEVELS.includes(a.level as QualityLevel)
      ? { gpu: a.gpu, level: a.level as QualityLevel, measured: a.measured === true }
      : null;
    const plantMotion = PLANT_MOTIONS.includes(value.plantMotion as PlantMotion) ? (value.plantMotion as PlantMotion) : 'full';
    return { setting, auto, overrides: parseOverrides(value.overrides), plantMotion };
  } catch {
    return fallback;
  }
}

export function readStoredQuality(): StoredQuality {
  try {
    return parseStoredQuality(localStorage.getItem(QUALITY_STORAGE_KEY));
  } catch {
    return parseStoredQuality(null);
  }
}

export function writeStoredQuality(stored: StoredQuality): void {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked: the setting holds for this page load
  }
}

/**
 * The level the stored setting plays on `world` for a GPU named `gpu`
 * (Auto's checked result for that GPU, else its guess): for a view without
 * the game's RenderQualityService (the editor)
 */
export function storedLevelFor(stored: StoredQuality, gpu: string, world: QualityWorld): QualityLevel {
  const auto = stored.auto && stored.auto.gpu === gpu ? stored.auto.level : levelForGpu(gpu);
  return resolveLevel(stored.setting, auto, world);
}

/** The knobs the stored setting plays on `world` for a GPU named `gpu`, the player's overrides on top (the editor) */
export function storedKnobsFor(stored: StoredQuality, gpu: string, world: QualityWorld): QualityKnobs {
  return knobsWith(storedLevelFor(stored, gpu, world), stored.overrides, stored.plantMotion);
}

/** `&quality=<level>` in the page's URL: this load plays that level (the graphics benchmark per level) */
export function qualityFromSearch(search: string): QualitySetting | null {
  const value = new URLSearchParams(search).get('quality');
  return QUALITY_SETTINGS.includes(value as QualitySetting) ? (value as QualitySetting) : null;
}
