import { describe, it, expect } from 'vitest';
import {
  BOSS_VARIANTS,
  BOSS_VARIANT_ROTATION,
  bossVariantForWave,
  bossVariantWave,
  type BossVariantId,
} from './boss-variants.config';
import { ENEMY_TYPES } from './enemy-types.config';
import { CURRICULUM_FORCED_THROUGH_WAVE, WAVE_CURRICULUM } from './wave-curriculum.config';
import { TEMPLATES } from '../ai/core/templates';
import { AI_ENEMY_ORDER } from '../ai/core/ai-schema';
import { adaptAIWaveConfig } from '../ai/core/wave-config-adapter';
import type { WaveConfig as AIWaveConfig } from '../ai/core/models/wave-config';

const variants = Object.values(BOSS_VARIANTS);

describe('bossVariantForWave', () => {
  it('leaves the curriculum and every wave that is no boss wave alone', () => {
    for (let wave = 1; wave <= CURRICULUM_FORCED_THROUGH_WAVE; wave++) expect(bossVariantForWave(wave)).toBeNull();
    for (const wave of [31, 34, 36, 39, 41, 99]) expect(bossVariantForWave(wave)).toBeNull();
  });

  it('gives W35 to the worm and follows the rotation over the boss waves after it', () => {
    expect(bossVariantForWave(35)?.id).toBe('worm');
    const waves = [35, 40, 45, 50, 55, 60, 65, 70];
    expect(waves.map((w) => bossVariantForWave(w)?.id ?? null)).toEqual(
      waves.map((_, i) => BOSS_VARIANT_ROTATION[i % BOSS_VARIANT_ROTATION.length]),
    );
    // The director keeps boss waves of its own
    expect(BOSS_VARIANT_ROTATION).toContain(null);
  });

  it('gives W45 to the ooze, between two worm waves', () => {
    expect([35, 40, 45, 50, 55].map((w) => bossVariantForWave(w)?.id ?? null))
      .toEqual(['worm', null, 'ooze', null, 'worm']);
  });

  it('names boss types that exist', () => {
    for (const id of Object.keys(BOSS_VARIANTS) as BossVariantId[]) {
      const variant = BOSS_VARIANTS[id];
      expect(variant.id).toBe(id);
      expect(ENEMY_TYPES[variant.enemyType]?.isBoss).toBe(true);
    }
  });

  it('keeps the variants out of the director: no template, no curriculum slot, not in the AI enemy order', () => {
    for (const { enemyType } of variants) {
      for (const t of TEMPLATES) expect(t.enemies.some(([id]) => id === enemyType), t.id).toBe(false);
      expect(AI_ENEMY_ORDER).not.toContain(enemyType);
    }
    expect(WAVE_CURRICULUM.length).toBe(CURRICULUM_FORCED_THROUGH_WAVE);
  });
});

describe('bossVariantWave', () => {
  const directed: AIWaveConfig = {
    enemies: [{ type: 'stone-golem', count: 24, healthMultiplier: 3.5 }],
    totalCount: 24,
    spawnDelay: 300,
    templateIdx: 20,
    templateName: 'Boss: Stone Golem',
    templateStrength: 3.5,
  };

  it('sends one worm with the HP the director planned for the wave', () => {
    const wave = bossVariantWave(BOSS_VARIANTS.worm, directed, 35);
    expect(wave).toMatchObject({
      enemies: [{ type: 'worm', count: 1, healthMultiplier: 3.5 }],
      totalCount: 1,
      templateName: 'Boss: Chitin Worm',
    });
    expect(wave.templateIdx).toBeUndefined();

    const entries = adaptAIWaveConfig(wave).schedule.entries;
    expect(entries).toHaveLength(1);
    // The schedule rounds each entry's HP
    expect(entries[0]).toMatchObject({ enemyType: 'worm', health: Math.round(ENEMY_TYPES['worm'].baseHp * 3.5) });
  });

  it('says why in place of the director explanation', () => {
    const { explanation } = bossVariantWave(BOSS_VARIANTS.worm, directed, 35);
    expect(explanation?.summary).toBe('W35: Boss: Chitin Worm, HP ×3.5');
    expect(explanation?.reasons[0]).toContain("in place of the director's Boss: Stone Golem");
  });
});
