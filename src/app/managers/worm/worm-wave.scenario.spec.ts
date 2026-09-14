/**
 * Playtest 354 and 355 (night 2026-09-14): the worm in a Custom Wave with
 * Count 2 and placed through Enemy Debug. Real EnemyManager, WaveManager and
 * GameStateSyncService with its store (the wave button's "N left" reads
 * waveEnemiesLeft), rendering mocked. The Custom Wave's schedule is built as
 * WaveDebugService builds it: one entry per worm, the debug store's spawn
 * delay of 1.5 s between them. Enemy Debug's click arrives as the
 * debug:spawn-enemy it emits (EnemyDebugService.handleEnemyPlacement).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

// inject() hands out the stores constructed below, as in game-state-sync.service.spec.ts
const injectionRegistry: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => (token?.name ? injectionRegistry[token.name] : undefined),
  };
});

import { createTestManagers, TestManagers, tickEngine, TEST_SPAWN_POINTS } from '../../integration/test-helpers';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { getRouteProfile } from '../../utils/route-corridor';
import { GameStateSyncService } from '../../services/infrastructure/game-state-sync.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import { GameStore } from '../../store/game.store';
import { UIStore } from '../../store/ui.store';
import { EngineStore } from '../../store/engine.store';
import { LocationStore } from '../../store/location.store';
import type { GeoPosition } from '../../models/game.types';
import type { Enemy } from '../../entities/enemy.entity';
import type { WormGroup } from './worm-group';

const chain = ENEMY_TYPES['worm'].chain!;
const SPEED = ENEMY_TYPES['worm'].baseSpeed;
/** DebugStore.waveSpawnDelay, the Custom Wave's delay between two entries */
const CUSTOM_WAVE_DELAY_MS = 1500;

