import { describe, it, expect } from 'vitest';
import { enemyGroupTooltip, towerCardTooltip, TowerCardTooltipContext } from './sidebar-tooltips';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { EFFECTIVENESS_THRESHOLDS } from '../../configs/combat/damage-matrix.config';
import { EnemyTypeId } from '../../configs/enemy-types.config';
import type { WaveGroupDisplay } from '../../services/debug/wave-debug.service';

const noResearch: TowerCardTooltipContext = { alreadyPlaced: false, airTargetingUnlocked: false };
const aaUnlocked: TowerCardTooltipContext = { alreadyPlaced: true, airTargetingUnlocked: true };

function group(enemyType: EnemyTypeId, overrides: Partial<WaveGroupDisplay> = {}): WaveGroupDisplay {
  return {
    enemyType,
    name: 'Zombie',
    count: 12,
    baseHp: 100,
    actualHp: 100,
    baseSpeed: 2,
    actualSpeed: 2,
    healthMultiplier: 1,
    speedMultiplier: 1,
    spawnDelay: 500,
    ...overrides,
  };
}

describe('towerCardTooltip', () => {
  it('describes the research center as a structure and says when it stands', () => {
    expect(towerCardTooltip(TOWER_TYPES['research-center'], noResearch)).toEqual({
      title: 'Research Center',
      category: 'STRUCTURE',
      accent: 'gold',
      flavor: 'Unlocks new towers and upgrade tiers.',
    });
    expect(towerCardTooltip(TOWER_TYPES['research-center'], aaUnlocked).flavor).toBe('Already placed.');
  });

  it('shows damage, rate and range for a projectile tower', () => {
    const tip = towerCardTooltip(TOWER_TYPES.archer, noResearch);
    expect(tip.title).toBe(TOWER_TYPES.archer.name);
    expect(tip.category).toBe('PHYSICAL');
    expect(tip.accent).toBe('gold');
    expect(tip.stats).toEqual([
      { label: 'DMG', value: '25' },
      { label: 'RATE', value: '1/s' },
      { label: 'RANGE', value: '30m' },
    ]);
  });

  it('shows DPS for a beam tower', () => {
    const tip = towerCardTooltip(TOWER_TYPES.fire, noResearch);
    expect(tip.accent).toBe('fire');
    expect(tip.stats).toEqual([
      { label: 'DPS', value: '35' },
      { label: 'TYPE', value: 'BEAM' },
      { label: 'RANGE', value: '20m' },
    ]);
  });

  it('colours the header by damage type', () => {
    expect(towerCardTooltip(TOWER_TYPES.ice, noResearch).accent).toBe('cold');
    expect(towerCardTooltip(TOWER_TYPES.lightning, noResearch).accent).toBe('lightning');
    expect(towerCardTooltip(TOWER_TYPES.chaos, noResearch).accent).toBe('chaos');
  });

  it('lists all armor types and dims the weak ones', () => {
    // physical: 1.00 / 1.00 / 0.50 / 0.30 / 0.10, weak below 0.6
    const rows = towerCardTooltip(TOWER_TYPES.archer, noResearch).armor ?? [];
    expect(rows.map((r) => r.multiplier)).toEqual(['1.00×', '1.00×', '0.50×', '0.30×', '0.10×']);
    expect(rows.map((r) => r.dim)).toEqual([false, false, true, true, true]);
    expect(rows[0]).toMatchObject({ label: 'Unarmored', color: '#7DBE82' });
  });

  it('reads the targeting banner from the effective air capability', () => {
    expect(towerCardTooltip(TOWER_TYPES.rocket, noResearch).targeting).toEqual({ mode: 'air-only' });
    expect(towerCardTooltip(TOWER_TYPES.archer, noResearch).targeting)
      .toEqual({ mode: 'air-ground', viaResearch: false });
    expect(towerCardTooltip(TOWER_TYPES.cannon, aaUnlocked).targeting).toEqual({ mode: 'ground-only' });
  });

  it('flips the gatling to air and ground once AA retrofit is researched', () => {
    const gatling = TOWER_TYPES['dual-gatling'];
    expect(towerCardTooltip(gatling, noResearch).targeting).toEqual({ mode: 'ground-only' });
    expect(towerCardTooltip(gatling, aaUnlocked).targeting).toEqual({ mode: 'air-ground', viaResearch: true });
  });
});

describe('enemyGroupTooltip', () => {
  it('returns null for an unknown enemy type', () => {
    expect(enemyGroupTooltip(group('nope' as EnemyTypeId))).toBeNull();
  });

  it('heads with the armor class and shows hp, speed and count', () => {
    const tip = enemyGroupTooltip(group('zombie', { actualHp: 150, actualSpeed: 2.25 }));
    expect(tip).toMatchObject({ title: 'Zombie', category: 'UNARMORED', accent: 'neutral', armorTitle: 'vs Damage' });
    expect(tip?.stats).toEqual([
      { label: 'HP', value: '150' },
      { label: 'SPEED', value: '2.3m/s' },
      { label: 'COUNT', value: '×12' },
    ]);
  });

  it('sorts the damage types from most to least effective', () => {
    // unarmored: fire 1.5 vor poison 1.4 vor pierce 1.25, siege 0.5 zuletzt
    const rows = enemyGroupTooltip(group('zombie'))?.armor ?? [];
    expect(rows.slice(0, 3).map((r) => r.label)).toEqual(['Fire', 'Poison', 'Pierce']);
    expect(rows[rows.length - 1]).toMatchObject({ label: 'Siege', multiplier: '0.50×', dim: true });
    const muls = rows.map((r) => parseFloat(r.multiplier));
    expect(muls).toEqual([...muls].sort((a, b) => b - a));
  });

  it('dims damage types below the weak threshold', () => {
    // ethereal: physical, pierce und fire bei 0.1
    const rows = enemyGroupTooltip(group('ghost'))?.armor ?? [];
    expect(rows.filter((r) => r.dim).map((r) => r.multiplier)).toContain('0.10×');
    expect(rows.every((r) => r.dim === parseFloat(r.multiplier) < EFFECTIVENESS_THRESHOLDS.weak)).toBe(true);
  });

  it('names the wave scaling only when it differs from 1', () => {
    expect(enemyGroupTooltip(group('zombie'))?.flavor).toBeUndefined();
    expect(enemyGroupTooltip(group('zombie', { healthMultiplier: 1.5 }))?.flavor).toBe('Scaled: HP ×1.5');
    expect(enemyGroupTooltip(group('zombie', { healthMultiplier: 2, speedMultiplier: 1.25 }))?.flavor)
      .toBe('Scaled: HP ×2.0 · Speed ×1.25');
  });

  it('names the split of a skeleton, before the scaling', () => {
    expect(enemyGroupTooltip(group('skeleton'))?.flavor).toBe('Splits into 2 minions on death');
    expect(enemyGroupTooltip(group('skeleton', { healthMultiplier: 0.5 }))?.flavor)
      .toBe('Splits into 2 minions on death. Scaled: HP ×0.5');
  });
});
