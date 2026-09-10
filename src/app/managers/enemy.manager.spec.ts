import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return {
    ...mod,
  };
});

import { EnemyManager } from './enemy.manager';
import { GameEventBus } from '../game-engine';
import type { GeoPosition } from '../models/game.types';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import type { ThreeTilesEngine } from '../three-engine';
import { goldBudgetForWave } from '../configs/wave-curriculum.config';

const createMockTilesEngine = () => ({
  enemies: {
    create: vi.fn(() => Promise.resolve({})),
    startWalkAnimation: vi.fn(),
    playDeathAnimation: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    getSpeedMultiplier: vi.fn(() => 1),
    nonWalkingCount: 0,
    resolveSlot: vi.fn((_id: string): unknown => null),
    updateSlot: vi.fn(),
  },
  spatialAudio: null,
  sync: {
    getOrigin: vi.fn(() => ({ height: 0 })),
    geoToLocalSimple: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    geoToLocalSimpleInto: vi.fn((_lat: number, _lon: number, _h: number, target: unknown) => target),
  },
  getTerrainHeightAtGeo: vi.fn(() => 0),
});

const createGlobalRouteGrid = () => ({
  isInitialized: vi.fn(() => false),
  updateEnemyPosition: vi.fn(),
  removeEnemy: vi.fn(),
  getStats: vi.fn(() => ({ trackedEnemies: 0, occupiedCells: 0 })),
});

