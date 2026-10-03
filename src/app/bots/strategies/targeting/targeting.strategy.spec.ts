import { describe, expect, it } from 'vitest';
import { TOWER_TYPES, TowerTypeId } from '../../../configs/tower-types.config';
import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import type { WavePeekFacts } from '../../../director/wave-source';
import { TargetingStrategy } from './targeting.strategy';

function tower(id: string, typeId: TowerTypeId, damageLevel = 0) {
  const typeConfig = TOWER_TYPES[typeId];
  return {
    id,
    typeConfig,
    targetingStrategy: typeConfig.defaultTargeting ?? 'closest',
    getUpgradeLevel: (u: string) => (u === 'damage' ? damageLevel : 0),
  };
}

function wave(facts: Partial<WavePeekFacts>): WavePeekFacts {
  return {
    wave: 5, name: '', known: true, boss: false, air: false, armors: [], count: null, note: '', description: '',
    enemies: [['zombie', 1]], hpByArmor: [['unarmored', 1000]], ...facts,
  };
}

const state = { phase: 'setup', waveNumber: 4, research: { airTargetingUnlocked: false } } as unknown as GameStateSnapshot;

function strategy(towers: ReturnType<typeof tower>[], facts: WavePeekFacts) {
  const world = { towerManager: { getAll: () => towers }, peekWaves: () => [facts] };
  return new TargetingStrategy(world as never);
}

describe('TargetingStrategy', () => {
  it('leaves every tower at its default for an ordinary wave', () => {
    expect(strategy([tower('a', 'archer'), tower('c', 'cannon')], wave({})).canExecute(state)).toBe(false);
  });

  it('turns the strongest single-target towers on a boss, one tower per decision', () => {
    const towers = [tower('weak', 'archer'), tower('s1', 'archer', 5), tower('s2', 'archer', 4), tower('s3', 'archer', 3)];
    const s = strategy(towers, wave({ boss: true }));
    expect(s.execute(state)).toEqual(expect.objectContaining({ type: 'set-targeting', towerId: 's1', targeting: 'highest-hp' }));
    for (const t of towers.slice(1)) t.targetingStrategy = 'highest-hp';
    expect(s.canExecute(state)).toBe(false);
    expect(towers[0].targetingStrategy).toBe(TOWER_TYPES.archer.defaultTargeting ?? 'closest');
  });

  it('aims the strongest third of the towers that hit both at air first when the wave brings its HP by air', () => {
    const bats = wave({ enemies: [['bat', 1]], hpByArmor: [['light', 1000]] });
    const towers = [tower('c', 'cannon'), tower('a1', 'archer'), tower('a2', 'archer', 5), tower('a3', 'archer')];
    const s = strategy(towers, bats);
    // The cannon hits no air; of the three archers only the strongest turns
    expect(s.execute(state)).toEqual(expect.objectContaining({ towerId: 'a2', targeting: 'air-priority' }));
    towers[2].targetingStrategy = 'air-priority';
    expect(s.canExecute(state)).toBe(false);
  });

  it('leaves the aim alone while a wave runs', () => {
    expect(strategy([tower('a', 'archer', 5)], wave({ boss: true })).canExecute({ ...state, phase: 'wave' } as GameStateSnapshot)).toBe(false);
  });

  it('turns at most three towers on a boss', () => {
    const towers = Array.from({ length: 9 }, (_, i) => tower(`a${i}`, 'archer', i));
    const s = strategy(towers, wave({ boss: true }));
    let changes = 0;
    while (s.canExecute(state)) {
      const action = s.execute(state)!;
      towers.find((t) => t.id === action.towerId)!.targetingStrategy = action.targeting!;
      changes++;
    }
    expect(changes).toBe(3);
  });

  it('turns a tower back to its default once the wave no longer calls for more', () => {
    const turned = { ...tower('a', 'archer'), targetingStrategy: 'air-priority' as const };
    expect(strategy([turned], wave({})).execute(state)).toEqual(expect.objectContaining({ towerId: 'a', targeting: TOWER_TYPES.archer.defaultTargeting ?? 'closest' }));
  });
});
