/**
 * Playtest points 320 and 335 of night 2 (docs/archive/REVIEW_SPRINT_2026-09-14.md),
 * what a strike shows and sounds like, from real packets: a real SimCore
 * behind the SimClient in one thread, the real SimMirror, the real
 * PresentationHost with its real VFXService and AudioService over a
 * stand-in engine that records the ability renderers and the one-shots.
 *
 * 320: a restart during the warning leaves no marker, cloud or rumble; a
 *      restart right after the impact cuts the rumbling tail.
 * 335: the quieter repeats of the strike's sound wait out a pause and come
 *      sooner at 4x (in game time: SimClient hands the frame's game time to
 *      PresentationHost.advance).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

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
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { GAME_SOUNDS } from '../configs/audio.config';
import { withAutoStubs } from '../integration/test-helpers';
import { PresentationHost } from './presentation-host';
import type { RouteWaypoint } from '../models/game.types';
import type { ThreeTilesEngine } from '../three-engine';
import type { ViewEvent } from '../sim/client/view-events';

const ORIGIN = { lat: 48.7758, lon: 9.1829, height: 300 };
const LON_PER_M = 1 / (M * Math.cos((ORIGIN.lat * Math.PI) / 180));
const NUKE = GAME_SOUNDS.nuclearStrike;
const TAIL = NUKE.tail;
/** The blast and the samples of its tail */
const STRIKE_SOUNDS = new Set<string>([NUKE.id, ...TAIL.map((repeat) => (repeat.sample ?? NUKE).id)]);

type Mock = ReturnType<typeof vi.fn>;

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
  let handles = 0;
  const members: Record<string, object> = {
    sync,
    enemies: withAutoStubs({ create: vi.fn(() => Promise.resolve({})), resolveSlot: vi.fn(() => null) }),
    towers: withAutoStubs({ get: vi.fn(() => undefined) }),
    // What the presenter reads of the projectiles besides calling them
    projectiles: withAutoStubs({ lastOffset: new Vector3(), landed: [], landingNow: [] }),
    spatialAudio: withAutoStubs({
      createLoop: vi.fn(() => Promise.resolve(++handles)),
      playAt: vi.fn(() => Promise.resolve(null)),
      playAtGeo: vi.fn(() => Promise.resolve(null)),
      geoToLocalPosition: (lat: number, lon: number, height: number, target = new Vector3()) =>
        sync.geoToLocalSimpleInto(lat, lon, height, target),
      getListener: () => ({ getWorldPosition: (v: Vector3) => v.set(0, 0, 0) }),
    }),
  };
  const engine = new Proxy(members, {
    get(obj, prop: string) {
      if (!(prop in obj)) obj[prop] = withAutoStubs({});
      return obj[prop];
    },
  });
  return engine as unknown as Record<string, Record<string, Mock>>;
}

/** A game at `speed` with the nuclear strike researched and charged, a silo standing and a wave of walkers on the route. */
function createGame(speed: number) {
  const injector = Injector.create({
    providers: [
      { provide: GameStore, useFactory: () => new GameStore(), deps: [] },
      { provide: SimClient, useFactory: () => new SimClient(), deps: [] },
    ],
  });
  const client = injector.get(SimClient);
  const store = injector.get(GameStore);
  store.gameSpeed.set(speed);
  const mirror = new SimMirror();
  const main = mainWorld();
  mirror.setWorld(main.world.spawns.map((s) => s.id), new Map(main.world.paths));
  const engine = standInEngine(main.sync);
  const host = new PresentationHost({ engine: engine as unknown as ThreeTilesEngine, bus: client.bus, source: mirror, ground: main.grid });
  client.attach(mirror, host);
  client.start((handlers) => new InlineTransport(new SimCore(), handlers));
  client.loadWorld(main.world);
  const events: ViewEvent[] = [];
  client.bus.onAny((event) => events.push(event));

  let now = 1000;
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) client.frame((now += 16), true);
  };
  frames(2);
  client.bus.emit({ type: 'debug:add-credits', amount: 1_000_000 });
  client.bus.emit({ type: 'debug:complete-all-research' });
  client.bus.emit({
    type: 'command:place-tower',
    position: { lat: ORIGIN.lat + 50 / M, lon: ORIGIN.lon + 40 * LON_PER_M, height: ORIGIN.height },
    typeId: 'missile-silo',
  });
  frames(2);
  client.bus.emit({ type: 'debug:ready-ability', abilityId: 'nuclear-strike' });
  client.bus.emit({
    type: 'command:start-wave',
    config: { schedule: { entries: Array.from({ length: 6 }, () => ({ enemyType: 'tank', speed: 0.2, health: 50 })), baseDelay: 300, spawnMode: 'each' } },
  });
  frames(4);

  const played = engine['spatialAudio']['playAtGeo'];
  const impacts = () => events.filter((e) => e.type === 'ability:impact').length;
  /** The one-shots at the impact and after it: the blast and its tail, not the missile's or the silo's */
  const strikeSounds = () => played.mock.calls.filter((call) => STRIKE_SOUNDS.has(call[0] as string));
  const fire = () => {
    client.bus.emit({ type: 'command:use-ability', abilityId: 'nuclear-strike', target: { lat: ORIGIN.lat + 200 / M, lon: ORIGIN.lon } });
    frames(2);
  };
  const untilImpact = () => {
    for (let i = 0; i < 5000 && impacts() === 0; i++) frames(1);
  };
  return { client, store, host, engine, events, frames, fire, untilImpact, impacts, strikeSounds };
}

