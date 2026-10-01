/**
 * The presentation from real packets (docs/SIM_WORKER.md): a real SimCore
 * behind the SimClient in one thread, the real SimMirror and the real
 * PresentationHost on the main side, over a stand-in engine that records
 * what the renderers get. An archer placed by command, its line of sight
 * answered, a wave of zombies it kills: the tower's model with the shadow
 * tower's aim, the enemies' instances fed from the table, the arrows, the
 * death clips, the veteran badge from the kills (playtest 347).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The presentation services have specs of their own; here the host's wiring and the tables
vi.mock('../game-engine/vfx.service', () => ({ VFXService: class { destroy = vi.fn(); } }));
vi.mock('../game-engine/audio.service', () => ({
  AudioService: class {
    setGround = vi.fn();
    update = vi.fn();
    clearAbilitySounds = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../game-engine/game-sounds.service', () => ({
  GameSoundsService: class {
    setGameSpeedSource = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../game-engine/screen-shake.service', () => ({ ScreenShakeService: class { destroy = vi.fn(); } }));
vi.mock('../game-engine/background-music.service', () => ({
  BackgroundMusicService: class {
    setGameSpeedSource = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../game-engine/blood-moon.service', () => ({ BloodMoonService: class { destroy = vi.fn(); } }));

import { Injector } from '@angular/core';
import { Vector3 } from 'three';
import { SimClient } from '../sim/client/sim-client.service';
import { InlineTransport } from '../sim/client/transport';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { SimCore } from '../sim/core/sim-core';
import { OriginSync } from '../sim/core/sim-coords';
import { worldKeyOf } from '../sim/protocol/world-key';
import type { SimWorld } from '../sim/protocol/messages';
import { GameStore } from '../store/game.store';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { losMaskToJson } from '../utils/los-mask';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { veteranLevel } from '../configs/veteran-ranks.config';
import { withAutoStubs } from '../integration/test-helpers';
import { PresentationHost } from './presentation-host';
import type { RouteWaypoint } from '../models/game.types';
import type { ThreeTilesEngine } from '../three-engine';
import type { ViewEvent } from '../sim/client/view-events';
import { GameClock } from '../managers/game-state/game-clock';

const ORIGIN = { lat: 48.7758, lon: 9.1829, height: 300 };

function mainWorld(): { world: SimWorld; grid: GlobalRouteGridService; sync: OriginSync } {
  const sync = new OriginSync(ORIGIN.lat, ORIGIN.lon, ORIGIN.height);
  const route: RouteWaypoint[] = Array.from({ length: 61 }, (_, i) => ({
    lat: ORIGIN.lat + (i * 10) / M,
    lon: ORIGIN.lon,
    height: ORIGIN.height,
    corridorLeft: 3,
    corridorRight: 3,
  }));
  const paths = new Map<string, RouteWaypoint[]>([['spawn-1', route]]);
  const grid = new GlobalRouteGridService();
  grid.initialize(() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 }), sync);
  grid.generateFromRoutes([...paths.values()]);
  const spawns = [...paths].map(([id, path]) => ({ id, name: id, ...path[0] }));
  return {
    grid,
    sync,
    world: {
      origin: ORIGIN,
      hq: { ...route[route.length - 1] },
      spawns,
      paths: [...paths],
      heights: grid.exportHeights(),
      worldKey: worldKeyOf(grid.snapshotHeights(), paths.values(), sync.getOrigin()),
      spawnGround: Object.fromEntries(spawns.map((s) => [s.id, ORIGIN.height])),
    },
  };
}

/** A stand-in engine: every renderer member a vi.fn on first use, besides what answers */
function standInEngine(sync: OriginSync) {
  const slots = new Map<string, { isWalking: boolean; released: boolean }>();
  let handles = 0;
  const members: Record<string, object> = {
    sync,
    enemies: withAutoStubs({
      create: vi.fn(() => Promise.resolve({})),
      resolveSlot: vi.fn((id: string) => {
        let slot = slots.get(id);
        if (!slot) slots.set(id, (slot = { isWalking: true, released: false }));
        return slot;
      }),
      remove: vi.fn((id: string) => {
        const slot = slots.get(id);
        if (slot) slot.released = true;
      }),
    }),
    towers: withAutoStubs({ get: vi.fn(() => ({ lat: ORIGIN.lat, lon: ORIGIN.lon, height: ORIGIN.height, tipY: 8 })) }),
    // What the presenter reads of the projectiles besides calling them
    projectiles: withAutoStubs({ lastOffset: new Vector3(), landed: [], landingNow: [] }),
    spatialAudio: withAutoStubs({
      createLoop: vi.fn(() => Promise.resolve(++handles)),
      playAt: vi.fn(() => Promise.resolve(null)),
      playAtGeo: vi.fn(() => Promise.resolve(null)),
      getListener: () => ({ getWorldPosition: (v: Vector3) => v.set(0, 0, 0) }),
    }),
  };
  const engine = new Proxy(members, {
    get(obj, prop: string) {
      if (!(prop in obj)) obj[prop] = withAutoStubs({});
      return obj[prop];
    },
  });
  return engine as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
}