describe('EnemyManager', () => {
  let eventBus: GameEventBus;
  let tilesEngine: ReturnType<typeof createMockTilesEngine>;
  let globalRouteGrid: ReturnType<typeof createGlobalRouteGrid>;
  let manager: EnemyManager;

  beforeEach(() => {
    eventBus = new GameEventBus();
    tilesEngine = createMockTilesEngine();
    globalRouteGrid = createGlobalRouteGrid();
    manager = new EnemyManager(
      eventBus,
      globalRouteGrid as unknown as GlobalRouteGridService,
      new SpatialGridService()
    );
    manager.initialize(tilesEngine as unknown as ThreeTilesEngine);
  });

  it('spawns enemies with correct type and stats', () => {
    const spawnedSpy = vi.fn();
    eventBus.on('enemy:spawned', spawnedSpy);

    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 2 },
      { lat: 0.001, lon: 0, height: 2 },
    ];

    const enemy = manager.spawn(path, 'zombie');
    expect(enemy.typeConfig.id).toBe('zombie');
    expect(enemy.health.maxHp).toBe(enemy.typeConfig.baseHp);
    expect(manager.getAll()).toHaveLength(1);
    expect(manager.getAliveCount()).toBe(1);
    expect(spawnedSpy).toHaveBeenCalledWith(expect.objectContaining({ enemy }));
  });

  it('applies health override on spawn', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 2 },
      { lat: 0.001, lon: 0, height: 2 },
    ];

    const enemy = manager.spawn(path, 'zombie', undefined, false, 200);
    expect(enemy.health.maxHp).toBe(200);
    expect(enemy.health.hp).toBe(200);
  });

  it('kills enemy, emits event and removes immediately without death animation', () => {
    const diedSpy = vi.fn();
    eventBus.on('enemy:died', diedSpy);

    // Wire wave-context so the kill-budget accumulator pays out a real reward
    // (default providers return 0 → goldBudget 0 → credits 0).
    manager.setWaveNumberProvider(() => 1);
    manager.setWaveSizeProvider(() => 1);

    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy = manager.spawn(path, 'tank');
    manager.kill(enemy);

    expect(diedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        enemy,
      })
    );
    // Single-slot wave on W1 → the one paid kill picks up the full budget.
    const call = diedSpy.mock.calls[0][0];
    expect(call.credits).toBe(goldBudgetForWave(1).kill);
    expect(manager.getById(enemy.id)).toBeNull();
    expect(tilesEngine.enemies.remove).toHaveBeenCalledWith(enemy.id);
    expect(manager.getAliveCount()).toBe(0);
  });

  describe('kill-budget accumulator', () => {
    const straightPath: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const collectCredits = (): number[] => {
      const credits: number[] = [];
      eventBus.on('enemy:died', (ev) => credits.push(ev.credits ?? 0));
      return credits;
    };

    it('per-kill rewards sum exactly to the wave budget when every enemy dies', () => {
      manager.setWaveNumberProvider(() => 1);
      manager.setWaveSizeProvider(() => 10);
      const credits = collectCredits();

      for (let i = 0; i < 10; i++) {
        manager.kill(manager.spawn(straightPath, 'zombie'));
      }

      const sum = credits.reduce((a, b) => a + b, 0);
      expect(sum).toBe(goldBudgetForWave(1).kill);
    });

    it('handles mega-swarm without overshooting (W19 rat_tide regression)', () => {
      // The bug: Math.max(1, round(8000/5000)) × 5000 = 5000 (or 8000 with round=2)
      // capped at floor → still ≥ budget. Accumulator must clamp at exactly budget.
      manager.setWaveNumberProvider(() => 19);
      manager.setWaveSizeProvider(() => 5000);
      const credits = collectCredits();

      // Use a fraction of the wave (300 kills) — sum must stay ≤ proportional share
      for (let i = 0; i < 300; i++) {
        manager.kill(manager.spawn(straightPath, 'rat'));
      }

      const sum = credits.reduce((a, b) => a + b, 0);
      const budget = goldBudgetForWave(19).kill;
      const fairShare = Math.ceil((budget * 300) / 5000);
      expect(sum).toBeLessThanOrEqual(fairShare);
    });

    it('extra kills past expected wave size pay 0 gold', () => {
      manager.setWaveNumberProvider(() => 1);
      manager.setWaveSizeProvider(() => 3);
      const credits = collectCredits();

      for (let i = 0; i < 5; i++) {
        manager.kill(manager.spawn(straightPath, 'zombie'));
      }

      expect(credits[3]).toBe(0);
      expect(credits[4]).toBe(0);
      const sum = credits.reduce((a, b) => a + b, 0);
      expect(sum).toBe(goldBudgetForWave(1).kill);
    });

    it('wave change resets the accumulator', () => {
      let waveNum = 1;
      manager.setWaveNumberProvider(() => waveNum);
      manager.setWaveSizeProvider(() => 2);
      const credits = collectCredits();

      // Drain wave 1 completely
      manager.kill(manager.spawn(straightPath, 'zombie'));
      manager.kill(manager.spawn(straightPath, 'zombie'));
      const wave1Sum = credits.reduce((a, b) => a + b, 0);
      expect(wave1Sum).toBe(goldBudgetForWave(1).kill);

      // Switch to wave 2 — fresh budget regardless of wave-1 state
      waveNum = 2;
      credits.length = 0;
      manager.kill(manager.spawn(straightPath, 'zombie'));
      manager.kill(manager.spawn(straightPath, 'zombie'));
      const wave2Sum = credits.reduce((a, b) => a + b, 0);
      expect(wave2Sum).toBe(goldBudgetForWave(2).kill);
    });

    it('awardCredits=false does not consume slots from the budget', () => {
      manager.setWaveNumberProvider(() => 1);
      manager.setWaveSizeProvider(() => 3);
      const credits = collectCredits();

      // Debug-kill first — must not eat into the budget
      manager.kill(manager.spawn(straightPath, 'zombie'), false);

      // Three paid kills then drain the full wave-1 budget
      for (let i = 0; i < 3; i++) {
        manager.kill(manager.spawn(straightPath, 'zombie'));
      }

      expect(credits[0]).toBe(0);
      const paidSum = credits.slice(1).reduce((a, b) => a + b, 0);
      expect(paidSum).toBe(goldBudgetForWave(1).kill);
    });

    it('zero gold budget pays zero per kill', () => {
      // waveNum=0 returns { kill: 0, complete: 0 } from goldBudgetForWave
      manager.setWaveNumberProvider(() => 0);
      manager.setWaveSizeProvider(() => 5);
      const credits = collectCredits();

      for (let i = 0; i < 5; i++) {
        manager.kill(manager.spawn(straightPath, 'zombie'));
      }

      expect(credits.every((c) => c === 0)).toBe(true);
    });

    it('leaks reduce earned gold (uncollected kills = lost budget)', () => {
      manager.setWaveNumberProvider(() => 1);
      manager.setWaveSizeProvider(() => 4);
      const credits = collectCredits();

      // Only 2 of 4 enemies die — accumulator should pay out partial budget
      manager.kill(manager.spawn(straightPath, 'zombie'));
      manager.kill(manager.spawn(straightPath, 'zombie'));

      const earned = credits.reduce((a, b) => a + b, 0);
      const fullBudget = goldBudgetForWave(1).kill;
      expect(earned).toBeLessThan(fullBudget);
      expect(earned).toBeGreaterThanOrEqual(0);
    });
  });

  it('emits reached-base event and removes enemy when path ends', () => {
    const reachedSpy = vi.fn();
    eventBus.on('enemy:reached-base', reachedSpy);

    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy = manager.spawn(path, 'zombie');
    vi.spyOn(enemy.movement, 'move').mockReturnValue('reached_end');

    manager.update(16, 0); // gameTimeMs=0

    expect(reachedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        enemy,
        damage: expect.any(Number),
      })
    );
    expect(manager.getById(enemy.id)).toBeNull();
    expect(tilesEngine.enemies.remove).toHaveBeenCalledWith(enemy.id);
  });

  it('getAlive returns only living enemies', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy1 = manager.spawn(path, 'zombie');
    const enemy2 = manager.spawn(path, 'zombie');

    enemy1.health.takeDamage(enemy1.health.hp);

    const alive = manager.getAlive();
    expect(alive).toEqual([enemy2]);
  });

  it('removes expired status effects during update', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy = manager.spawn(path, 'zombie');
    const statusSpy = vi.spyOn(enemy.movement, 'updateStatusEffects');

    manager.update(16, 1234); // gameTimeMs=1234
    expect(statusSpy).toHaveBeenCalledWith(1234);
  });

  describe('hot-path shortcuts', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    it('alive follows health through the mirror', () => {
      const enemy = manager.spawn(path, 'zombie');
      enemy.health.takeDamage(enemy.health.hp);
      expect(enemy.alive).toBe(false);
      enemy.health.heal(1);
      expect(enemy.alive).toBe(true);
    });

    it('uses 1.0 without the per-id lookup while every instance walks', () => {
      const enemy = manager.spawn(path, 'wallsmasher');
      enemy.movement.speedMultiplier = 7; // must be overwritten
      manager.update(16, 16);

      expect(enemy.movement.speedMultiplier).toBe(1);
      expect(tilesEngine.enemies.getSpeedMultiplier).not.toHaveBeenCalled();
    });

    it('asks the renderer per enemy once an instance is not walking', () => {
      tilesEngine.enemies.nonWalkingCount = 1;
      tilesEngine.enemies.getSpeedMultiplier.mockReturnValue(2.5);
      const enemy = manager.spawn(path, 'wallsmasher');
      manager.update(16, 16);

      expect(tilesEngine.enemies.getSpeedMultiplier).toHaveBeenCalledWith(enemy.id);
      expect(enemy.movement.speedMultiplier).toBe(2.5);
    });

    it('ticks audio only for enemies that hold a loop handle', () => {
      const enemy = manager.spawn(path, 'zombie');
      const audioUpdate = vi.spyOn(enemy.audio, 'update');
      manager.update(16, 16);
      expect(audioUpdate).not.toHaveBeenCalled();

      enemy.hasAudioLoops = true; // what AudioComponent sets once a loop handle arrives
      manager.update(16, 32);
      expect(audioUpdate).toHaveBeenCalledTimes(1);
    });

    it('resolves the render slot once, and again after the renderer released it', () => {
      const slot = { released: false, config: { heightOffset: 0.5 } };
      tilesEngine.enemies.resolveSlot.mockReturnValue(slot);
      manager.spawn(path, 'zombie');

      manager.presentFrame(0);
      manager.presentFrame(16);
      expect(tilesEngine.enemies.resolveSlot).toHaveBeenCalledTimes(1);
      expect(tilesEngine.enemies.updateSlot).toHaveBeenCalledTimes(2);

      slot.released = true;
      manager.presentFrame(32);
      expect(tilesEngine.enemies.resolveSlot).toHaveBeenCalledTimes(2);
    });

    it('reports sampled phase timings scaled to the whole loop', () => {
      const reports: number[][] = [];
      manager.onProfileTiming = (...args) => reports.push(args);
      for (let i = 0; i < 40; i++) manager.spawn(path, 'zombie');

      let t = 0;
      const now = vi.spyOn(performance, 'now').mockImplementation(() => ++t);
      manager.update(16, 16);
      now.mockRestore();

      // Stride 32 over 40 enemies samples two of them (offset 0 on the first
      // sub-step): 6 timer reads each plus 2 for the total. Every timed phase
      // reads 1 ms here, so each sums to 2 ms and is scaled by 40 / 2.
      expect(t).toBe(2 * 6 + 2);
      const [move, grid, height, render, total] = reports[0];
      expect([move, grid, height, render]).toEqual([40, 40, 40, 0]);
      expect(total).toBe(13);
    });
  });

  it('ignores debug spawn with invalid path', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    eventBus.emit({
      type: 'debug:spawn-enemy',
      enemyType: 'zombie',
      path: [{ lat: 0, lon: 0, height: 0 }],
      count: 1,
    });

    expect(manager.getAll()).toHaveLength(0);
    expect(tilesEngine.enemies.create).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
