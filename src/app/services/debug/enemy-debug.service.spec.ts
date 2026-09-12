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
