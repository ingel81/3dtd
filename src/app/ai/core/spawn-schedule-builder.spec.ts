import { describe, it, expect } from 'vitest';
import {
  buildSpawnSchedule,
  ALL_SPAWN_PATTERNS,
  DEFAULT_SPAWN_PATTERN,
  ScheduleBuildConfig,
  SpawnPattern,
} from './spawn-schedule-builder';
import { WaveEnemyGroup } from './models/wave-config';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function cfg(
  groups: WaveEnemyGroup[],
  pattern: SpawnPattern,
  extras: Partial<ScheduleBuildConfig> = {},
): ScheduleBuildConfig {
  return { groups, pattern, baseDelay: 1000, ...extras };
}

const zombieGroup = (count: number): WaveEnemyGroup => ({ type: 'zombie', count });
const tankGroup = (count: number): WaveEnemyGroup => ({ type: 'tank', count });

// ----------------------------------------------------------------
// Constants / metadata
// ----------------------------------------------------------------
describe('spawn-schedule-builder constants', () => {
  it('ALL_SPAWN_PATTERNS has 7 entries', () => {
    expect(ALL_SPAWN_PATTERNS).toHaveLength(7);
  });

  it('DEFAULT_SPAWN_PATTERN is "interleaved"', () => {
    expect(DEFAULT_SPAWN_PATTERN).toBe('interleaved');
  });
});

// ----------------------------------------------------------------
// Empty / degenerate inputs
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — empty groups', () => {
  it('all-zero counts → empty entries, baseDelay preserved', () => {
    const schedule = buildSpawnSchedule(cfg([{ type: 'zombie', count: 0 }], 'sequential'));
    expect(schedule.entries).toHaveLength(0);
    expect(schedule.baseDelay).toBe(1000);
  });

  it('empty groups array → empty schedule', () => {
    const schedule = buildSpawnSchedule(cfg([], 'interleaved'));
    expect(schedule.entries).toHaveLength(0);
  });

  it('mix of zero and non-zero counts ignores the zero group', () => {
    const schedule = buildSpawnSchedule(
      cfg([{ type: 'zombie', count: 0 }, { type: 'tank', count: 3 }], 'sequential'),
    );
    expect(schedule.entries).toHaveLength(3);
    for (const e of schedule.entries) {
      expect(e.enemyType).toBe('tank');
    }
  });
});

// ----------------------------------------------------------------
// Entry structure sanity
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — entry field correctness', () => {
  it('entries carry enemyType from the group', () => {
    const schedule = buildSpawnSchedule(cfg([zombieGroup(2)], 'sequential'));
    for (const entry of schedule.entries) {
      expect(entry.enemyType).toBe('zombie');
    }
  });

  it('entries carry correct speed (baseSpeed × speedMultiplier)', () => {
    const zombieBaseSpeed = ENEMY_TYPES['zombie'].baseSpeed; // 5
    const schedule = buildSpawnSchedule(
      cfg([{ type: 'zombie', count: 3, speedMultiplier: 2 }], 'sequential'),
    );
    for (const entry of schedule.entries) {
      expect(entry.speed).toBeCloseTo(zombieBaseSpeed * 2, 5);
    }
  });

  it('entries with healthMultiplier carry rounded health', () => {
    const zombieBaseHp = ENEMY_TYPES['zombie'].baseHp; // 80
    const schedule = buildSpawnSchedule(
      cfg([{ type: 'zombie', count: 2, healthMultiplier: 1.5 }], 'sequential'),
    );
    for (const entry of schedule.entries) {
      expect(entry.health).toBe(Math.round(zombieBaseHp * 1.5));
    }
  });

  it('entries without healthMultiplier have health === undefined', () => {
    const schedule = buildSpawnSchedule(cfg([zombieGroup(3)], 'sequential'));
    for (const entry of schedule.entries) {
      expect(entry.health).toBeUndefined();
    }
  });

  it('baseDelay is preserved in the returned schedule', () => {
    const schedule = buildSpawnSchedule(cfg([zombieGroup(1)], 'sequential', { baseDelay: 500 }));
    expect(schedule.baseDelay).toBe(500);
  });

  it('without delayVariation, getDelay is undefined', () => {
    const schedule = buildSpawnSchedule(cfg([zombieGroup(1)], 'sequential'));
    expect(schedule.getDelay).toBeUndefined();
  });

  it('with delayVariation > 0, getDelay is a function', () => {
    const schedule = buildSpawnSchedule(cfg([zombieGroup(1)], 'sequential', { delayVariation: 0.2 }));
    expect(typeof schedule.getDelay).toBe('function');
  });

  it('getDelay stays within the variation range', () => {
    const base = 1000;
    const variation = 0.3;
    const schedule = buildSpawnSchedule(cfg([zombieGroup(1)], 'sequential', { baseDelay: base, delayVariation: variation }));
    const delays: number[] = [];
    for (let i = 0; i < 200; i++) {
      delays.push(schedule.getDelay!());
    }
    const min = base * (1 - variation);
    const max = base * (1 + variation);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(Math.floor(min));
      expect(d).toBeLessThanOrEqual(Math.ceil(max));
    }
  });
});

