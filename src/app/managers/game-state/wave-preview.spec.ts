import { describe, it, expect } from 'vitest';
import { summarizeWaveGroups } from './wave-preview';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';

describe('summarizeWaveGroups', () => {
  it('is empty for an empty schedule', () => {
    expect(summarizeWaveGroups({ schedule: { entries: [], baseDelay: 100 } } as never)).toEqual([]);
  });

  it('groups by type in order of first appearance, with the first entry of a group', () => {
    const zombie = ENEMY_TYPES['zombie'];
    const bat = ENEMY_TYPES['bat'];
    const groups = summarizeWaveGroups({
      schedule: {
        baseDelay: 250,
        entries: [
          { enemyType: 'zombie', speed: zombie.baseSpeed * 2, health: zombie.baseHp * 3 },
          { enemyType: 'bat', speed: bat.baseSpeed },
          { enemyType: 'zombie', speed: 1, health: 1 },
        ],
      },
    } as never);

    expect(groups.map((g) => [g.enemyType, g.count])).toEqual([['zombie', 2], ['bat', 1]]);
    expect(groups[0]).toMatchObject({
      name: zombie.name,
      baseHp: zombie.baseHp,
      actualHp: zombie.baseHp * 3,
      actualSpeed: zombie.baseSpeed * 2,
      spawnDelay: 250,
    });
    expect(groups[0].healthMultiplier).toBeCloseTo(3);
    expect(groups[0].speedMultiplier).toBeCloseTo(2);
    // No HP override: the base HP
    expect(groups[1]).toMatchObject({ actualHp: bat.baseHp, healthMultiplier: 1 });
  });
});
