import { describe, it, expect, vi, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { expectedArmorDistribution, playerState, researchSnapshot, type ResearchReader } from './state-snapshot-parts';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';

const zeroes = { unarmored: 0, light: 0, heavy: 0, fortified: 0, ethereal: 0 };

describe('state snapshot parts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('describes the player against the start health', () => {
    expect(playerState(60, 250)).toEqual({ credits: 250, lives: 60, maxLives: 100, livesPercent: 0.6 });
  });

  it('reads the research state and the tower unlocks', () => {
    const research = {
      completedResearches: signal(new Set(['gatling-tech'])),
      activeResearches: signal([{ researchId: 'cannon-tech' }]),
      centerLevel: signal(2),
      researchSlots: signal(3),
      airTargetingUnlocked: signal(true),
      maxUpgradeTier: signal(2),
      isTowerUnlocked: (id: string) => id === 'archer',
    } as unknown as ResearchReader;

    const snap = researchSnapshot(research);

    expect(snap).toMatchObject({
      completedIds: ['gatling-tech'],
      completedCount: 1,
      totalCount: Object.keys(RESEARCH_TREE).length,
      activeIds: ['cannon-tech'],
      centerLevel: 2,
      slotsUsed: 1,
      maxSlots: 3,
      airTargetingUnlocked: true,
      maxUpgradeTier: 2,
    });
    expect(Object.keys(snap.towerUnlocked).sort()).toEqual(Object.keys(TOWER_TYPES).sort());
  });

  describe('expectedArmorDistribution', () => {
    it('weights the running wave by enemy count', () => {
      const running = { enemies: [{ type: 'zombie', count: 3 }, { type: 'tank', count: 1 }], totalCount: 4, spawnDelay: 500 };
      expect(expectedArmorDistribution(running, 99)).toEqual({ ...zeroes, unarmored: 0.75, heavy: 0.25 });
    });

    it('falls back to the curriculum template of the next wave', () => {
      expect(expectedArmorDistribution(null, 1)).toEqual({ ...zeroes, unarmored: 1 });
      expect(expectedArmorDistribution({ enemies: [], totalCount: 0, spawnDelay: 500 }, 1))
        .toEqual({ ...zeroes, unarmored: 1 });
    });

    it('is undefined past the curriculum with no wave running', () => {
      expect(expectedArmorDistribution(null, 31)).toBeUndefined();
    });
  });
});
