/**
 * Playtest 329 (night 2026-09-14): Enemy Debug, Place just beside the route
 * between two waypoints. The real EnemyDebugService projects the click onto
 * the spawn's route and sends debug:spawn-enemy over the real event bus, the
 * real EnemyManager puts the enemy on the route itself; "Start moving"
 * (onStartEnemyMovement) lets it walk. The wave start starts paused debug
 * enemies with the same startMoving() (GameLoopFacadeService, effect on the
 * phase), not driven here. Rendering is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

// Angular DI: inject() returns the stub registered under the service name.
const mockInjections: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => mockInjections[token?.name ?? ''] ?? {},
  };
});
vi.mock('../world/path-route.service', () => ({ PathAndRouteService: class PathAndRouteService {} }));
vi.mock('../../store/debug.store', () => ({ DebugStore: class DebugStore {} }));

import { EnemyDebugService } from './enemy-debug.service';
import { createTestManagers, TestManagers, tickEngine } from '../../integration/test-helpers';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import type { Enemy } from '../../entities/enemy.entity';
import { getRouteProfile } from '../../utils/route-corridor';

// North 111 m, then east 149 m to the HQ
const route = [
  { lat: 48.0, lon: 9.0, height: 300 },
  { lat: 48.001, lon: 9.0, height: 302 },
  { lat: 48.001, lon: 9.002, height: 306 },
];
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(48 * DEG_TO_RAD);

/** Metres from the route's centre line */
function offRoute(p: { lat: number; lon: number }): number {
  const onFirst = p.lat >= 48.0 && p.lat <= 48.001 ? Math.abs(p.lon - 9.0) * M_PER_DEG_LON : Infinity;
  const onSecond = p.lon >= 9.0 && p.lon <= 9.002 ? Math.abs(p.lat - 48.001) * METERS_PER_DEGREE_LAT : Infinity;
  return Math.min(onFirst, onSecond);
}

describe('Enemy Debug places on the route and walks on from there (playtest 329)', () => {
  let m: TestManagers;
  let service: EnemyDebugService;

  const place = (lat: number, lon: number): Enemy => {
    service.handleEnemyPlacement(lat, lon, 0);
    const placed = m.enemyManager.getAll();
    expect(placed).toHaveLength(1);
    return placed[0];
  };

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    mockInjections['PathAndRouteService'] = { getCachedPath: (id: string) => (id === 'spawn-1' ? route : undefined) };
    mockInjections['DebugStore'] = {
      enemyPlacementMode: signal(true),
      enemyOverrides: signal({ zombie: { baseSpeed: 4, baseHp: 50 } }),
    };
    const gameState = {
      getEventBus: () => m.eventBus,
      getGlobalRouteGrid: () => ({ getCellAt: () => ({}) }),
    };
    service = new EnemyDebugService();
    service.initialize(gameState as never, m.engine, signal([{ id: 'spawn-1' }]) as never);
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('329: stands on the centre line where the click projects, idle, facing along the route towards the HQ', () => {
    // A metre north of the second segment (eastwards), halfway along it
    const enemy = place(48.00101, 9.001);

    expect(enemy.movement.paused).toBe(true);
    expect(enemy.movement.currentIndex).toBe(1);
    expect(offRoute(enemy.position)).toBeLessThan(0.01);
    expect(enemy.position.lon).toBeCloseTo(9.001, 5);
    // East, not heading 0 (north)
    expect(Math.abs(enemy.transform.rotation)).toBeCloseTo(Math.PI / 2, 6);
    expect(service.debugEnemies().map((de) => de.id)).toEqual([enemy.id]);
  });

  it('329: "Start moving" walks it on along its segment without a turn', () => {
    const enemy = place(48.00101, 9.001);
    const facing = enemy.transform.rotation;

    service.onStartEnemyMovement(enemy.id);
    expect(enemy.movement.paused).toBe(false);
    tickEngine(m, 3_000);

    expect(enemy.position.lon).toBeGreaterThan(9.001);
    expect(offRoute(enemy.position)).toBeLessThan(0.05);
    expect(enemy.transform.rotation).toBeCloseTo(facing, 3);
  });

  it('329: placed beside the first segment it walks to that segment\'s end before it turns, no shortcut', () => {
    // Halfway up the northbound segment, a metre east of it
    const enemy = place(48.0005, 9.0 + 1 / M_PER_DEG_LON);
    expect(enemy.movement.currentIndex).toBe(0);
    expect(enemy.transform.rotation).toBeCloseTo(0, 6);
    service.onStartEnemyMovement(enemy.id);

    // It turns on the corner's arc (RouteCorners); off its stretch of route
    // it keeps to the line
    const { corners } = getRouteProfile(route);
    const arc = corners.arcOf[1];
    let worst = 0;
    let nearestCorner = Infinity;
    const clock = { now: 0 };
    for (let t = 0; t < 20_000; t += 100) {
      tickEngine(m, 100, clock);
      const along = enemy.movement.getDistanceAlongPath();
      const onArc = along > corners.from[arc] && along < corners.to[arc];
      if (!onArc) worst = Math.max(worst, offRoute(enemy.position));
      const toCorner = Math.hypot(
        (enemy.position.lat - 48.001) * METERS_PER_DEGREE_LAT,
        (enemy.position.lon - 9.0) * M_PER_DEG_LON,
      );
      nearestCorner = Math.min(nearestCorner, toCorner);
    }

    expect(enemy.movement.currentIndex).toBe(1);
    expect(arc).toBeGreaterThanOrEqual(0);
    // The middle of the arc: radius times (1 / cos 45 degrees - 1) inside the corner
    expect(nearestCorner).toBeCloseTo(corners.radius[arc] * (Math.SQRT2 - 1), 1);
    expect(worst).toBeLessThan(0.05);
  });
});
