import { describe, it, expect, vi } from 'vitest';

// A campaign floor so wide that no golem wave fits three minutes with it
vi.mock('../../../configs/campaign.config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../configs/campaign.config')>()),
  campaignMinSpawnDelay: (wave: number) => (wave === 15 ? 10_000 : 0),
}));

import { buildWaveConfig, type PressureReading } from './wave-config-builder';
import { buildWaveContext } from './wave-context';
import { MAX_WAVE_DURATION_MS, TEMPLATES } from '../../templates';
import { PressureController } from './pressure-controller';
import { createEmptySnapshot } from '../../models/game-state-snapshot';

/**
 * TODO E21: where the campaign keeps large models apart and the wave would
 * then run past three minutes, fewer come, each tougher by as much.
 */
describe('the campaign spacing of large models, when the wave does not fit', () => {
  it('sends fewer golems with the health of the whole wave kept', () => {
    const golems = TEMPLATES.findIndex((t) => t.id === 'golem_squad');
    const state = createEmptySnapshot();
    const perArmor = { unarmored: 1e6, light: 1e6, heavy: 1e6, fortified: 1e6, ethereal: 1e6 };
    state.waveNumber = 14;
    state.defense.totalDPS = 1e6;
    state.defense.gateDpsPerArmor = { ground: perArmor, air: perArmor };
    state.defense.killThroughput = { ground: 1e6, air: 1e6 };
    const gate: PressureReading = { pressureMultiplier: 8, status: new PressureController().status };
    const decision = {
      templateIdx: golems,
      factors: { count: 1, spawn: 1, hp: 0.5, variation: 0.5 },
      why: { candidates: 1, lastRanWavesAgo: null, history: 0, tied: 1, ramp: 0.5 },
    };

    const config = buildWaveConfig(decision, state, buildWaveContext(state).candidateReason, gate);

    expect(config.spawnDelay).toBe(10_000);
    expect(config.totalCount).toBe(Math.floor(MAX_WAVE_DURATION_MS / 10_000));
    expect(config.totalCount * config.spawnDelay).toBeLessThanOrEqual(MAX_WAVE_DURATION_MS);
    // Tougher than the template's plain range allows: the health of the cut enemies went into the rest
    expect(config.templateStrength).toBeGreaterThan(TEMPLATES[golems].hpMultRange[1]);
  });
});
