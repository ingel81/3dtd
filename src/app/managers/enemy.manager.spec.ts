import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return {
    ...mod,
  };
});

import { EnemyManager } from './enemy.manager';
import { GameEventBus } from '../game-engine';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import type { ThreeTilesEngine } from '../three-engine';
import type { Enemy } from '../entities/enemy.entity';
import { goldBudgetForWave } from '../configs/wave-curriculum.config';
import { PORTAL_OPENING_HEIGHT } from '../configs/marker-geometry.config';
import { registerEnemyModelRangeY } from '../utils/enemy-aim.util';

const createMockTilesEngine = () => ({
  enemies: {
    create: vi.fn(() => Promise.resolve({})),
    startWalkAnimation: vi.fn(),
    startRunAnimation: vi.fn(),
    playDeathAnimation: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
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

  it('kill() returns false for an enemy that is already dying', () => {
    const diedSpy = vi.fn();
    eventBus.on('enemy:died', diedSpy);

    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];
    // zombie has a death animation, so it stays in the dying set until the
    // animation delay has run down
    const enemy = manager.spawn(path, 'zombie');

    expect(manager.kill(enemy)).toBe(true);
    expect(manager.kill(enemy)).toBe(false);
    expect(diedSpy).toHaveBeenCalledTimes(1);
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

    it('a debug kill does not consume slots from the budget', () => {
      manager.setWaveNumberProvider(() => 1);
      manager.setWaveSizeProvider(() => 3);
      const credits = collectCredits();

      // Debug-kill first — must not eat into the budget
      manager.kill(manager.spawn(straightPath, 'zombie'), 'debug');

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

    it('gives the rush state only to types with animationVariation', () => {
      expect(manager.spawn(path, 'wallsmasher').rush).not.toBeNull();
      const zombie = manager.spawn(path, 'zombie');
      expect(zombie.rush).toBeNull();

      manager.update(16, 16);
      expect(zombie.movement.speedMultiplier).toBe(1);
    });

    it('applies the run multiplier in the sub-step that switches to running', () => {
      const enemy = manager.spawn(path, 'wallsmasher');
      const seen: number[] = [];
      const running: boolean[] = [];
      vi.spyOn(enemy.movement, 'move').mockImplementation(() => {
        seen.push(enemy.movement.speedMultiplier);
        running.push(enemy.rush!.running);
        return 'moving';
      });

      for (let s = 1; s <= 600; s++) manager.update(16, s * 16); // 9.6 s > any first phase
      const first = running.indexOf(true);
      expect(first).toBeGreaterThan(0);
      expect(seen[first - 1]).toBe(1);
      expect(seen[first]).toBe(enemy.typeConfig.runSpeedMultiplier);
    });

    it('does not advance the rush while the enemy is paused', () => {
      const enemy = manager.spawn(path, 'wallsmasher', undefined, true);
      for (let s = 1; s <= 600; s++) manager.update(16, s * 16);
      expect(enemy.rush!.running).toBe(false);
      expect(enemy.movement.speedMultiplier).toBe(1);
    });

    it('shows a switch in the present pass, once', () => {
      const enemy = manager.spawn(path, 'wallsmasher');
      const slot = { released: false, isWalking: true };
      tilesEngine.enemies.resolveSlot.mockReturnValue(slot);
      tilesEngine.enemies.startRunAnimation.mockImplementation(() => { slot.isWalking = false; });

      manager.presentFrame(0);
      expect(tilesEngine.enemies.startRunAnimation).not.toHaveBeenCalled();

      enemy.rush!.force(true);
      manager.presentFrame(16);
      manager.presentFrame(32);
      expect(tilesEngine.enemies.startRunAnimation).toHaveBeenCalledTimes(1);
      expect(tilesEngine.enemies.startRunAnimation).toHaveBeenCalledWith(enemy.id);
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

    it('ticks the transform only while it turns', () => {
      const enemy = manager.spawn(path, 'zombie');
      const transformUpdate = vi.spyOn(enemy.transform, 'update');
      manager.update(16, 16);
      expect(enemy.isTurning).toBe(false); // the first lookAt initializes the rotation
      expect(transformUpdate).not.toHaveBeenCalled();

      enemy.isTurning = true; // what TransformComponent sets once lookAt moves the target
      manager.update(16, 32);
      expect(transformUpdate).toHaveBeenCalledTimes(1);
    });

    it('turns after a corner and stops ticking the transform once it faces the new segment', () => {
      const corner: GeoPosition[] = [
        { lat: 0, lon: 0, height: 0 },
        { lat: 0.0002, lon: 0, height: 0 }, // ~22 m north
        { lat: 0.0002, lon: 0.002, height: 0 }, // ~220 m east
      ];
      const enemy = manager.spawn(corner, 'zombie', 40);
      const transformUpdate = vi.spyOn(enemy.transform, 'update');

      let turningSteps = 0;
      for (let s = 1; s <= 150; s++) {
        const wasTurning = enemy.isTurning;
        const before = transformUpdate.mock.calls.length;
        manager.update(16.667, s * 16.667);
        // Called exactly when the flag was set as the loop reached the enemy.
        expect(transformUpdate.mock.calls.length - before).toBe(wasTurning ? 1 : 0);
        if (wasTurning) turningSteps++;
      }

      expect(enemy.movement.currentIndex).toBe(1);
      expect(turningSteps).toBeGreaterThan(10); // the quarter turn eases over many steps
      expect(enemy.isTurning).toBe(false); // settled on the held heading
      expect(enemy.transform.rotation).toBeCloseTo(-Math.PI / 2, 6); // east
    });

    it('resolves the render slot once, and again after the renderer released it', () => {
      const slot = { released: false };
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

  describe('damage over time', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];
    // 25 ms sub-steps: 20 of them are exactly one 500 ms tick interval.
    const STEP = 25;

    interface DotEvent { effectType: string; damageType: string; damage: number; sourceId: string }
    const collectDots = (): DotEvent[] => {
      const dots: DotEvent[] = [];
      eventBus.on('dot:damage', (e) => dots.push(e));
      return dots;
    };
    let now = 0;
    const steps = (n: number, perStep?: () => void) => {
      for (let i = 0; i < n; i++) {
        perStep?.();
        now += STEP;
        manager.update(STEP, now);
      }
    };

    beforeEach(() => {
      now = 0;
    });

    it('ticks each burn source on its own, as fire damage', () => {
      const dots = collectDots();
      const enemy = manager.spawn(path, 'zombie');
      enemy.movement.refreshStatusEffect('burn', 10, 3000, 0, 'fire-1');
      enemy.movement.refreshStatusEffect('burn', 4, 3000, 0, 'fire-2');

      steps(19);
      expect(dots).toHaveLength(0);
      steps(1);
      expect(dots).toEqual([
        expect.objectContaining({ effectType: 'burn', damageType: 'fire', damage: 5, sourceId: 'fire-1' }),
        expect.objectContaining({ effectType: 'burn', damageType: 'fire', damage: 2, sourceId: 'fire-2' }),
      ]);
    });

    it('keeps the tick phase while a beam refreshes the burn every sub-step', () => {
      const dots = collectDots();
      const enemy = manager.spawn(path, 'zombie');
      steps(40, () => enemy.movement.refreshStatusEffect('burn', 10, 3000, now, 'fire-1'));
      expect(dots).toHaveLength(2);
    });

    it('starts a fresh tick phase for a burn applied after the last one expired', () => {
      const dots = collectDots();
      const enemy = manager.spawn(path, 'zombie');
      enemy.movement.refreshStatusEffect('burn', 10, 300, 0, 'fire-1');
      steps(16); // expired at 300 ms with 275 ms accumulated, no tick
      enemy.movement.refreshStatusEffect('burn', 10, 3000, now, 'fire-1');
      steps(19);
      expect(dots).toHaveLength(0);
      steps(1);
      expect(dots).toHaveLength(1);
    });

    it('keeps ticking poison through a refresh by another tower', () => {
      const dots = collectDots();
      const enemy = manager.spawn(path, 'zombie');
      enemy.movement.applyStatusEffect({ type: 'poison', value: 8, duration: 4000, startTime: 0, sourceId: 'p-1' });
      steps(10);
      enemy.movement.applyStatusEffect({ type: 'poison', value: 12, duration: 4000, startTime: now, sourceId: 'p-2' });
      steps(10);
      expect(dots).toEqual([
        expect.objectContaining({ effectType: 'poison', damageType: 'poison', damage: 6, sourceId: 'p-2' }),
      ]);
    });
  });

  describe('air units out of the spawn portal', () => {
    // 111 m north; an 8 m corridor at the start stands a portal of scale 1
    const route: RouteWaypoint[] = [
      { lat: 0, lon: 0, height: 0, corridorLeft: 4, corridorRight: 4 },
      { lat: 0.0004, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];
    /** Model origin above the ground: the grid is off here, the ground stays at 0. */
    const altitude = (e: Enemy) => e.transform.terrainHeight + e.heightOffset;
    const fromPortal = (typeId: string) =>
      manager.spawn(route, typeId as never, undefined, false, undefined, 'portal');
    let random: MockInstance;

    beforeEach(() => {
      // Centre lane, no altitude spread, unless a test says otherwise
      random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });
    afterEach(() => random.mockRestore());

    it('comes out of a wave spawn through the middle of the opening, created there', () => {
      const bat = fromPortal('bat');
      expect(bat.portalExit).not.toBeNull();
      expect(altitude(bat)).toBeCloseTo(PORTAL_OPENING_HEIGHT / 2, 12);
      // Not at cruise altitude for the frames before the first present pass
      expect(tilesEngine.enemies.create).toHaveBeenCalledWith(bat.id, 'bat', 0, 0, altitude(bat));
    });

    it('comes through the same height whatever its altitude spread', () => {
      random.mockReturnValue(0.9); // +2.4 m of the bat's ±3
      const bat = fromPortal('bat');
      expect(bat.movement.getHeightVariation()).toBeCloseTo(2.4, 12);
      expect(altitude(bat)).toBeCloseTo(PORTAL_OPENING_HEIGHT / 2, 12);
    });

    it('stands a dragon taller than the opening on the ground, from the baked range', () => {
      // The dragon model's range as the VAT bake measures it, unscaled (scale 2.5)
      registerEnemyModelRangeY('dragon', 0.292, 4.864);
      const dragon = fromPortal('dragon');
      expect(altitude(dragon) + 0.292 * dragon.typeConfig.scale).toBeCloseTo(0, 12);
    });

    it('holds the opening height out of the gate, then climbs to exactly its cruise height', () => {
      const bat = fromPortal('bat');
      const exit = bat.portalExit!;
      let previous = bat.heightOffset;
      for (let s = 1; bat.portalExit !== null; s++) {
        expect(s).toBeLessThan(1000);
        manager.update(16.667, s * 16.667);
        if (bat.movement.getDistanceAlongPath() <= exit.climbStart) expect(bat.heightOffset).toBe(exit.from);
        expect(bat.heightOffset).toBeGreaterThanOrEqual(previous);
        previous = bat.heightOffset;
      }
      expect(bat.movement.getDistanceAlongPath()).toBeGreaterThanOrEqual(exit.climbEnd);
      expect(bat.heightOffset).toBe(bat.typeConfig.heightOffset);
    });

    it('climbs the same at every sub-step size', () => {
      // 4.8 s of game time: the bat is 38 m along, in the middle of its climb
      const heightAfter = (step: number) => {
        const m = new EnemyManager(
          eventBus,
          globalRouteGrid as unknown as GlobalRouteGridService,
          new SpatialGridService(),
        );
        m.initialize(createMockTilesEngine() as unknown as ThreeTilesEngine);
        const bat = m.spawn(route, 'bat', undefined, false, undefined, 'portal');
        for (let i = 1; i * step <= 4800; i++) m.update(step, i * step);
        expect(bat.portalExit).not.toBeNull();
        return bat.heightOffset;
      };
      const reference = heightAfter(16);
      expect(reference).toBeGreaterThan(PORTAL_OPENING_HEIGHT / 2);
      expect(reference).toBeLessThan(15);
      expect(heightAfter(8)).toBeCloseTo(reference, 9);
      expect(heightAfter(32)).toBeCloseTo(reference, 9);
    });

    it('shows the model at its real height in the present pass', () => {
      const bat = fromPortal('bat');
      tilesEngine.enemies.resolveSlot.mockReturnValue({ released: false });
      manager.presentFrame(0);
      const pushed = (tilesEngine.enemies.updateSlot.mock.calls[0] as unknown[])[1] as { y: number };
      expect(pushed.y).toBeCloseTo(altitude(bat), 12);
    });

    it('gives the way out of the portal to wave spawns of air units only', () => {
      // Debug spawn from the event, and spawn() without an entry
      eventBus.emit({ type: 'debug:spawn-enemy', enemyType: 'bat', path: route });
      const debugBat = manager.getAll()[0];
      const plainBat = manager.spawn(route, 'bat');
      // Split child: joins part-way along the path, where its parent was
      const child = manager.spawn(route, 'bat', undefined, false, undefined, {
        segmentIndex: 0,
        segmentProgress: 0.5,
        lateralFactor: 0,
        heightVariation: 0,
        groundHeight: 0,
      });
      const zombie = fromPortal('zombie');

      for (const e of [debugBat, plainBat, child, zombie]) {
        expect(e.portalExit).toBeNull();
        expect(e.heightOffset).toBe(e.typeConfig.heightOffset);
      }
      expect(debugBat.typeConfig.id).toBe('bat');
    });
  });

  describe('split on death', () => {
    // Three ~22 m segments going north
    const route: GeoPosition[] = [0, 1, 2, 3].map((i) => ({ lat: i * 0.0002, lon: 0, height: 0 }));

    /** A skeleton on segment 1 at 40 %, on the given lane. */
    const skeletonAt = (lateral = 0, hp?: number, speed?: number) => {
      const skeleton = manager.spawn(route, 'skeleton', speed, false, hp);
      skeleton.movement.setPath(route, 1, 0.4);
      skeleton.movement.setLateralFactor(lateral);
      return skeleton;
    };
    const minions = () => manager.getAll().filter((e) => e.typeConfig.id === 'skeleton-minion');

    it('spawns two minions on its path where a killed skeleton died', () => {
      const parent = skeletonAt();
      const progress = parent.movement.getPathProgress();
      manager.kill(parent);

      const children = minions();
      expect(children).toHaveLength(2);
      for (const child of children) {
        expect(child.movement.path).toBe(route);
        expect(child.movement.currentIndex).toBe(1);
        expect(child.movement.progress).toBe(0.4);
        expect(child.movement.getPathProgress()).toBe(progress);
        expect(child.movement.paused).toBe(false);
      }
      expect(manager.getAliveCount()).toBe(2);
    });

    it("spreads the minions across the corridor around the parent's lane", () => {
      manager.kill(skeletonAt(0.2));
      const lanes = minions().map((c) => c.movement.getLateralFactor());
      expect(lanes[0]).toBeCloseTo(-0.1, 12); // 0.2 ∓ spread 0.3
      expect(lanes[1]).toBeCloseTo(0.5, 12);
    });

    it('keeps the minions inside the corridor next to its edge', () => {
      manager.kill(skeletonAt(0.95));
      const lanes = minions().map((c) => c.movement.getLateralFactor());
      expect(lanes[0]).toBeCloseTo(0.4, 12); // lane centred on 1 - 0.3
      expect(lanes[1]).toBeCloseTo(1, 12);
    });

    it("scales the minions by the parent's HP and speed multipliers", () => {
      manager.kill(skeletonAt(0, 10, 9)); // hpMult 0.5, speed ×1.5
      for (const child of minions()) {
        expect(child.health.maxHp).toBeCloseTo(3, 12); // 6 × 10/20
        expect(child.movement.speedMps).toBeCloseTo(10.5, 12); // 7 × 9/6
      }
    });

    it('rolls nothing', () => {
      const parent = skeletonAt(0.3);
      const random = vi.spyOn(Math, 'random');
      manager.kill(parent);
      expect(random).not.toHaveBeenCalled();
      random.mockRestore();
    });

    it('emits enemy:split after enemy:died, with the children', () => {
      const parent = skeletonAt();
      const order: string[] = [];
      const splits: { enemy: unknown; children: readonly unknown[] }[] = [];
      eventBus.on('enemy:died', () => order.push('died'));
      eventBus.on('enemy:spawned', () => order.push('spawned'));
      eventBus.on('enemy:split', (e) => {
        order.push('split');
        splits.push(e);
      });

      manager.kill(parent);

      expect(order).toEqual(['died', 'spawned', 'spawned', 'split']);
      const children = minions();
      expect(splits).toHaveLength(1);
      expect(splits[0].enemy).toBe(parent);
      expect(splits[0].children).toHaveLength(2);
      expect(splits[0].children[0]).toBe(children[0]);
      expect(splits[0].children[1]).toBe(children[1]);
    });

    it('does not split on a leak', () => {
      const parent = skeletonAt();
      vi.spyOn(parent.movement, 'move').mockReturnValue('reached_end');
      manager.update(16, 16);
      expect(manager.getById(parent.id)).toBeNull();
      expect(minions()).toHaveLength(0);
    });

    it('does not split on a debug kill', () => {
      manager.kill(skeletonAt(), 'debug');
      expect(minions()).toHaveLength(0);
    });

    it('does not split a minion again', () => {
      manager.kill(skeletonAt());
      for (const child of minions()) manager.kill(child);
      expect(manager.getAliveCount()).toBe(0);
      expect(minions()).toHaveLength(2); // the two, dying
    });

    it('keeps the minions of an idle parent idle', () => {
      manager.kill(manager.spawn(route, 'skeleton', undefined, true));
      expect(minions()).toHaveLength(2);
      expect(minions().every((c) => c.movement.paused)).toBe(true);
    });

    it('moves the minions from the next sub-step when damage over time kills in the movement pass', () => {
      const parent = skeletonAt();
      let diedAt = -1;
      eventBus.on('dot:damage', (e) => manager.kill(e.enemy));
      eventBus.on('enemy:died', (e) => {
        if (e.enemy === parent) diedAt = parent.movement.getPathProgress();
      });
      parent.movement.applyStatusEffect({ type: 'poison', value: 1, duration: 5000, startTime: 0, sourceId: 'p-1' });

      manager.update(1000, 1000); // past one poison tick
      expect(diedAt).toBeGreaterThan(0);
      expect(minions().map((c) => c.movement.getPathProgress())).toEqual([diedAt, diedAt]);

      manager.update(16, 1016);
      expect(minions().every((c) => c.movement.getPathProgress() > diedAt)).toBe(true);
    });
  });

  describe('ooze', () => {
    // About 334 m due north
    const route: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.003, lon: 0, height: 0 },
    ];
    const walk = (enemy: Enemy, seconds: number): void => {
      for (let t = 0; t < seconds * 1000; t += 100) manager.update(100, t);
      expect(enemy.alive).toBe(true);
    };

    it('spawns without a model instance, with its body where it joins the path', () => {
      const ooze = manager.spawn(route, 'ooze');
      expect(tilesEngine.enemies.create).not.toHaveBeenCalled();
      expect(ooze.body).not.toBeNull();
      expect(ooze.body!.tailM).toBe(0);
      expect(ooze.body!.tipM).toBe(0);
      expect(ooze.body!.stations.path).toBe(ooze.movement.path);
    });

    it('grows behind its tip, the tail at the portal until the body is 80 m long', () => {
      const ooze = manager.spawn(route, 'ooze');
      walk(ooze, 20); // 3 m/s
      expect(ooze.body!.tipM).toBeCloseTo(60, 6);
      expect(ooze.body!.tailM).toBe(0);
      walk(ooze, 10);
      expect(ooze.body!.tipM).toBeCloseTo(90, 6);
      expect(ooze.body!.tailM).toBeCloseTo(10, 6);
    });

    it('lets go of the body when it is removed', () => {
      const ooze = manager.spawn(route, 'ooze');
      manager.kill(ooze, 'debug');
      expect(manager.getById(ooze.id)).toBeNull();
      manager.update(100, 100); // nothing left to grow
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
