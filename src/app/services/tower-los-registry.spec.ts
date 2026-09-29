import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector3 } from 'three';

vi.mock('./world/global-route-grid.service', () => ({ GlobalRouteGridService: class GlobalRouteGridService {} }));
vi.mock('../sim/client/sim-client.service', () => ({ SimClient: class SimClient {} }));

import { Injector, runInInjectionContext } from '@angular/core';
import { TowerLosRegistry } from './tower-los-registry';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { SimClient } from '../sim/client/sim-client.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { packet, towerDto, type PacketParts } from '../sim/client/mirror/testing/mirror-packets';
import { createMainEventBus, type MainEventBus, type ViewEvent } from '../sim/client/view-events';
import { Tower } from '../entities/tower.entity';
import { TOWER_TYPES } from '../configs/tower-types.config';
import { losMaskToJson, type LosMask } from '../utils/los-mask';
import type { ThreeTilesEngine } from '../three-engine';
import type { RouteCell } from '../utils/route-cell';
import type { SimFramePacket } from '../sim/protocol/packet';

/**
 * The registry against a fake grid and cubemap, a real mirror and the main
 * bus: the simulation asks with tower:los-needed, the registry renders after
 * the frame and answers with command:los-mask; the masks the simulation
 * sends back in the tower states go into the main grid.
 */
