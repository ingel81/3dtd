import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TD_THEME } from '../styles/td-theme';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// Only their DI tokens are needed
vi.mock('../sim/client/sim-client.service', () => ({ SimClient: class SimClient {} }));
vi.mock('./infrastructure/engine-initialization.service', () => ({
  EngineInitializationService: class EngineInitializationService {},
}));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TowerUpgradeService } from './tower-upgrade.service';
import { UpgradeHintService } from './upgrade-hint.service';
import { SimClient } from '../sim/client/sim-client.service';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { ResearchStore } from '../store/research.store';
import { requiredUpgradeTier, type UpgradeId } from '../configs/tower-types.config';
import type { Tower } from '../entities/tower.entity';

const GOLD = TD_THEME.brassLight;
const ORANGE = '#C96A3A';

describe('TowerUpgradeService', () => {
  const lockedLevel = Array.from({ length: 40 }, (_, l) => l).find((l) => requiredUpgradeTier(l) > 1)!;
  const credits = signal(0);
  const maxUpgradeTier = signal(1);

  /** Level per track of the shadow tower; a command acts at the next tick, so it stays */
  let levels: Record<string, number>;
  /** command:upgrade-tower on the bus, as (tower, upgradeId) */
  let upgradeTower: ReturnType<typeof vi.fn>;
  let spawnFloatingText: ReturnType<typeof vi.fn>;
  let upgradeHint: UpgradeHintService;
  let service: TowerUpgradeService;

  /** Damage costs 500, speed 30; range is at its last level, so no tile shows it */
  const tower = {
    id: 't1',
    position: { lat: 48.7, lon: 9.1, height: 300 },
    typeConfig: {
      shootHeight: 2,
      upgrades: [
        { id: 'damage', name: 'Damage', cost: 500, maxLevel: 40 },
        { id: 'speed', name: 'Speed', cost: 30, maxLevel: 40 },
        { id: 'range', name: 'Range', cost: 30, maxLevel: 0 },
      ],
    },
    getAvailableUpgrades: () => [{ id: 'damage' as UpgradeId }, { id: 'speed' as UpgradeId }],
    getNextUpgradeCost: (id: UpgradeId) => (id === 'damage' ? 500 : 30),
    getUpgradeLevel: (id: UpgradeId) => levels[id] ?? 0,
  } as unknown as Tower;

  beforeEach(() => {
    credits.set(0);
    maxUpgradeTier.set(1);
    levels = {};
    upgradeTower = vi.fn();
    spawnFloatingText = vi.fn();
    upgradeHint = new UpgradeHintService();
    const injector = Injector.create({
      providers: [
        {
          provide: SimClient,
          useValue: { bus: { emit: (e: { towerId: string; upgradeId: UpgradeId }) => (upgradeTower as unknown as (t: unknown, id: UpgradeId) => void)(e.towerId === tower.id ? tower : e.towerId, e.upgradeId) } },
        },
        { provide: EngineInitializationService, useValue: { getEngine: () => ({ effects: { spawnFloatingText } }) } },
        { provide: TowerDefenseStore, useValue: { credits } },
        { provide: ResearchStore, useValue: { maxUpgradeTier } },
        { provide: UpgradeHintService, useValue: upgradeHint },
      ],
    });
    service = runInInjectionContext(injector, () => new TowerUpgradeService());
  });

  describe('a click on a tile', () => {
    it('buys that track, raises it and its new level over the tower and flashes the tile', () => {
      credits.set(1000);
      expect(service.buy(tower, 'damage')).toBe(true);
      expect(upgradeTower).toHaveBeenCalledWith(tower, 'damage');
      expect(spawnFloatingText).toHaveBeenCalledWith(
        'DAMAGE LV 1', 48.7, 9.1, 305, expect.objectContaining({ color: GOLD }),
      );
      expect(upgradeHint.hint()).toMatchObject({ towerId: 't1', upgradeId: 'damage', refusal: null });
    });

    it('buys nothing on a tile the credits do not reach and names what that track lacks', () => {
      // U would buy Speed here; the click asked for Damage
      credits.set(100);
      expect(service.buy(tower, 'damage')).toBe(false);
      expect(upgradeTower).not.toHaveBeenCalled();
      expect(spawnFloatingText).toHaveBeenCalledWith(
        'NEED 400 CREDITS', 48.7, 9.1, 305, expect.objectContaining({ color: ORANGE }),
      );
      expect(upgradeHint.hint()).toMatchObject({
        towerId: 't1',
        upgradeId: null,
        refusal: { kind: 'credits', upgradeId: 'damage', missing: 400 },
      });
    });

    it('buys nothing on a tier-locked tile and says it needs research', () => {
      credits.set(10_000);
      levels['damage'] = lockedLevel;
      expect(service.buy(tower, 'damage')).toBe(false);
      expect(upgradeTower).not.toHaveBeenCalled();
      expect(spawnFloatingText).toHaveBeenCalledWith(
        'NEEDS RESEARCH', 48.7, 9.1, 305, expect.objectContaining({ color: ORANGE }),
      );
      expect(upgradeHint.hint()?.refusal).toEqual({ kind: 'tier', tier: requiredUpgradeTier(lockedLevel) });
    });

    it('buys nothing on a track at its last level and says so', () => {
      credits.set(10_000);
      expect(service.buy(tower, 'range')).toBe(false);
      expect(upgradeTower).not.toHaveBeenCalled();
      expect(spawnFloatingText).toHaveBeenCalledWith(
        'FULLY UPGRADED', 48.7, 9.1, 305, expect.objectContaining({ color: ORANGE }),
      );
      expect(upgradeHint.hint()?.refusal).toEqual({ kind: 'maxed' });
    });

  });

  describe('several at once (TODO E45)', () => {
    it('buys a track as often as asked while the credits last, one command each', () => {
      credits.set(100);
      expect(service.buy(tower, 'speed', 5)).toBe(true);
      expect(upgradeTower).toHaveBeenCalledTimes(3);
      expect(spawnFloatingText).toHaveBeenCalledWith(
        'SPEED +3', 48.7, 9.1, 305, expect.objectContaining({ color: GOLD }),
      );
    });

    it('lets U buy the first affordable track up to ten times, the next track once one locks', () => {
      credits.set(100_000);
      expect(service.buyFirst(tower, 10)).toBe(true);
      const bought = upgradeTower.mock.calls.map(([, id]) => id);
      // Damage up to its tier lock, then Speed
      expect(bought).toEqual([
        ...Array<UpgradeId>(lockedLevel).fill('damage'),
        ...Array<UpgradeId>(10 - lockedLevel).fill('speed'),
      ]);
      expect(spawnFloatingText.mock.calls[0][0]).toBe('10 UPGRADES');
    });
  });

  it('answers a click and U on the same track alike', () => {
    credits.set(100);
    expect(service.buyFirst(tower)).toBe(true);
    const keyHint = upgradeHint.hint();
    levels = {};
    expect(service.buy(tower, 'speed')).toBe(true);
    expect(spawnFloatingText.mock.calls[1]).toEqual(spawnFloatingText.mock.calls[0]);
    expect(spawnFloatingText.mock.calls[0][0]).toBe('SPEED LV 1');
    expect(upgradeHint.hint()).toMatchObject({ ...keyHint, seq: keyHint!.seq + 1 });
  });
});
