import { COLOR_GRADING_PRESETS, type ColorGradingPreset } from './post-processing/color-grading';

/**
 * Visual effects the player can switch off (display menu of the quick
 * actions, persisted by DebugFacadeService). An effect that is off is not
 * spawned and not drawn; damage, status effects and events stay the same.
 * ThreeTilesEngine.applyVfxSettings() hands the settings to the renderers.
 */
export interface VfxSettings {
  /** Muzzle particles and the muzzle flash light (guns, launcher, bow) */
  muzzleFlash: boolean;
  /** Streak ribbons and trail particles behind projectiles */
  projectileTrails: boolean;
  /** Fire-atlas explosions with their smoke, spark bursts and blood spray at hits */
  impactEffects: boolean;
  /** Blood, frost and scorch decals on the ground */
  groundMarks: boolean;
  /** Blue tint and orbiting ice particles on slowed enemies */
  freezeTint: boolean;
  /** Bloom pass (post-processing) */
  bloom: boolean;
  /** LUT color grading pass (post-processing), 'none' = off */
  colorGrading: ColorGradingPreset;
  /** Red mood, glowing enemies and searchlights on blood moon waves (BloodMoonLook) */
  bloodMoon: boolean;
}

/** The look of the game before the settings existed. */
export const DEFAULT_VFX_SETTINGS: Readonly<VfxSettings> = {
  muzzleFlash: true,
  projectileTrails: true,
  impactEffects: true,
  groundMarks: true,
  freezeTint: true,
  bloom: false,
  colorGrading: 'none',
  bloodMoon: true,
};

/** Effect quality presets over the switches that cost frame time. */
export type VfxPreset = 'low' | 'medium' | 'high';

/**
 * What a preset sets: everything but the freeze tint and the blood moon,
 * which cost next to nothing and are a matter of taste. The screen shake
 * is no VFX setting at all, a preset never turns it back on for a player
 * who switched it off.
 */
export type VfxPresetSettings = Omit<VfxSettings, 'freezeTint' | 'bloodMoon'>;

export const VFX_PRESETS: Readonly<Record<VfxPreset, Readonly<VfxPresetSettings>>> = {
  // Nothing that is decoration only
  low: {
    muzzleFlash: false,
    projectileTrails: false,
    impactEffects: false,
    groundMarks: false,
    bloom: false,
    colorGrading: 'none',
  },
  // Without the trails: a mesh and a draw call per projectile, rebuilt every frame
  medium: {
    muzzleFlash: true,
    projectileTrails: false,
    impactEffects: true,
    groundMarks: true,
    bloom: false,
    colorGrading: 'none',
  },
  // The look as designed. Bloom is no part of it: it lets every emissive
  // material glow for good (see VFXService.handleChainLightning).
  high: {
    muzzleFlash: true,
    projectileTrails: true,
    impactEffects: true,
    groundMarks: true,
    bloom: false,
    colorGrading: 'none',
  },
};

const PRESET_ORDER: readonly VfxPreset[] = ['low', 'medium', 'high'];

/** The settings with a preset applied; the freeze tint and the blood moon keep their values. */
export function withVfxPreset(settings: VfxSettings, preset: VfxPreset): VfxSettings {
  return { ...settings, ...VFX_PRESETS[preset] };
}

/** The preset the settings match, null for a mix of the player's own. */
export function matchingVfxPreset(settings: VfxSettings): VfxPreset | null {
  for (const preset of PRESET_ORDER) {
    const values = VFX_PRESETS[preset];
    const keys = Object.keys(values) as (keyof VfxPresetSettings)[];
    if (keys.every((key) => settings[key] === values[key])) return preset;
  }
  return null;
}

type VfxSwitch = Exclude<keyof VfxSettings, 'colorGrading'>;

/** VFX settings from stored values; anything missing or of the wrong kind takes the default. */
export function readVfxSettings(stored: Partial<Record<keyof VfxSettings, unknown>>): VfxSettings {
  const flag = (key: VfxSwitch): boolean => {
    const value = stored[key];
    return typeof value === 'boolean' ? value : DEFAULT_VFX_SETTINGS[key];
  };
  const grading = COLOR_GRADING_PRESETS.find((preset) => preset.id === stored.colorGrading);
  return {
    muzzleFlash: flag('muzzleFlash'),
    projectileTrails: flag('projectileTrails'),
    impactEffects: flag('impactEffects'),
    groundMarks: flag('groundMarks'),
    freezeTint: flag('freezeTint'),
    bloom: flag('bloom'),
    colorGrading: grading?.id ?? DEFAULT_VFX_SETTINGS.colorGrading,
    bloodMoon: flag('bloodMoon'),
  };
}
