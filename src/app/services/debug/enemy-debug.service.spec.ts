import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';

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

/**
 * The enemy debugger removes its enemies through the event bus, so the
 * GameStateManager sees them go and turns the towers to guard once the last
 * enemy outside a wave is gone.
 */
describe('EnemyDebugService removal', () => {
  let service: EnemyDebugService;
  let emit: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;

  const enemy = (id: string) => ({ id }) as never;

  beforeEach(() => {
    mockInjections['PathAndRouteService'] = {};
    mockInjections['DebugStore'] = { enemyPlacementMode: signal(false), enemyOverrides: signal({}) };
    emit = vi.fn();
    remove = vi.fn();
    const gameState = {
      getEventBus: () => ({ emit, on: () => ({ dispose: () => undefined }) }),
      enemyManager: { remove },
    };
    service = new EnemyDebugService();
    service.initialize(gameState as never, null, signal([]));
    service.registerDebugEnemy(enemy('a'), 'zombie', 0, 0);
    service.registerDebugEnemy(enemy('b'), 'zombie', 0, 0);
  });

  it('removes one enemy with debug:remove-enemy', () => {
    service.onRemoveDebugEnemy('a');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ type: 'debug:remove-enemy', enemyId: 'a' });
    expect(remove).not.toHaveBeenCalled();
    expect(service.debugEnemies().map((de) => de.id)).toEqual(['b']);
  });

  it('clears every debug enemy with one debug:remove-enemy each', () => {
    service.onClearDebugEnemies();
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: 'debug:remove-enemy', enemyId: 'a' },
      { type: 'debug:remove-enemy', enemyId: 'b' },
    ]);
    expect(remove).not.toHaveBeenCalled();
    expect(service.debugEnemies()).toEqual([]);
  });
});

/**
 * A placed enemy walks the spawn's route itself, from where the click
 * projects onto it, like a split child: no copy of the route.
 */
describe('EnemyDebugService placement', () => {
  // North 111 m, then east 149 m
  const route = [
    { lat: 48.0, lon: 9.0, height: 300 },
    { lat: 48.001, lon: 9.0, height: 302 },
    { lat: 48.001, lon: 9.002, height: 306 },
  ];
  let emit: ReturnType<typeof vi.fn>;
  let onRoute: boolean;
  let service: EnemyDebugService;

  beforeEach(() => {
    mockInjections['PathAndRouteService'] = { getCachedPath: (id: string) => (id === 'spawn-1' ? route : undefined) };
    mockInjections['DebugStore'] = {
      enemyPlacementMode: signal(true),
      enemyOverrides: signal({ zombie: { baseSpeed: 4, baseHp: 50 } }),
    };
    emit = vi.fn();
    onRoute = true;
    const gameState = {
      getEventBus: () => ({ emit, on: () => ({ dispose: () => undefined }) }),
      getGlobalRouteGrid: () => ({ getCellAt: () => (onRoute ? {} : null) }),
    };
    const engine = {
      sync: { geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }), getOrigin: () => ({ lat: 48, lon: 9, height: 0 }) },
      getTerrainHeightAtGeo: () => null,
    };
    service = new EnemyDebugService();
    service.initialize(gameState as never, engine as never, signal([{ id: 'spawn-1' }]) as never);
  });

  it('starts it on the route where the click projects onto it', () => {
    // A metre beside the second segment, halfway along it
    service.handleEnemyPlacement(48.00101, 9.001, 0);

    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0];
    expect(event).toMatchObject({ type: 'debug:spawn-enemy', enemyType: 'zombie', paused: true, speed: 4, health: 50 });
    expect(event.path).toBe(route);
    expect(event.start.segmentIndex).toBe(1);
    expect(event.start.segmentProgress).toBeCloseTo(0.5, 3);
    expect(event.start.groundHeight).toBeCloseTo(304, 2);
    expect(event.start).toMatchObject({ lateralFactor: 0, heightVariation: 0 });
  });

  it('clamps a click past the route end to the end', () => {
    service.handleEnemyPlacement(48.001, 9.0025, 0);
    expect(emit.mock.calls[0][0].start).toMatchObject({ segmentIndex: 1, segmentProgress: 1 });
  });

  it('places nothing off the route', () => {
    onRoute = false;
    service.handleEnemyPlacement(48.0005, 9.0, 0);
    expect(emit).not.toHaveBeenCalled();
  });
});
