import type { VfxSettings } from '../three-engine/vfx-settings';
import { readJson, readText, removeKey, writeJson } from './storage';

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

/** Everything stored under STORAGE_KEY. The VFX settings sit flat in it. */
export interface StoredDisplayOptions extends Partial<VfxSettings> {
  // Display debug window
  enemies?: boolean;
  animations?: boolean;
  movement?: boolean;
  // Display menu of the quick actions, besides the VFX settings
  healthBars?: boolean;
  damageNumbers?: boolean;
  screenShake?: boolean;
  /** Camera cut to a wave's boss with its name (BossIntroService) */
  bossIntro?: boolean;
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
  writeJson(STORAGE_KEY, { ...readStored(), ...patch });
}

function readStored(): StoredDisplayOptions {
  // A corrupt entry starts over
  const parsed = readJson(STORAGE_KEY);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StoredDisplayOptions) : {};
}

/**
 * Move the values of the old keys into the object, unless it already holds
 * one, and remove the old keys once the object is written.
 */
function foldLegacyKeys(options: StoredDisplayOptions): StoredDisplayOptions {
  const fps = readText(LEGACY_FPS_LIMIT_KEY);
  const shake = readText(LEGACY_SCREEN_SHAKE_KEY);
  if (fps === null && shake === null) return options;

  const folded = { ...options };
  if (fps !== null && folded.fpsLimit === undefined) folded.fpsLimit = Number(fps);
  if (shake !== null && folded.screenShake === undefined) folded.screenShake = shake === 'true';
  // Not written: the old keys stay and are folded in again next time
  if (writeJson(STORAGE_KEY, folded)) {
    removeKey(LEGACY_FPS_LIMIT_KEY);
    removeKey(LEGACY_SCREEN_SHAKE_KEY);
  }
  return folded;
}
