/**
 * The per-wave rules of the campaign (director/wave-rules.ts): leak step every
 * 30 waves, the campaign's gold, the boss cadence, and the template the
 * campaign pins to waves 1 to 30. Today's sources, adaptive and table, both
 * play them.
 */

import type { WaveRules } from '../director/wave-rules';
import { enemyBaseDamageForWave, isBossWave, templateObjectForWave, waveGold } from './campaign.config';
import { bossVariantForWave } from './boss-variants.config';

export const CAMPAIGN_WAVE_RULES: WaveRules = {
  leakScale: enemyBaseDamageForWave,
  gold: (wave) => waveGold(wave),
  isBoss: isBossWave,
  enemyMix: (wave) => templateObjectForWave(wave)?.enemies ?? null,
  name: (wave) => bossVariantForWave(wave)?.name ?? templateObjectForWave(wave)?.name ?? null,
};
