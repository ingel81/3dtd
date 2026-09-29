import { describe, it, expect, vi } from 'vitest';
import { GameEventBus } from '../game-engine/game-event-bus';
import { OozeBodies } from './ooze-bodies';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { createSinkSpy, createTestCoords } from '../integration/test-helpers';
import type { SimSink } from '../sim/core/sim-sink';

function mockGrid() {
  return {
    getGroundLocalYAt: () => 0,
    addBodyEnemy: vi.fn(),
    removeBodyEnemy: vi.fn(),
  } as unknown as GlobalRouteGridService;
}

describe('OozeBodies.clear', () => {
  it('leaves the renderer alone without a live ooze tracked here, so a killed one\'s band and debris run out', () => {
    const sink = createSinkSpy();
    const bodies = new OozeBodies(mockGrid(), new GameEventBus(), () => 1, createTestCoords(), sink as unknown as SimSink);
    // A kill before this already took the ooze off the internal list
    // (detach(), called from EnemyManager.remove()). Every wave end runs
    // this; its collapsing band and debris are left to finish, a restart
    // clears them (GameStateManager.reset).
    bodies.clear();
    expect(sink.oozes.clear).not.toHaveBeenCalled();
    expect(sink.oozes.discard).not.toHaveBeenCalled();
  });
});
