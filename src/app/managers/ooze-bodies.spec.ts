import { describe, it, expect, vi } from 'vitest';
import { GameEventBus } from '../game-engine';
import { OozeBodies } from './ooze-bodies';
import type { ThreeTilesEngine } from '../three-engine';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';

function mockEngine() {
  return {
    oozes: { clear: vi.fn(), discard: vi.fn() },
    spatialAudio: null,
  } as unknown as ThreeTilesEngine;
}

function mockGrid() {
  return {
    getGroundLocalYAt: () => 0,
    addBodyEnemy: vi.fn(),
    removeBodyEnemy: vi.fn(),
  } as unknown as GlobalRouteGridService;
}

describe('OozeBodies.clear', () => {
  it('leaves the renderer alone without a live ooze tracked here, so a killed one\'s band and debris run out', () => {
    const engine = mockEngine();
    const bodies = new OozeBodies(mockGrid(), new GameEventBus(), () => 1);
    // A kill before this already took the ooze off the internal list
    // (detach(), called from EnemyManager.remove()). Every wave end runs
    // this; its collapsing band and debris are left to finish, a restart
    // clears them (GameStateManager.reset).
    bodies.clear(engine);
    expect(engine.oozes.clear).not.toHaveBeenCalled();
    expect(engine.oozes.discard).not.toHaveBeenCalled();
  });

  it('does nothing without an engine', () => {
    const bodies = new OozeBodies(mockGrid(), new GameEventBus(), () => 1);
    expect(() => bodies.clear(null)).not.toThrow();
  });
});
