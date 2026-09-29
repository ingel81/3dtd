import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';

// Stand-in for the cubemap: a wall at 10 m, so a cell's visibility follows
// its height (same fake as in global-route-grid.spec.ts).
vi.mock('../utils/gpu-cube-resolve', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isCubeVisible: (...args: number[]) => args[4] < 10,
}));
vi.mock('../sim/client/sim-client.service', () => ({ SimClient: class SimClient {} }));

import { Injector, runInInjectionContext } from '@angular/core';
import { TowerLosRegistry } from './tower-los-registry';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { SimClient } from '../sim/client/sim-client.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { packet, towerDto } from '../sim/client/mirror/testing/mirror-packets';
import { createMainEventBus, type MainEventBus } from '../sim/client/view-events';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId } from '../configs/tower-types.config';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import type { ColumnSample } from '../three-engine/column-sample';
import type { SimFramePacket } from '../sim/protocol/packet';
import { getGroundTargetY, type RouteCell } from '../utils/route-cell';

/**
 * A tower's line of sight is resolved on the cells the corridor build froze
 * (CorridorBuild) and keeps those answers: no tile load and no second tower
 * samples a cell again. What still asks for a recompute is a research that
 * gives a tower air targets and a range upgrade (tower:los-needed from the
 * simulation). Runs the real main grid and the real registry; the cubemap,
 * the engine and the frame loop are fakes.
 */
describe('TowerLosRegistry on the frozen cells', () => {
  /** Fake space as in global-route-grid.spec.ts: lon is x, lat is z, height is y. */
  const sync = {
    geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }),
  };
  /** Straight route along +x; the corridor reaches ~7 m either side. */
  const route = [[{ lat: 0, lon: 0 }, { lat: 0, lon: 60 }]];

  let registry: TowerLosRegistry;
  let grid: GlobalRouteGridService;
  let bus: MainEventBus;
  let mirror: SimMirror;
  let frameListeners: ((packet: SimFramePacket) => void)[];
  let column: ColumnSample;
  let peek: { depth: number; geometricError: number };
  let blockerGroup: object | null;

  /** Block-level hull: what the city looks like before refinement. Ground answers: blocked. */
  const coarse = () => {
    column = { groundY: 85, topY: 85, tileDepth: 14, tileGeometricError: 40 };
    peek = { depth: 14, geometricError: 40 };
  };
  /** A finer tile reports the real street. Ground answers: visible. */
  const fine = () => {
    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
  };

  /** One frame: its packet through the mirror, then the SimClient's frame listeners (the registry renders there) */
  const frame = (towerStates = [] as ReturnType<typeof towerDto>[]) => {
    const p = packet({ towerStates });
    mirror.applyState(p);
    mirror.afterFrame(p);
    for (const listener of [...frameListeners]) listener(p);
  };
  const drainFrames = () => {
    for (let i = 0; i < 20; i++) frame();
  };
  /** What the simulation asks for a tower (TowerLos in the worker) */
  const needed = (tower: Tower, reason: 'place' | 'upgrade' | 'retrofit', airUnlocked = false) =>
    bus.emit({
      type: 'tower:los-needed',
      towerId: tower.id,
      reason,
      range: tower.combat.range,
      canTargetGround: tower.typeConfig.canTargetGround ?? true,
      canTargetAir: canTargetAirEffective(tower.typeConfig.id as TowerTypeId, airUnlocked),
    });

  /** The simulation placed it and asks for its sight; the next frame renders it */
  const place = (lon: number, lat: number, typeId: TowerTypeId = 'archer'): Tower => {
    const tower = new Tower({ lat, lon, height: 0 }, typeId);
    frame([towerDto(tower)]);
    needed(tower, 'place');
    frame();
    return tower;
  };

  const cellsOf = (tower: Tower): RouteCell[] =>
    grid.getCellsInRange(tower.position.lon, tower.position.lat, tower.combat.range);

  /** Cells in range whose ground answer does not match the cell's current height. */
  const staleAnswers = (tower: Tower): RouteCell[] =>
    cellsOf(tower).filter(
      (c) => c.towerVisibility.get(tower.id) !== (getGroundTargetY(c) < 10),
    );

  beforeEach(() => {
    grid = new GlobalRouteGridService();
    // The cells as a corridor build left them: sampled once, then frozen.
    coarse();
    grid.initialize((() => column) as never, sync as never, () => peek);
    grid.generateFromRoutes(route as never);

    const referencePos = new Vector3();
    const mapper = {
      invalidate: vi.fn(),
      update: vi.fn((tip: Vector3) => referencePos.copy(tip)),
      getRenderTarget: () => ({}),
      getReferencePos: () => referencePos,
      getFarDistance: () => 100,
      readFacesToCpu: () => [],
    };
    blockerGroup = {};
    const engine = { sync, getLosBlockerGroup: () => blockerGroup, getTowerShadowMapper: () => mapper };

    bus = createMainEventBus();
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
    const injector = Injector.create({
      providers: [
        { provide: GlobalRouteGridService, useValue: grid },
        { provide: SimClient, useValue: sim },
      ],
    });
    registry = runInInjectionContext(injector, () => new TowerLosRegistry());
    registry.attach(engine as never);
  });

  afterEach(() => {
    registry.detach();
    vi.restoreAllMocks();
  });

  it('resolves a tower on the cells as they are, with answers for their heights', () => {
    const a = place(15, 10);

    expect(cellsOf(a).length).toBeGreaterThan(0);
    expect(staleAnswers(a)).toEqual([]);
    // The hull at 85 m stands behind the wall at 10 m: every cell blocked.
    expect(cellsOf(a).every((c) => c.towerVisibility.get(a.id) === false)).toBe(true);
  });

  it('samples no cell and moves no answer when finer tiles come in under a standing tower', () => {
    const a = place(15, 10);
    const heights = cellsOf(a).map((c) => c.terrainHeight);

    fine();
    drainFrames();

    expect(cellsOf(a).map((c) => c.terrainHeight)).toEqual(heights);
    expect(staleAnswers(a)).toEqual([]);
  });

  it('leaves the cells of the towers standing alone when another tower is placed on finer tiles', () => {
    const a = place(15, 10);
    fine();

    place(40, 10);
    drainFrames();

    expect(cellsOf(a).every((c) => c.terrainHeight === 85)).toBe(true);
    expect(staleAnswers(a)).toEqual([]);
  });

  it('resolves air for a retrofitted tower once the simulation asks with the research done', () => {
    const gatling = place(15, 10, 'dual-gatling');
    expect(cellsOf(gatling).some((c) => c.airVisibility.has(gatling.id))).toBe(false);

    needed(gatling, 'retrofit', true);
    drainFrames();

    expect(cellsOf(gatling).every((c) => c.airVisibility.has(gatling.id))).toBe(true);
  });

  it('keeps a tower queued while its cube cannot render, then resolves it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tower = new Tower({ lat: 10, lon: 15, height: 0 }, 'archer');
    frame([towerDto(tower)]);
    blockerGroup = null;
    needed(tower, 'place');
    frame();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no LOS blocker group'));
    expect(registry.pendingTowerIds()).toEqual([tower.id]);

    blockerGroup = {};
    drainFrames();
    expect(registry.pendingTowerIds()).toEqual([]);
    expect(cellsOf(tower).length).toBeGreaterThan(0);
    expect(staleAnswers(tower)).toEqual([]);
  });
});