describe('The presentation of a wave from real packets', () => {
  let client: SimClient;
  let mirror: SimMirror;
  let main: ReturnType<typeof mainWorld>;
  let engine: ReturnType<typeof standInEngine>;
  let host: PresentationHost;
  let now = 1000;
  const events: ViewEvent[] = [];

  const frames = (n: number) => {
    for (let i = 0; i < n; i++) client.frame((now += GameClock.FIXED_STEP_MS), true);
  };

  beforeEach(() => {
    vi.spyOn(console, 'error');
    const injector = Injector.create({
      providers: [
        { provide: GameStore, useFactory: () => new GameStore(), deps: [] },
        { provide: SimClient, useFactory: () => new SimClient(), deps: [] },
      ],
    });
    client = injector.get(SimClient);
    injector.get(GameStore).gameSpeed.set(10);
    mirror = new SimMirror();
    main = mainWorld();
    mirror.setWorld(main.world.spawns.map((s) => s.id), new Map(main.world.paths));
    engine = standInEngine(main.sync);
    host = new PresentationHost({ engine: engine as unknown as ThreeTilesEngine, bus: client.bus, source: mirror, ground: main.grid });
    client.attach(mirror, host);
    client.start((handlers) => new InlineTransport(new SimCore(), handlers));
    client.loadWorld(main.world);
    events.length = 0;
    client.bus.onAny((event) => events.push(event));
  });

  afterEach(() => {
    host.destroy();
    vi.restoreAllMocks();
  });

  it('shows the tower, the enemies, the arrows, the deaths and the badge the kills earn', () => {
    frames(2);
    client.bus.emit({ type: 'debug:add-credits', amount: 5000 });
    const at = { lat: ORIGIN.lat + 150 / M, lon: ORIGIN.lon + 6 / (M * Math.cos((ORIGIN.lat * Math.PI) / 180)), height: ORIGIN.height };
    client.bus.emit({ type: 'command:place-tower', position: at, typeId: 'archer' });
    frames(2);

    // The tower's model turns by the shadow tower's aim, which the mirror sets every frame
    const tower = mirror.towers()[0];
    expect(engine['towers']['create']).toHaveBeenCalledTimes(1);
    expect(engine['towers']['create'].mock.calls[0][0]).toBe(tower.id);
    expect(engine['towers']['create'].mock.calls[0][6]).toBe(mirror.tower(tower.id)!.aim);

    // Everything in range visible, from the main thread's grid
    const needed = events.find((e) => e.type === 'tower:los-needed') as Extract<ViewEvent, { type: 'tower:los-needed' }>;
    const local = main.sync.geoToLocalSimple(tower.position.lat, tower.position.lon, 0);
    for (const cell of main.grid.getCellsInRange(local.x, local.z, needed.range)) cell.towerVisibility.set(tower.id, true);
    const mask = main.grid.encodeLosMask(tower.id, local.x, local.z, needed.range, needed.canTargetGround, needed.canTargetAir);
    client.bus.emit({ type: 'command:los-mask', towerId: tower.id, reason: 'place', mask: losMaskToJson(mask) });
    frames(2);

    client.bus.emit({
      type: 'command:start-wave',
      config: { schedule: { entries: Array.from({ length: 14 }, () => ({ enemyType: 'zombie', speed: 1, health: 0.3 })), baseDelay: 300, spawnMode: 'each' } },
    });
    frames(2);
    for (let i = 0; i < 20000 && mirror.scalars.phase !== 'setup'; i++) frames(1);
    frames(1);

    // Each enemy got its instance on its walk clip, and the table fed it on the route
    const created = engine['enemies']['create'].mock.calls.map((c) => c[0] as string);
    expect(created.length).toBe(14);
    expect(engine['enemies']['resolveSlot']).toHaveBeenCalled();
    const pushed = engine['enemies']['updateSlot'].mock.calls;
    expect(pushed.length).toBeGreaterThan(14);
    for (const [, pos] of pushed.slice(0, 50) as unknown as [unknown, Vector3][]) {
      // On the 600 m route from the origin, in its corridor, on the ground there
      expect(Math.abs(pos.x)).toBeLessThan(5);
      expect(Math.abs(pos.z)).toBeLessThan(601);
      expect(Math.abs(pos.y)).toBeLessThan(3);
    }

    // The arrows flew in the table: moved and streaked every frame
    expect(engine['projectiles']['create']).toHaveBeenCalled();
    const moved = engine['projectiles']['update'].mock.calls.length + engine['projectiles']['updateWithRotation'].mock.calls.length;
    expect(moved).toBeGreaterThan(0);
    expect(engine['trailStreaks']['pushPosition']).toHaveBeenCalled();

    // The killed ones played their death, then went
    const kills = mirror.tower(tower.id)!.combat.kills;
    expect(kills).toBeGreaterThanOrEqual(10);
    expect(engine['enemies']['playDeathAnimation'].mock.calls.length).toBe(kills);
    expect(engine['enemies']['remove'].mock.calls.length).toBe(14);

    // The badge follows the kills: the last rank set is the rank of the kills
    const ranks = engine['towerBadges']['setRank'].mock.calls.filter((c) => c[0] === tower.id);
    expect(ranks[ranks.length - 1][1]).toBe(veteranLevel(kills));
    expect(veteranLevel(kills)).toBeGreaterThan(0);

    // No op fell through to a missing engine member or failed
    expect(console.error).not.toHaveBeenCalled();
  });
});