describe('TowerLosRegistry', () => {
  /** Local frame: lon is x, lat is z, height is y. */
  const sync = { geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }) };

  let grid: {
    isInitialized: () => boolean;
    registerTower: ReturnType<typeof vi.fn>;
    registerTowerIncremental: ReturnType<typeof vi.fn>;
    unregisterTower: ReturnType<typeof vi.fn>;
    encodeLosMask: ReturnType<typeof vi.fn>;
    applyLosMask: ReturnType<typeof vi.fn>;
  };
  let engine: ThreeTilesEngine;
  let mapper: {
    invalidate: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getRenderTarget: () => object;
    getReferencePos: () => Vector3;
    getFarDistance: () => number;
    readFacesToCpu: ReturnType<typeof vi.fn>;
  };
  let initialized: boolean;
  let blockers: object | null;
  let bus: MainEventBus;
  let mirror: SimMirror;
  let frameListeners: ((packet: SimFramePacket) => void)[];
  let sent: Extract<ViewEvent, { type: 'command:los-mask' }>[];
  let registry: TowerLosRegistry;

  const maskOf = (range: number, ground: boolean, air: boolean): LosMask =>
    ({ range, ground, air, bits: new Uint8Array([range & 0xff]) });
  const cell = (x: number, z: number) =>
    ({ x, z, towerVisibility: new Map(), airVisibility: new Map() }) as unknown as RouteCell;

  /** A packet through the mirror, then the SimClient's frame listeners */
  const frame = (parts: PacketParts = {}) => {
    const p = packet(parts);
    mirror.applyState(p);
    mirror.afterFrame(p);
    for (const listener of [...frameListeners]) listener(p);
  };
  /** A tower the simulation placed: its state in the mirror */
  const place = (lon = 0, lat = 0): Tower => {
    const t = new Tower({ lat, lon, height: 0 }, 'archer');
    frame({ towerStates: [towerDto(t)] });
    return t;
  };
  const needed = (t: Tower, reason: 'place' | 'upgrade' | 'retrofit' = 'place', range = t.combat.range) =>
    bus.emit({ type: 'tower:los-needed', towerId: t.id, reason, range, canTargetGround: true, canTargetAir: true });

  beforeEach(() => {
    grid = {
      isInitialized: () => initialized,
      registerTower: vi.fn(() => [cell(0, 0)]),
      registerTowerIncremental: vi.fn(() => []),
      unregisterTower: vi.fn(),
      encodeLosMask: vi.fn((_id: string, _x: number, _z: number, range: number, ground: boolean, air: boolean) =>
        maskOf(range, ground, air)),
      applyLosMask: vi.fn(() => [cell(1, 1), cell(2, 2)]),
    };
    bus = createMainEventBus();
    sent = [];
    bus.on('command:los-mask', (event) => sent.push(event));
    mirror = new SimMirror();
    frameListeners = [];
    const sim = {
      bus,
      mirror,
      onFrame: (listener: (packet: SimFramePacket) => void) => {
        frameListeners.push(listener);
        return () => frameListeners.splice(frameListeners.indexOf(listener), 1);
      },
    };
    blockers = {};
    initialized = true;
    mapper = {
      invalidate: vi.fn(),
      update: vi.fn(),
      getRenderTarget: () => ({}),
      getReferencePos: () => new Vector3(),
      getFarDistance: () => 100,
      readFacesToCpu: vi.fn(() => []),
    };
    engine = { sync, getLosBlockerGroup: () => blockers, getTowerShadowMapper: () => mapper } as unknown as ThreeTilesEngine;
    const injector = Injector.create({
      providers: [
        { provide: GlobalRouteGridService, useValue: grid },
        { provide: SimClient, useValue: sim },
      ],
    });
    registry = runInInjectionContext(injector, () => new TowerLosRegistry());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hears nothing before attach and after detach', () => {
    const t = place(5, 7);
    needed(t);
    frame();
    expect(grid.registerTower).not.toHaveBeenCalled();

    registry.attach(engine);
    registry.detach();
    needed(t);
    frame();
    expect(grid.registerTower).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('renders a placed tower after the frame on the cells as they are and answers with its mask', () => {
    registry.attach(engine);
    const t = place(5, 7);
    needed(t);
    expect(registry.pendingTowerIds()).toEqual([t.id]);
    expect(grid.registerTower).not.toHaveBeenCalled();

    frame();
    const [id, x, z, range] = grid.registerTower.mock.calls[0];
    expect([id, x, z, range]).toEqual([t.id, 5, 7, TOWER_TYPES.archer.range]);
    expect(grid.encodeLosMask).toHaveBeenCalledWith(t.id, 5, 7, TOWER_TYPES.archer.range, true, true);
    expect(sent).toEqual([{
      type: 'command:los-mask',
      towerId: t.id,
      reason: 'place',
      mask: losMaskToJson(maskOf(TOWER_TYPES.archer.range, true, true)),
    }]);
    expect(mirror.tower(t.id)!.visibleCells).toHaveLength(1);
    expect(registry.pendingTowerIds()).toEqual([]);
  });

  it('renders the cube fresh from the tip on the top of the plinth, out to the range asked for', () => {
    registry.attach(engine);
    const t = new Tower({ lat: 7, lon: 5, height: 8 }, 'archer', 0, 3);
    frame({ towerStates: [towerDto(t)] });
    needed(t);
    frame();

    expect(mapper.invalidate.mock.invocationCallOrder[0]).toBeLessThan(mapper.update.mock.invocationCallOrder[0]);
    const [tip, far, group] = mapper.update.mock.calls[0];
    const config = TOWER_TYPES.archer;
    expect(tip.toArray()).toEqual([5, 8 + config.heightOffset + config.shootHeight, 7]);
    expect(far).toBe(config.range);
    expect(group).toBe(blockers);
    const ctx = grid.registerTower.mock.calls[0][4] as { farDistance: number; faces: unknown };
    expect(ctx.farDistance).toBe(100);
    // The faces come back to the CPU only when the resolve samples a cell
    expect(mapper.readFacesToCpu).not.toHaveBeenCalled();
    void ctx.faces;
    expect(mapper.readFacesToCpu).toHaveBeenCalledTimes(1);
  });

  it('waits with its renders while the main grid has no cells', () => {
    registry.attach(engine);
    initialized = false;
    const t = place(5, 7);
    needed(t);
    frame();
    expect(grid.registerTower).not.toHaveBeenCalled();
    expect(registry.pendingTowerIds()).toEqual([t.id]);

    initialized = true;
    frame();
    expect(sent).toHaveLength(1);
  });

  it('resolves an upgrade and a retrofit incrementally, at the range asked for', () => {
    registry.attach(engine);
    const t = place(5, 7);
    needed(t, 'upgrade', 45);
    frame();
    expect(grid.registerTowerIncremental.mock.calls[0].slice(0, 4)).toEqual([t.id, 5, 7, 45]);
    expect(grid.registerTower).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ reason: 'upgrade', mask: { range: 45 } });
  });

  it('renders one tower per frame, oldest first; a new request of a tower takes the place of its old one', () => {
    registry.attach(engine);
    const a = place(1, 0);
    const b = place(2, 0);
    needed(a);
    needed(b);
    needed(a, 'retrofit');
    expect(registry.pendingTowerIds()).toEqual([b.id, a.id]);

    frame();
    expect(sent.map((e) => e.towerId)).toEqual([b.id]);
    frame();
    expect(sent.map((e) => [e.towerId, e.reason])).toEqual([[b.id, 'place'], [a.id, 'retrofit']]);
  });

  it('drops a request of a tower the mirror does not have, and keeps one while the cube cannot render', () => {
    registry.attach(engine);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gone = new Tower({ lat: 0, lon: 0, height: 0 }, 'archer');
    needed(gone);
    frame();
    expect(registry.pendingTowerIds()).toEqual([]);

    const t = place(5, 7);
    blockers = null;
    needed(t);
    frame();
    expect(registry.pendingTowerIds()).toEqual([t.id]);
    expect(sent).toEqual([]);
    expect(warn).toHaveBeenCalled();

    blockers = {};
    frame();
    expect(sent).toHaveLength(1);
  });

  it('forgets the requests on a new run, on a new location and of a sold tower', () => {
    registry.attach(engine);
    const t = place(5, 7);
    needed(t);
    bus.emit({ type: 'game:reset' });
    expect(registry.pendingTowerIds()).toEqual([]);

    needed(t);
    registry.attach(engine);
    expect(registry.pendingTowerIds()).toEqual([]);

    needed(t);
    frame({ removedTowers: [t.id] });
    expect(registry.pendingTowerIds()).toEqual([]);
    expect(grid.unregisterTower).toHaveBeenCalledWith(t.id);
    expect(sent).toEqual([]);
  });

  it('leaves a request of a replay alone: its towers take their masks from the log', () => {
    registry.attach(engine);
    const t = place(5, 7);
    bus.setLiveMuted(true);
    needed(t);
    bus.setLiveMuted(false);
    expect(registry.pendingTowerIds()).toEqual([]);
  });

  it('as a coop guest renders nothing and leaves the request queued', () => {
    registry.attach(engine);
    registry.setRole('wait');
    const t = place(5, 7);
    needed(t);
    frame();
    expect(grid.registerTower).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(registry.pendingTowerIds()).toEqual([t.id]);
  });

  it('writes the mask the simulation applied into the main grid, and takes it out again for none', () => {
    registry.attach(engine);
    const t = place(5, 7);
    const mask = losMaskToJson(maskOf(30, true, false));
    frame({ towerStates: [{ ...towerDto(t), losReady: true, losMask: mask }] });
    const [id, x, z, applied] = grid.applyLosMask.mock.calls[0];
    expect([id, x, z]).toEqual([t.id, 5, 7]);
    expect(applied).toMatchObject({ range: 30, ground: true, air: false });
    expect(mirror.tower(t.id)!.visibleCells).toHaveLength(2);

    // A state without a mask leaves the grid as it is
    frame({ towerStates: [towerDto(t)] });
    expect(grid.applyLosMask).toHaveBeenCalledTimes(1);

    frame({ towerStates: [{ ...towerDto(t), losMask: null }] });
    expect(grid.unregisterTower).toHaveBeenCalledWith(t.id);
    expect(mirror.tower(t.id)!.visibleCells).toEqual([]);
  });

  describe('the log of a recompute that takes most cells away', () => {
    const seen = () => Array.from({ length: 10 }, (_, i) => cell(i, 0));
    const recomputeTo = (t: Tower, before: RouteCell[], after: RouteCell[]) => {
      mirror.tower(t.id)!.visibleCells = before;
      grid.registerTowerIncremental.mockReturnValueOnce(after);
      needed(t, 'upgrade');
      frame();
    };

    it('warns once per drop, with the trigger and what the cube saw, and again only after the cells came back', () => {
      registry.attach(engine);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const t = place();

      recomputeTo(t, seen(), []);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain(`${t.id} archer: 0 of 10 visible cells left after a LOS recompute (upgrade)`);
      expect(line).toContain('geometry within 2 m of the tip');

      // Still down: no second line
      recomputeTo(t, seen(), [cell(0, 0)]);
      expect(warn).toHaveBeenCalledTimes(1);

      // Back, then down again
      recomputeTo(t, seen(), seen());
      recomputeTo(t, seen(), []);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('stays quiet when a recompute moves a few answers or the tower saw only a few cells', () => {
      registry.attach(engine);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      recomputeTo(place(), seen(), seen().slice(0, 7));
      recomputeTo(place(50, 0), seen().slice(0, 5), []);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