// ----------------------------------------------------------------
// Pattern: sequential
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — sequential pattern', () => {
  it('AAAA BBBB: all of group A first, then all of group B', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(3), tankGroup(2)], 'sequential'),
    );
    expect(schedule.entries).toHaveLength(5);
    const types = schedule.entries.map(e => e.enemyType);
    expect(types).toEqual(['zombie', 'zombie', 'zombie', 'tank', 'tank']);
  });

  it('total entries = sum of all group counts', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(4), tankGroup(3)], 'sequential'),
    );
    expect(schedule.entries).toHaveLength(7);
  });
});

// ----------------------------------------------------------------
// Pattern: interleaved
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — interleaved pattern', () => {
  it('ABABAB: entries alternate between two equal groups', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(3), tankGroup(3)], 'interleaved'),
    );
    expect(schedule.entries).toHaveLength(6);
    const types = schedule.entries.map(e => e.enemyType);
    expect(types).toEqual(['zombie', 'tank', 'zombie', 'tank', 'zombie', 'tank']);
  });

  it('unequal groups: smaller group exhausted first, remainder from larger group', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(4), tankGroup(2)], 'interleaved'),
    );
    // Round 1: Z T, Round 2: Z T, Round 3: Z (tank exhausted), Round 4: Z
    const types = schedule.entries.map(e => e.enemyType);
    expect(types).toEqual(['zombie', 'tank', 'zombie', 'tank', 'zombie', 'zombie']);
  });

  it('total entries = sum of all group counts', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(5), tankGroup(3)], 'interleaved'),
    );
    expect(schedule.entries).toHaveLength(8);
  });
});

// ----------------------------------------------------------------
// Pattern: clustered
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — clustered pattern', () => {
  it('default clusterSize=3: AAA BBB AAA BBB for two equal groups', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(6), tankGroup(6)], 'clustered'),
    );
    const types = schedule.entries.map(e => e.enemyType);
    // First rotation: 3 zombie, 3 tank; second: 3 zombie, 3 tank
    expect(types).toEqual([
      'zombie', 'zombie', 'zombie',
      'tank', 'tank', 'tank',
      'zombie', 'zombie', 'zombie',
      'tank', 'tank', 'tank',
    ]);
  });

  it('custom clusterSize=2 produces pairs', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(4), tankGroup(4)], 'clustered', { clusterSize: 2 }),
    );
    const types = schedule.entries.map(e => e.enemyType);
    expect(types).toEqual([
      'zombie', 'zombie',
      'tank', 'tank',
      'zombie', 'zombie',
      'tank', 'tank',
    ]);
  });

  it('total count is preserved', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(5), tankGroup(4)], 'clustered'),
    );
    expect(schedule.entries).toHaveLength(9);
  });
});

