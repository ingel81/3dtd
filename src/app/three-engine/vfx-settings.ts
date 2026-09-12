import type { ColorGradingPreset } from './post-processing/color-grading';

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
};
