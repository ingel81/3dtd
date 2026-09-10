import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { analyzeDefense, isSplashTower } from './defense-analyzer';
import { Tower } from '../../entities/tower.entity';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';

const POS = { lat: 10, lon: 20, height: 0 };

describe('isSplashTower()', () => {
  it('matches what the game actually does', () => {
    const splash: TowerTypeId[] = ['cannon', 'ice', 'poison', 'fire', 'lightning'];
    const single: TowerTypeId[] = ['archer', 'dual-gatling', 'magic', 'rocket', 'tentacle', 'research-center'];
    for (const id of splash) expect(isSplashTower(id), id).toBe(true);
    for (const id of single) expect(isSplashTower(id), id).toBe(false);
  });
});

describe('analyzeDefense() kill throughput', () => {
  it('counts a rocket as one target per shot, it has no splash', () => {
    const rocket = new Tower(POS, 'rocket');
    const { killThroughput } = analyzeDefense([rocket], false);
    expect(killThroughput.air).toBeCloseTo(TOWER_TYPES.rocket.fireRate, 6);
    expect(killThroughput.ground).toBe(0);
  });

  it('counts ice and poison splash', () => {
    const analysis = analyzeDefense([new Tower(POS, 'ice'), new Tower(POS, 'poison')], false);
    expect(analysis.capabilities.hasSplash).toBe(true);
    expect(analysis.aoeDpsShare.ground).toBe(1);
    expect(analysis.killThroughput.ground).toBeGreaterThan(
      TOWER_TYPES.ice.fireRate + TOWER_TYPES.poison.fireRate,
    );
  });
});
