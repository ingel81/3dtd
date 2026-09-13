import { isBloodMoonWave } from '../../configs/blood-moon.config';

export interface BloodMoonBanner {
  /** Under the title: "Wave 14" */
  wave: string;
  /** For screen readers */
  announcement: string;
}

/**
 * The banner a wave start shows, null when the wave has no blood moon or
 * its look is switched off (display option): there is nothing to announce.
 */
export function bloodMoonBanner(wave: number, lookEnabled: boolean): BloodMoonBanner | null {
  if (!lookEnabled || !isBloodMoonWave(wave)) return null;
  return { wave: `Wave ${wave}`, announcement: `Blood moon, wave ${wave}.` };
}
