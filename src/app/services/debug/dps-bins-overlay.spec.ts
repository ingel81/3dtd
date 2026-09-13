import { beforeEach, describe, expect, it, vi } from 'vitest';

// The visualizer builds an InstancedMesh from the profile; the fake records
// what the overlay asks of it.
const dpsViz = vi.hoisted(() => ({
  instances: [] as {
    sync: unknown;
    mesh: { parent: unknown };
    updates: unknown[];
    visible: boolean | null;
    disposed: boolean;
  }[],
}));
vi.mock('../../ai/core/dps-profile-visualizer', () => ({
  DpsProfileVisualizer: class {
    mesh = { parent: null as unknown };
    updates: unknown[] = [];
    visible: boolean | null = null;
    disposed = false;
    constructor(public sync: unknown) {
      dpsViz.instances.push(this);
    }
    update(profile: unknown) { this.updates.push(profile); }
    setVisible(visible: boolean) { this.visible = visible; }
    getMesh() { return this.mesh; }
    dispose() { this.disposed = true; }
  },
}));

import { DpsBinsOverlay, type DpsBinsOverlayDeps } from './dps-bins-overlay';
import { GameEventBus } from '../../game-engine/game-event-bus';
import type { ThreeTilesEngine } from '../../three-engine';

/**
 * The DPS bins show the AI data collector's current DPS profile along the
 * path and follow tower changes while they are shown.
 */
describe('DpsBinsOverlay', () => {
  let bus: GameEventBus;
  let coordSync: object | null;
  let overlay: DpsBinsOverlay;
  const profile = { profile: 1 };
  const scene = {
    add: vi.fn((m: { parent: unknown }) => { m.parent = scene; }),
    remove: vi.fn((m: { parent: unknown }) => { m.parent = null; }),
  };
  const engine = { getScene: () => scene } as unknown as ThreeTilesEngine;
  const emit = (type: string) => bus.emit({ type } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    dpsViz.instances.length = 0;
    bus = new GameEventBus();
    coordSync = { sync: true };
    const deps = {
      gameState: () => ({ getGlobalRouteGrid: () => ({ getCoordinateSync: () => coordSync }), getEventBus: () => bus }),
      aiDataCollector: { getCurrentDPSProfile: vi.fn(() => profile) },
    };
    overlay = new DpsBinsOverlay(deps as unknown as DpsBinsOverlayDeps);
  });

  it('shows the current profile and follows tower changes until hidden', () => {
    overlay.setVisible(true, engine);

    const [viz] = dpsViz.instances;
    expect(viz.sync).toBe(coordSync);
    expect(viz.updates).toEqual([profile]);
    expect(viz.visible).toBe(true);
    expect(scene.add).toHaveBeenCalledWith(viz.mesh);

    for (const type of ['tower:placed', 'tower:sold', 'tower:upgraded']) emit(type);
    expect(viz.updates).toHaveLength(4);
    expect(scene.add).toHaveBeenCalledTimes(1);

    overlay.setVisible(false, engine);
    expect(viz.visible).toBe(false);
    emit('tower:placed');
    expect(viz.updates).toHaveLength(4);
    expect(bus.getListenerCount()).toBe(0);
  });

  it('keeps the visualizer when shown again', () => {
    overlay.setVisible(true, engine);
    overlay.setVisible(false, engine);
    overlay.setVisible(true, engine);
    expect(dpsViz.instances).toHaveLength(1);
  });

  it('shows nothing without a coordinate sync', () => {
    coordSync = null;
    overlay.setVisible(true, engine);
    expect(dpsViz.instances).toHaveLength(0);
    expect(bus.getListenerCount()).toBe(0);
  });

  it('hides nothing that was never shown', () => {
    expect(() => overlay.setVisible(false, engine)).not.toThrow();
    expect(() => overlay.dispose(engine)).not.toThrow();
  });

  it('takes the bins out of the scene, disposes them and stops following on dispose', () => {
    overlay.setVisible(true, engine);
    const [viz] = dpsViz.instances;

    overlay.dispose(engine);

    expect(scene.remove).toHaveBeenCalledWith(viz.mesh);
    expect(viz.disposed).toBe(true);
    expect(bus.getListenerCount()).toBe(0);
    overlay.setVisible(true, engine);
    expect(dpsViz.instances).toHaveLength(2);
  });

  it('still disposes the visualizer without an engine', () => {
    overlay.setVisible(true, engine);
    const [viz] = dpsViz.instances;

    overlay.dispose(null);

    expect(scene.remove).not.toHaveBeenCalled();
    expect(viz.disposed).toBe(true);
  });
});