// ----------------------------------------------------------------
// Pattern: front-loaded (strongest HP first)
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — front-loaded pattern', () => {
  it('puts highest base-HP enemies first (tank > zombie by default)', () => {
    // tank baseHp=250, zombie baseHp=80
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(2), tankGroup(2)], 'front-loaded'),
    );
    const types = schedule.entries.map(e => e.enemyType);
    // All tanks first (higher HP), then zombies
    expect(types).toEqual(['tank', 'tank', 'zombie', 'zombie']);
  });

  it('respects healthMultiplier when sorting', () => {
    // boosted zombie: 80 × 10 = 800 HP > tank 250 HP
    const schedule = buildSpawnSchedule(
      cfg(
        [
          { type: 'zombie', count: 2, healthMultiplier: 10 },
          tankGroup(2),
        ],
        'front-loaded',
      ),
    );
    const types = schedule.entries.map(e => e.enemyType);
    expect(types).toEqual(['zombie', 'zombie', 'tank', 'tank']);
  });
});

// ----------------------------------------------------------------
// Pattern: back-loaded (weakest HP first)
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — back-loaded pattern', () => {
  it('puts lowest base-HP enemies first (zombie < tank)', () => {
    const schedule = buildSpawnSchedule(
      cfg([tankGroup(2), zombieGroup(2)], 'back-loaded'),
    );
    const types = schedule.entries.map(e => e.enemyType);
    expect(types).toEqual(['zombie', 'zombie', 'tank', 'tank']);
  });
});

// ----------------------------------------------------------------
// Pattern: wave-in-wave
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — wave-in-wave pattern', () => {
  it('last entry of each group (except final) has pauseAfter set', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(3), tankGroup(2)], 'wave-in-wave', { subWavePause: 3000 }),
    );
    // 3 zombies, then 2 tanks
    // zombie[2] (last zombie) should have pauseAfter=3000
    // tank[1] (last tank, also last group) should NOT have pauseAfter
    expect(schedule.entries).toHaveLength(5);
    expect(schedule.entries[2].pauseAfter).toBe(3000);  // last of group 1
    expect(schedule.entries[4].pauseAfter).toBeUndefined(); // last of last group
  });

  it('intermediate group entries (not last) do not have pauseAfter', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(3), tankGroup(2)], 'wave-in-wave'),
    );
    // entries 0, 1 are not last of a group → no pauseAfter
    expect(schedule.entries[0].pauseAfter).toBeUndefined();
    expect(schedule.entries[1].pauseAfter).toBeUndefined();
  });

  it('default subWavePause is 3000ms', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(2), tankGroup(2)], 'wave-in-wave'),
    );
    // Last entry of group 1 (index 1)
    expect(schedule.entries[1].pauseAfter).toBe(3000);
  });

  it('total entry count equals sum of all groups', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(3), tankGroup(3), zombieGroup(2)], 'wave-in-wave'),
    );
    expect(schedule.entries).toHaveLength(8);
  });

  it('single group produces no pauseAfter on any entry', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(4)], 'wave-in-wave'),
    );
    for (const entry of schedule.entries) {
      expect(entry.pauseAfter).toBeUndefined();
    }
  });
});

// ----------------------------------------------------------------
// Pattern: random
// ----------------------------------------------------------------
describe('buildSpawnSchedule() — random pattern', () => {
  it('produces same total count as input groups', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(5), tankGroup(5)], 'random'),
    );
    expect(schedule.entries).toHaveLength(10);
  });

  it('contains all enemy types from input (not losing any)', () => {
    const schedule = buildSpawnSchedule(
      cfg([zombieGroup(4), tankGroup(3)], 'random'),
    );
    const zombies = schedule.entries.filter(e => e.enemyType === 'zombie').length;
    const tanks = schedule.entries.filter(e => e.enemyType === 'tank').length;
    expect(zombies).toBe(4);
    expect(tanks).toBe(3);
  });
});
