import type { ColorGradingPreset } from '../three-engine/post-processing/color-grading';

/**
 * Persistence of the display options. The display menu of the quick actions
 * and the Display debug window keep everything in one object under one key;
 * a missing field means the default. Free of Angular, so the game engine
 * (ScreenShakeService) and tests can use it.
 */
export const STORAGE_KEY = 'td_display_options';

/**
 * Keys the frame cap and the screen shake had of their own until 2026-09-12.
 * loadDisplayOptions() folds them into the object once and drops them.
 */
export const LEGACY_FPS_LIMIT_KEY = '3dtd-fps-limit';
export const LEGACY_SCREEN_SHAKE_KEY = 'td_screen_shake_enabled';

/** Everything stored under STORAGE_KEY. */
export interface StoredDisplayOptions {
  // Display debug window
  enemies?: boolean;
  animations?: boolean;
  movement?: boolean;
  textures?: boolean;
  skeletonCloning?: boolean;
  alphaBlend?: boolean;
  colorGrading?: ColorGradingPreset;
  // Display menu of the quick actions
  healthBars?: boolean;
  damageNumbers?: boolean;
  screenShake?: boolean;
  /** Frame cap in fps, 0 = unlimited */
  fpsLimit?: number;
}

/**
 * The stored options, old keys folded in. The values are not checked: read
 * each one against its default.
 */
export function loadDisplayOptions(): StoredDisplayOptions {
  return foldLegacyKeys(readStored());
}

/**
 * Write options into the stored object instead of replacing it. Every
 * writer owns only some of the fields; a plain overwrite by the debug
 * window used to drop damageNumbers on every page load.
 */
export function persistDisplayOptions(patch: StoredDisplayOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), ...patch }));
  } catch { /* storage blocked or full */ }
}

function readStored(): StoredDisplayOptions {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StoredDisplayOptions;
    }
  } catch { /* corrupt entry: start over */ }
  return {};
}

/**
 * Move the values of the old keys into the object, unless it already holds
 * one, and remove the old keys once the object is written.
 */
function foldLegacyKeys(options: StoredDisplayOptions): StoredDisplayOptions {
  let fps: string | null;
  let shake: string | null;
  try {
    fps = localStorage.getItem(LEGACY_FPS_LIMIT_KEY);
    shake = localStorage.getItem(LEGACY_SCREEN_SHAKE_KEY);
  } catch {
    return options;
  }
  if (fps === null && shake === null) return options;

  const folded = { ...options };
  if (fps !== null && folded.fpsLimit === undefined) folded.fpsLimit = Number(fps);
  if (shake !== null && folded.screenShake === undefined) folded.screenShake = shake === 'true';
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folded));
    localStorage.removeItem(LEGACY_FPS_LIMIT_KEY);
    localStorage.removeItem(LEGACY_SCREEN_SHAKE_KEY);
  } catch { /* the old keys stay and are folded in again next time */ }
  return folded;
}