describe('What a strike shows from real packets, playtest 320 and 335 (night 2)', () => {
  let game: ReturnType<typeof createGame> | null = null;

  afterEach(() => {
    game?.host.destroy();
    game = null;
  });

  describe('320: restart', () => {
    it('during the warning: marker and cloud go, nothing lands or rumbles after it', () => {
      const g = (game = createGame(1));
      g.fire();
      expect(g.events.some((e) => e.type === 'ability:used')).toBe(true);
      expect(g.engine['abilityMarkers']['showStrike']).toHaveBeenCalledTimes(1);

      g.client.bus.emit({ type: 'command:restart-game' });
      g.frames(2);
      expect(g.engine['abilityMarkers']['clear']).toHaveBeenCalled();
      expect(g.engine['mushroomClouds']['clear']).toHaveBeenCalled();

      g.frames(900);
      expect(g.impacts()).toBe(0);
      expect(g.engine['mushroomClouds']['detonate']).not.toHaveBeenCalled();
      expect(g.strikeSounds()).toEqual([]);
    });

    it('right after the impact: the rumbling tail is cut', () => {
      const g = (game = createGame(1));
      g.fire();
      g.untilImpact();
      expect(g.strikeSounds()).toHaveLength(1);

      g.client.bus.emit({ type: 'command:restart-game' });
      g.frames(600);
      expect(g.strikeSounds()).toHaveLength(1);
    });
  });

  describe('335: the tail in game time', () => {
    /** Frames from the impact until the last repeat played; with `pauseFrames` paused in the frame after the impact */
    const tailRun = (speed: number, pauseFrames = 0) => {
      const g = (game = createGame(speed));
      g.fire();
      g.untilImpact();
      const atImpact = g.strikeSounds().length;
      let heardInPause = 0;
      if (pauseFrames > 0) {
        g.store.paused.set(true);
        g.frames(pauseFrames);
        heardInPause = g.strikeSounds().length - atImpact;
        g.store.paused.set(false);
      }
      let frames = 0;
      while (g.strikeSounds().length < 1 + TAIL.length && frames < 2000) {
        g.frames(1);
        frames++;
      }
      const volumes = g.strikeSounds().map((call) => call[4]);
      g.host.destroy();
      game = null;
      return { atImpact, heardInPause, frames, volumes };
    };

    it('plays the impact, then the quieter pieces of its tail', () => {
      expect(tailRun(1).volumes).toEqual([1, ...TAIL.map((r) => r.volume)]);
    });

    it('P right after the impact: the repeats wait for the resume, then come as without the pause', () => {
      const straight = tailRun(1);
      const paused = tailRun(1, 600);
      expect(paused.atImpact).toBe(1);
      expect(paused.heardInPause).toBe(0);
      expect(Math.abs(paused.frames - straight.frames)).toBeLessThanOrEqual(1);
    });

    it('at 4x the tail is over in about a quarter of the wall time', () => {
      const single = tailRun(1).frames;
      const fourfold = tailRun(4).frames;
      expect(single).toBeGreaterThan(40);
      expect(fourfold).toBeGreaterThanOrEqual(Math.floor(single / 4) - 2);
      expect(fourfold).toBeLessThanOrEqual(Math.ceil(single / 4) + 2);
    });
  });
});
