import { describe, it, expect, vi } from 'vitest';
import { GameEventBus } from '../game-engine';
import { OozeBodies } from './ooze-bodies';
import type { ThreeTilesEngine } from '../three-engine';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';

function mockEngine() {
  return {
    oozes: { clear: vi.fn() },
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
  it('clears the renderer\'s bands and debris even without a live ooze tracked here', () => {
    const engine = mockEngine();
    const bodies = new OozeBodies(mockGrid(), new GameEventBus(), () => 1);
    // A kill just before this already took the ooze off the internal list
    // (detach(), called from EnemyManager.remove()), but a collapsing band
    // or debris it threw can still be sitting in the renderer.
    bodies.clear(engine);
    expect(engine.oozes.clear).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an engine', () => {
    const bodies = new OozeBodies(mockGrid(), new GameEventBus(), () => 1);
    expect(() => bodies.clear(null)).not.toThrow();
  });
});
