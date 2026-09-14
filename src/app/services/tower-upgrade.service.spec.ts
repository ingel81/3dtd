import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// Only their DI tokens are needed
vi.mock('./facade/tower-defense-facade.service', () => ({
  TowerDefenseFacadeService: class TowerDefenseFacadeService {},
}));
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TowerUpgradeService } from './tower-upgrade.service';
import { UpgradeHintService } from './upgrade-hint.service';
import { TowerDefenseFacadeService } from './facade/tower-defense-facade.service';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { ResearchStore } from '../store/research.store';
import { requiredUpgradeTier, type UpgradeId } from '../configs/tower-types.config';
import type { Tower } from '../entities/tower.entity';

const GOLD = '#D9BC68';
const ORANGE = '#C96A3A';

describe('TowerUpgradeService', () => {
  const lockedLevel = Array.from({ length: 40 }, (_, l) => l).find((l) => requiredUpgradeTier(l) > 1)!;
  const credits = signal(0);
  const maxUpgradeTier = signal(1);

  /** Level per track; facade.upgradeTower raises it like the real command */
  let levels: Record<string, number>;
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
      upgrades: [{ id: 'damage', name: 'Damage' }, { id: 'speed', name: 'Speed' }, { id: 'range', name: 'Range' }],
    },
    getAvailableUpgrades: () => [{ id: 'damage' as UpgradeId }, { id: 'speed' as UpgradeId }],
    getNextUpgradeCost: (id: UpgradeId) => (id === 'damage' ? 500 : 30),
    getUpgradeLevel: (id: UpgradeId) => levels[id] ?? 0,
  } as unknown as Tower;

  beforeEach(() => {
    credits.set(0);
    maxUpgradeTier.set(1);
    levels = {};
    upgradeTower = vi.fn((_t: unknown, id: UpgradeId) => {
      levels[id] = (levels[id] ?? 0) + 1;
      return true;
    });
    spawnFloatingText = vi.fn();
    upgradeHint = new UpgradeHintService();
    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseFacadeService, useValue: { upgradeTower } },
        { provide: GameStateManager, useValue: { tilesEngine: { effects: { spawnFloatingText } } } },
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

    it('answers nothing when the command refuses the purchase', () => {
      credits.set(1000);
      upgradeTower.mockReturnValue(false);
      expect(service.buy(tower, 'damage')).toBe(false);
      expect(spawnFloatingText).not.toHaveBeenCalled();
      expect(upgradeHint.hint()).toBeNull();
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
