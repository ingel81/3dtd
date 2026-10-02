/**
 * Camouflaged enemies and the Scout path (TODO E100, E101): no tower picks a camouflaged enemy unless a built
 * scout has it within its detection radius, and then every tower does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestManagers, TEST_PATH, TEST_TOWER_NEAR_SPAWN, type TestManagers } from './test-helpers';
import { revealCamo } from '../managers/game-state/camo-reveal';
import type { Enemy } from '../entities/enemy.entity';
import type { Tower } from '../entities/tower.entity';
import { TOWER_PATHS } from '../configs/tower-paths.config';

describe('Camouflaged enemies and scouts', () => {
  let m: TestManagers;
  const scouts: Tower[] = [];

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const camoEnemy = (): Enemy => m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true, undefined, undefined, false, true);
  const archer = (): Tower => m.towerManager.placeTower(TEST_TOWER_NEAR_SPAWN, 'archer', 0)!;
  const reveal = (now = 0) => revealCamo(m.enemyManager.getAllActive(), m.towerManager.getAll(), now, scouts);

  it('is not picked by a tower while no scout sees it', () => {
    const tower = archer();
    const enemy = camoEnemy();
    reveal();
    expect(enemy.hidden).toBe(true);
    expect(tower.findTarget([enemy], false)).toBeNull();
  });

  it('is picked by every tower once a built scout has it in its detection radius', () => {
    const tower = archer();
    const scout = archer();
    scout.pathId = 'scout';
    const enemy = camoEnemy();
    reveal();
    expect(enemy.revealed).toBe(true);
    expect(tower.findTarget([enemy], false)).toBe(enemy);
  });

  it('stays hidden from a scout still in its scaffold, and beyond the detection radius', () => {
    const scout = archer();
    scout.pathId = 'scout';
    scout.builtAtMs = 5000;
    const enemy = camoEnemy();
    reveal(1000);
    expect(enemy.hidden).toBe(true);
    reveal(5000);
    expect(enemy.hidden).toBe(false);

    const radius = TOWER_PATHS.scout.detectionRadius!;
    expect(scout.distanceSqTo(enemy.position)).toBeLessThan(radius * radius);
  });

  it('is let go when the scouts lose it', () => {
    const tower = archer();
    const scout = archer();
    scout.pathId = 'scout';
    const enemy = camoEnemy();
    reveal();
    expect(tower.findTarget([enemy], false)).toBe(enemy);
    m.towerManager.sell(scout);
    reveal();
    expect(tower.findTarget([enemy], false)).toBeNull();
  });

  it('leaves an enemy without camouflage alone', () => {
    const plain = m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);
    reveal();
    expect(plain.camo).toBe(false);
    expect(plain.hidden).toBe(false);
  });
});
