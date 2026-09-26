import { describe, it, expect } from 'vitest';
import { buildWaveConfig, type PressureReading } from './wave-config-builder';
import { buildWaveContext } from './wave-context';
import { MAX_WAVE_DURATION_MS, TEMPLATES } from '../../templates';
import { PressureController } from './pressure-controller';
import { createEmptySnapshot } from '../../models/game-state-snapshot';
import { spawnFloorMs } from '../../../configs/enemy-types.config';

/**
 * TODO E50 (before it E21 for the campaign alone): the spawner keeps each type
 * its spawn floor apart, and where the wave would then run past three
 * minutes, fewer come, each tougher by as much.
 */
describe('the spawn floor of the types, when the wave does not fit', () => {
  function build(templateId: string) {
    const index = TEMPLATES.findIndex((t) => t.id === templateId);
    const state = createEmptySnapshot();
    const perArmor = { unarmored: 1e6, light: 1e6, heavy: 1e6, fortified: 1e6, ethereal: 1e6 };
    state.waveNumber = 40;
    state.defense.totalDPS = 1e6;
    state.defense.gateDpsPerArmor = { ground: perArmor, air: perArmor };
    state.defense.killThroughput = { ground: 1e6, air: 1e6 };
    const gate: PressureReading = { pressureMultiplier: 1, status: new PressureController().status };
    const decision = {
      templateIdx: index,
      factors: { count: 1, spawn: 0, hp: 0.5, variation: 0.5 },
      why: { candidates: 1, lastRanWavesAgo: null, history: 0, tied: 1, ramp: 1 },
    };
    return { template: TEMPLATES[index], config: buildWaveConfig(decision, state, buildWaveContext(state).candidateReason, gate) };
  }

  it('keeps golems at their floor and a wave of them inside three minutes', () => {
    const { config } = build('golem_squad');
    expect(config.spawnDelay).toBe(spawnFloorMs('stone-golem'));
    expect(config.totalCount * config.spawnDelay).toBeLessThanOrEqual(MAX_WAVE_DURATION_MS);
  });

  it('sends fewer of a swarm that does not fit, with the health of the whole wave kept', () => {
    const { template, config } = build('zombie_horde');
    expect(config.totalCount).toBe(Math.floor(MAX_WAVE_DURATION_MS / config.spawnDelay));
    expect(config.totalCount).toBeLessThan(template.countRange[1]);
    // Tougher than the template's plain range allows: the health of the cut enemies went into the rest
    expect(config.templateStrength).toBeGreaterThan(template.hpMultRange[1]);
  });
});
