import type { ColorGradingPreset } from '../../three-engine/post-processing/color-grading';

/**
 * Persistence of the display options panel. Kept apart from the component so
 * it can be tested without loading Angular.
 */
export const STORAGE_KEY = 'td_display_options';

export interface DisplayOptions {
  enemies: boolean;
  healthBars: boolean;
  animations: boolean;
  movement: boolean;
  textures: boolean;
  skeletonCloning: boolean;
  alphaBlend: boolean;
  screenShake: boolean;
  colorGrading: ColorGradingPreset;
}

/**
 * Write the panel's options into the stored object instead of replacing it.
 * DebugFacadeService keeps options the panel does not show in the same
 * object (damageNumbers); a plain overwrite dropped them on every page load.
 */
export function persistDisplayOptions(opts: DisplayOptions): void {
  let stored: unknown = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch { /* corrupt entry: start over */ }
  const base = stored !== null && typeof stored === 'object' ? stored : {};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, ...opts }));
  } catch { /* ignore */ }
}
