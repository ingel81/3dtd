/**
 * The whole chain in one thread (docs/SIM_WORKER.md): the SimClient over an
 * InlineTransport to a real SimCore, the real SimMirror on the main side. A
 * world like the main thread sends, a tower placed by command that waits for
 * its line of sight, the answer as command:los-mask, a wave it fights: what
 * the main thread's bus, mirror and shadow tower show of it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Injector } from '@angular/core';
import { SimClient } from './sim-client.service';
import { InlineTransport } from './transport';
import { SimMirror } from './mirror/sim-mirror';
import { SimCore } from '../core/sim-core';
import { OriginSync } from '../core/sim-coords';
import { worldKeyOf } from '../protocol/world-key';
import type { SimWorld } from '../protocol/messages';
import { GameStore } from '../../store/game.store';
import { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import { losMaskToJson } from '../../utils/los-mask';
import { METERS_PER_DEGREE_LAT as M } from '../../utils/geo-utils';
import type { RouteWaypoint } from '../../models/game.types';
import type { TowerTypeId } from '../../configs/tower-types.config';
import type { ViewEvent } from './view-events';

const ORIGIN = { lat: 48.7758, lon: 9.1829, height: 300 };

/** Two routes north, a waypoint every 10 m, and the main thread's grid over them (flat ground at the origin's height). */
function mainWorld(): { world: SimWorld; grid: GlobalRouteGridService; sync: OriginSync } {
  const sync = new OriginSync(ORIGIN.lat, ORIGIN.lon, ORIGIN.height);
  const lonPerM = 1 / (M * Math.cos((ORIGIN.lat * Math.PI) / 180));
  const route = (eastM: number): RouteWaypoint[] => Array.from({ length: 61 }, (_, i) => ({
    lat: ORIGIN.lat + (i * 10) / M,
    lon: ORIGIN.lon + eastM * lonPerM,
    height: ORIGIN.height,
    corridorLeft: 3,
    corridorRight: 3,
  }));
  const paths = new Map<string, RouteWaypoint[]>([['spawn-1', route(0)], ['spawn-2', route(200)]]);
  const grid = new GlobalRouteGridService();
  grid.initialize(() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 }), sync);
  grid.generateFromRoutes([...paths.values()]);
  const spawns = [...paths].map(([id, path]) => ({ id, name: id, ...path[0] }));
  const last = paths.get('spawn-1')!;
  return {
    grid,
    sync,
    world: {
      origin: ORIGIN,
      hq: { ...last[last.length - 1] },
      spawns,
      paths: [...paths],
      heights: grid.exportHeights(),
      worldKey: worldKeyOf(grid.snapshotHeights(), paths.values(), sync.getOrigin()),
      spawnGround: Object.fromEntries(spawns.map((s) => [s.id, ORIGIN.height])),
    },
  };
}

describe('SimClient to SimCore in one thread', () => {
  let client: SimClient;
  let mirror: SimMirror;
  let main: ReturnType<typeof mainWorld>;
  let now = 1000;
  const events: ViewEvent[] = [];

  const frames = (n: number) => {
    for (let i = 0; i < n; i++) client.frame((now += 16.667), false);
  };

  beforeEach(() => {
    const injector = Injector.create({
      providers: [
        { provide: GameStore, useFactory: () => new GameStore(), deps: [] },
        { provide: SimClient, useFactory: () => new SimClient(), deps: [] },
      ],
    });
    client = injector.get(SimClient);
    // Waves of slow walkers over 600 m: at speed 10 a frame runs ten sub-steps
    injector.get(GameStore).gameSpeed.set(10);
    mirror = new SimMirror();
    main = mainWorld();
    mirror.setWorld(main.world.spawns.map((s) => s.id), new Map(main.world.paths));
    client.attach(mirror, null);
    const core = new SimCore();
    client.start((handlers) => new InlineTransport(core, handlers));
    client.loadWorld(main.world);
    events.length = 0;
    client.bus.onAny((event) => events.push(event));
  });

  it('places a tower that waits for its line of sight, takes the answer and fights a wave', () => {
    frames(2);
    client.bus.emit({ type: 'debug:add-credits', amount: 5000 });
    const at = { lat: ORIGIN.lat + 150 / M, lon: ORIGIN.lon + 9 / (M * Math.cos((ORIGIN.lat * Math.PI) / 180)), height: ORIGIN.height };
    client.bus.emit({ type: 'command:place-tower', position: at, typeId: 'archer' });
    frames(2);

    const placed = events.find((e) => e.type === 'tower:placed');
    expect(placed).toBeDefined();
    const tower = mirror.towers()[0];
    expect(tower).toBeDefined();
    expect(tower.losReady).toBe(false);
    const needed = events.find((e) => e.type === 'tower:los-needed');
    expect(needed).toMatchObject({ towerId: tower.id, reason: 'place' });

    // The main thread's answer: everything in range visible, from its own grid
    const local = main.sync.geoToLocalSimple(tower.position.lat, tower.position.lon, 0);
    const request = needed as Extract<ViewEvent, { type: 'tower:los-needed' }>;
    for (const cell of main.grid.getCellsInRange(local.x, local.z, request.range)) {
      cell.towerVisibility.set(tower.id, true);
      if (canTargetAirEffective(tower.typeConfig.id as TowerTypeId, false)) cell.airVisibility.set(tower.id, true);
    }
    const mask = main.grid.encodeLosMask(tower.id, local.x, local.z, request.range, request.canTargetGround, request.canTargetAir);
    client.bus.emit({ type: 'command:los-mask', towerId: tower.id, reason: 'place', mask: losMaskToJson(mask) });
    frames(2);
    expect(mirror.tower(tower.id)!.losReady).toBe(true);

    client.bus.emit({
      type: 'command:start-wave',
      config: { schedule: { entries: Array.from({ length: 8 }, () => ({ enemyType: 'zombie', speed: 1, health: 0.5 })), baseDelay: 400, spawnMode: 'each' } },
    });
    // The command acts with the next tick; then the wave runs until it is over
    frames(2);
    expect(mirror.scalars.phase).toBe('wave');
    for (let i = 0; i < 20000 && mirror.scalars.phase !== 'setup'; i++) frames(1);
    frames(1);

    expect(events.some((e) => e.type === 'wave:started')).toBe(true);
    const deaths = events.filter((e): e is Extract<ViewEvent, { type: 'enemy:died' }> => e.type === 'enemy:died');
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    expect(deaths.length, JSON.stringify({ counts, scalars: mirror.scalars, tower: { losReady: mirror.tower(tower.id)!.losReady } })).toBeGreaterThan(0);
    // The listener reads a view with the entity's paths
    expect(deaths[0].enemy.typeConfig.id).toBe('zombie');
    expect(deaths[0].enemy.position.lat).toBeGreaterThan(ORIGIN.lat);
    expect(mirror.tower(tower.id)!.combat.kills).toBeGreaterThan(0);
    expect(mirror.scalars.phase, JSON.stringify({ counts, scalars: mirror.scalars, enemies: mirror.enemies().map((e) => [e.id, e.movement.routeId, e.position.lat, e.position.lon, e.movement.progress, e.movement.distanceAlongPath, e.flags, e.animSpeed]) })).toBe('setup');
    expect(mirror.scalars.waveNumber).toBe(1);
  });
});