/** Straight route north, a waypoint every 50 m */
function northPath(meters: number): GeoPosition[] {
  const points: GeoPosition[] = [];
  for (let m = 0; m < meters; m += 50) {
    points.push({ lat: 48.776 + m / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  }
  points.push({ lat: 48.776 + meters / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  return points;
}

/** Straight route east, a waypoint every 50 m */
function eastPath(meters: number): GeoPosition[] {
  const perDegree = METERS_PER_DEGREE_LAT * Math.cos((48.776 * Math.PI) / 180);
  const points: GeoPosition[] = [];
  for (let m = 0; m <= meters; m += 50) points.push({ lat: 48.776, lon: 9.183 + m / perDegree, height: 300 });
  return points;
}

const distance = (e: Enemy): number => e.movement.getDistanceAlongPath();
const out = (group: WormGroup): Enemy[] => group.segments.filter((e): e is Enemy => e !== null);

describe('Worm in a Custom Wave and in Enemy Debug (playtest 354, 355)', () => {
  let m: TestManagers;
  let store: TowerDefenseStore;
  let sync: GameStateSyncService;
  let worms: WormGroup[];

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    injectionRegistry['GameStore'] = new GameStore();
    injectionRegistry['UIStore'] = new UIStore();
    injectionRegistry['EngineStore'] = new EngineStore();
    injectionRegistry['LocationStore'] = new LocationStore();
    injectionRegistry['ResearchStore'] = new ResearchStore();
    injectionRegistry['EngineInitializationService'] = {};
    store = new TowerDefenseStore();
    injectionRegistry['TowerDefenseStore'] = store;

    m = createTestManagers();
    sync = new GameStateSyncService();
    sync.initialize(m.eventBus);
    worms = [];
    m.eventBus.on('worm:spawned', (e) => worms.push(e.group));
  });

  afterEach(() => {
    m.enemyManager.clear();
    sync.dispose();
    vi.restoreAllMocks();
  });

  describe('Count 2 (354)', () => {
    const PATH = northPath(150);

    /** Wave Debug, Single, Chitin Worm, Count 2, Start Custom Wave */
    const startTwoWorms = (): void => {
      m.waveManager.initialize(TEST_SPAWN_POINTS, new Map([['spawn-1', PATH]]));
      m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
      m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
      m.waveManager.startWave({
        schedule: {
          entries: [{ enemyType: 'worm', speed: SPEED }, { enemyType: 'worm', speed: SPEED }],
          baseDelay: CUSTOM_WAVE_DELAY_MS,
        },
      });
    };

    it('brings the second worm out of the portal only once the first is all out, behind a gap', () => {
      startTwoWorms();
      const clock = { now: 0 };
      tickEngine(m, CUSTOM_WAVE_DELAY_MS + 100, clock);
      expect(worms).toHaveLength(2);
      const [first, second] = worms;
      const secondHead = second.segments[0]!;

      // While the first still has rings in the portal the second waits in it
      let waited = 0;
      while (first.pending > 0) {
        expect(distance(secondHead)).toBe(0);
        expect(second.pending).toBe(second.size - 1);
        tickEngine(m, 100, clock);
        waited += 100;
      }
      // The first is out once its head has covered the length of the worm
      expect(waited).toBeGreaterThan(((first.size - 1) * chain.spacing) / SPEED * 1000 - CUSTOM_WAVE_DELAY_MS - 500);

      tickEngine(m, 3_000, clock);
      expect(distance(secondHead)).toBeGreaterThan(0);
      const firstTail = out(first).at(-1)!;
      expect(distance(firstTail) - distance(secondHead)).toBeGreaterThanOrEqual(chain.spacing);
    });

    it('counts every ring in "N left" and ends the wave with the last ring, not before', () => {
      startTwoWorms();
      const clock = { now: 0 };
      tickEngine(m, CUSTOM_WAVE_DELAY_MS + 100, clock);
      const [first, second] = worms;
      const rings = first.size + second.size;
      expect(store.waveEnemyTotal()).toBe(rings);
      expect(store.waveEnemiesLeft()).toBe(rings);

      // No tower: every ring walks into the HQ
      const reached: Enemy[] = [];
      m.eventBus.on('enemy:reached-base', (e) => reached.push(e.enemy));
      let ended = false;
      for (let t = 0; t < 300_000 && !ended; t += 100) {
        tickEngine(m, 100, clock);
        ended = m.waveManager.checkWaveComplete();
        if (!ended) expect(first.remaining + second.remaining).toBeGreaterThan(0);
        expect(store.waveEnemiesLeft()).toBe(rings - reached.length);
      }
      expect(ended).toBe(true);
      expect(reached).toHaveLength(rings);
      expect(store.waveEnemiesLeft()).toBe(0);
    });

    it('Cheat Kill while the first is still coming out: nothing comes after, the second not at all, the wave ends', () => {
      startTwoWorms();
      const clock = { now: 0 };
      tickEngine(m, 1_000, clock);
      expect(worms).toHaveLength(1);
      expect(worms[0].pending).toBeGreaterThan(0);

      m.eventBus.emit({ type: 'debug:kill-all' });
      expect(worms[0].remaining).toBe(0);
      expect(m.enemyManager.getPendingSpawnCount()).toBe(0);
      expect(store.waveEnemiesLeft()).toBe(0);

      tickEngine(m, 5_000, clock);
      expect(worms).toHaveLength(1);
      expect(m.enemyManager.getAll()).toHaveLength(0);
      expect(m.waveManager.checkWaveComplete()).toBe(true);
    });
  });

  describe('placed through Enemy Debug (355)', () => {
    const PATH = eastPath(400);
    /** Halfway along the third 50 m segment, as placementOnRoute() hands it over */
    const start = { segmentIndex: 2, segmentProgress: 0.5, lateralFactor: 0, heightVariation: 0, groundHeight: 300 };
    const place = (): Enemy => {
      m.eventBus.emit({ type: 'debug:spawn-enemy', enemyType: 'worm', count: 1, path: PATH, start, paused: true });
      const [head] = m.enemyManager.getAlive();
      return head;
    };

    it('stands with its head at the click, facing along the route, and nothing comes out before Start moving', () => {
      const head = place();
      const profile = getRouteProfile(PATH);
      const origin = profile.cumulativeLength[2] + profile.segmentLengths[2] * 0.5;

      expect(head.worm!.head).toBe(true);
      expect(distance(head)).toBeCloseTo(origin, 6);
      expect(head.position.lat).toBeCloseTo((PATH[2].lat + PATH[3].lat) / 2, 9);
      expect(head.position.lon).toBeCloseTo((PATH[2].lon + PATH[3].lon) / 2, 9);
      // East, as enemy.manager.spec reads a heading east after a corner; not 0 (north)
      expect(head.transform.rotation).toBeCloseTo(-Math.PI / 2, 6);

      tickEngine(m, 5_000);
      expect(distance(head)).toBeCloseTo(origin, 6);
      expect(worms[0].pending).toBe(worms[0].size - 1);
    });

    it('lets the rings come out at the click after Start moving; the cross removes the whole worm', () => {
      const head = place();
      const group = worms[0];
      const origin = group.origin;
      head.startMoving();
      tickEngine(m, 5_500);

      const segments = out(group);
      expect(segments.length).toBeGreaterThan(5);
      // The last ring out is the one that just left the click point
      expect(distance(segments.at(-1)!)).toBeGreaterThanOrEqual(origin);
      expect(distance(segments.at(-1)!)).toBeLessThan(origin + chain.spacing);

      // The debug list holds the head; its cross emits debug:remove-enemy for it
      m.eventBus.emit({ type: 'debug:remove-enemy', enemyId: head.id });
      expect(group.remaining).toBe(0);
      expect(m.enemyManager.getAll()).toHaveLength(0);
      expect(m.enemyManager.getPendingSpawnCount()).toBe(0);
    });
  });
});
