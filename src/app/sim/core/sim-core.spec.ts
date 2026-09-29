/**
 * SimCore in the same thread, end to end (docs/SIM_WORKER.md): a world as the
 * main thread hands it over (routes, cell heights, key), towers placed by
 * command, their lines of sight asked for and answered as the main thread's
 * TowerLosRegistry does, a wave, and the packets on the way. Then the wave's
 * replay file re-simulated in a fresh SimCore: bit for bit, every hash.
 *
 * The real Injector and inject(): only the decorators are identity, as the
 * specs run without the Angular compiler.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return { ...actual, Injectable: () => (target: unknown) => target };
});

import { SimCore } from './sim-core';
import { OriginSync } from './sim-coords';
import { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import { buildRoute } from '../../integration/sim-step-bench';
import { worldKeyOf } from '../protocol/world-key';
import { losMaskToJson } from '../../utils/los-mask';
import { METERS_PER_DEGREE_LAT as M } from '../../utils/geo-utils';
import { mulberry32 } from '../../utils/game-rng';
import { GameObject } from '../../core/game-object';
import type { SimWorld, SimTickInput, SimOutput, QueuedCommand } from '../protocol/messages';
import { TICK_SUB_STEPS } from '../../coop/lockstep';
import type { SimFramePacket } from '../protocol/packet';
import { ENEMY_STRIDE, E_FLAGS, EF_ALIVE, TOWER_STRIDE, T_KILLS } from '../protocol/packet';
import type { LosNeededPayload } from '../protocol/events';
import type { CommandData } from '../../managers/game-state/command-data';
import type { WaveConfig } from '../../managers/wave.manager';

const SEED = 0x51c0;
const HEAD = { configHash: 'spec', gameVersion: 'spec', commit: 'spec' };
const HERE = { configHash: 'spec', gameVersion: 'spec' };

/** The main thread's side of the world: its grid (for the lines of sight) and the SimWorld it sends */
function mainWorld(): { world: SimWorld; grid: GlobalRouteGridService; sync: OriginSync } {
  const sync = new OriginSync(0, 0, 0);
  const routes = [buildRoute(0, 400), buildRoute(200, 400)];
  const grid = new GlobalRouteGridService();
  grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 })) as never, sync);
  grid.generateFromRoutes(routes);
  const spawns = routes.map((route, i) => ({ id: `spawn-${i + 1}`, name: `Spawn ${i + 1}`, ...route[0] }));
  const world: SimWorld = {
    origin: { lat: 0, lon: 0, height: 0 },
    hq: routes[0][routes[0].length - 1],
    spawns,
    paths: routes.map((route, i) => [`spawn-${i + 1}`, route]),
    heights: grid.exportHeights(),
    worldKey: worldKeyOf(grid.snapshotHeights(), routes, sync.getOrigin()),
    spawnGround: { 'spawn-1': 0, 'spawn-2': 0 },
  };
  return { world, grid, sync };
}

/** A clear view on the main grid, as TowerLosRegistry answers a request with nothing in the way */
function answer(main: ReturnType<typeof mainWorld>, core: SimCore, need: LosNeededPayload): CommandData {
  const tower = core.gsm.towerManager.getById(need.towerId)!;
  const { x, z } = main.sync.geoToLocalSimple(tower.position.lat, tower.position.lon, 0);
  for (const cell of main.grid.getCellsInRange(x, z, need.range)) {
    if (need.canTargetGround) cell.towerVisibility.set(need.towerId, true);
    if (need.canTargetAir) cell.airVisibility.set(need.towerId, true);
  }
  const mask = main.grid.encodeLosMask(need.towerId, x, z, need.range, need.canTargetGround, need.canTargetAir);
  return {
    type: 'command:los-mask', towerId: need.towerId, reason: need.reason, mask: losMaskToJson(mask), generation: need.generation,
  } as unknown as CommandData;
}

const wave: WaveConfig = {
  schedule: {
    entries: Array.from({ length: 24 }, (_, i) => ({ enemyType: i % 3 === 2 ? 'bat' : 'zombie', speed: 1, health: 1 })),
    baseDelay: 400,
    spawnMode: 'random',
  } as WaveConfig['schedule'],
};

/** Drives a core like the SimClient: a tick per frame, commands with it, the packets kept. */
class Driver {
  now = 1000;
  packets: SimFramePacket[] = [];
  private queued: QueuedCommand[] = [];

  constructor(readonly core: SimCore) {}

  send(command: object): void {
    this.queued.push({ playerId: 'local', command: command as CommandData });
  }

  tick(overrides: Partial<SimTickInput> = {}): SimFramePacket {
    this.now += 16.667;
    const commands = this.queued;
    this.queued = [];
    const packet = this.core.tick({
      now: this.now, gameSpeed: 4, paused: false, renderingEnabled: true, commands, lockstep: null, replay: null,
      ...overrides,
    }, () => undefined);
    this.packets.push(packet);
    return packet;
  }

  /** The line-of-sight requests of a packet */
  needs(packet: SimFramePacket): LosNeededPayload[] {
    return packet.events.filter((e) => e.type === 'tower:los-needed').map((e) => e.payload as unknown as LosNeededPayload);
  }
}

function newCore(world: SimWorld): SimCore {
  GameObject.resetIdCounter();
  const core = new SimCore();
  core.rpc('reset', SEED);
  core.loadWorld(world);
  return core;
}

describe('SimCore in the same thread', () => {
  it('refuses a world whose key it does not come to', () => {
    const { world } = mainWorld();
    const core = new SimCore();
    expect(() => core.loadWorld({ ...world, worldKey: 'another' })).toThrow(/world key/);
  });

  it('plays a wave from commands to packets, answers lines of sight by command, and re-simulates it bit for bit', () => {
    const mathRandom = Math.random;
    Math.random = mulberry32(SEED + 1);
    try {
      const main = mainWorld();
      const core = newCore(main.world);
      const drive = new Driver(core);
      expect(core.rpc('worldKey')).toBe(main.world.worldKey);

      drive.send({ type: 'debug:add-credits', amount: 5000 });
      drive.send({ type: 'debug:complete-all-research' });
      drive.send({ type: 'command:place-tower', typeId: 'archer', position: { lat: 60 / M, lon: 9 / M, height: 0 } });
      drive.send({ type: 'command:place-tower', typeId: 'cannon', position: { lat: 140 / M, lon: -9 / M, height: 0 } });
      drive.send({ type: 'command:place-tower', typeId: 'ice', position: { lat: 100 / M, lon: 191 / M, height: 0 } });
      let packet = drive.tick();

      // Placed, not ready: each waits for its sight
      expect(packet.towerStates.map((s) => [s.typeId, s.losReady])).toEqual([['archer', false], ['cannon', false], ['ice', false]]);
      expect(packet.ops.filter((op) => op[0] === 'towers.create')).toHaveLength(3);
      const needs = drive.needs(packet);
      expect(needs.map((n) => n.reason)).toEqual(['place', 'place', 'place']);
      expect(packet.events.every((e) => e.live && e.show)).toBe(true);

      // The main thread renders and answers; the masks act at the next tick
      for (const need of needs) drive.send(answer(main, core, need));
      packet = drive.tick();
      expect(packet.towerStates.map((s) => s.losReady)).toEqual([true, true, true]);
      expect(packet.towerStates.every((s) => s.losMask && s.losMask.bits.length > 0)).toBe(true);
      expect(packet.events.filter((e) => e.type === 'tower:los-resolved')).toHaveLength(3);

      // Nothing changed: no tower state goes again
      packet = drive.tick();
      expect(packet.towerStates).toEqual([]);
      expect(packet.towers.count).toBe(3);

      drive.send({ type: 'command:start-wave', config: wave });
      let sawEnemies = 0;
      for (let f = 0; f < 20000; f++) {
        packet = drive.tick();
        if (packet.scalars.phase !== 'wave' && f > 0) break;
        sawEnemies = Math.max(sawEnemies, packet.enemies.count);
      }
      expect(packet.scalars.phase).toBe('setup');
      expect(sawEnemies).toBeGreaterThan(0);
      const ops = new Set(drive.packets.flatMap((p) => p.ops.map((op) => op[0])));
      for (const path of ['enemies.create', 'enemies.remove', 'projectiles.create', 'effects.spawnFloatingText']) {
        expect(ops.has(path), path).toBe(true);
      }
      const kills = Array.from({ length: packet.towers.count }, (_, i) => packet.towers.data[i * TOWER_STRIDE + T_KILLS]);
      expect(kills.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      expect(packet.scalars.waveNumber).toBe(1);
      expect(packet.scalars.replayableWaves).toEqual([1]);

      // Let the last shots land, then the replay file
      for (let f = 0; f < 400 && packet.scalars.snapshotRefusal !== null; f++) packet = drive.tick();
      const file = core.rpc('replayFile', HEAD)!;
      expect(file.waves).toEqual([1]);
      // The live run's hashes the re-simulation is checked against
      expect(core.gsm.simRecorder.get(1)!.hashes.length).toBeGreaterThan(10);

      // A fresh simulation on the same world plays it again, every hash checked
      const replay = new Driver(newCore(main.world));
      const read = replay.core.rpc('loadReplayFile', file.text, HERE);
      expect(read.refusal).toBeNull();
      const entered = replay.core.rpc('replayEnter', 1, true)!;
      expect(entered.lengthInSteps).toBeGreaterThan(100);
      let state = replay.tick({ replay: { playing: true, speed: 10 } }).scalars.replay!;
      for (let f = 0; f < 20000 && !state.finished; f++) state = replay.tick({ replay: { playing: true, speed: 10 } }).scalars.replay!;
      expect(state.finished).toBe(true);
      expect(state.divergedAt).toBeNull();
      expect(state.stepInWave).toBe(entered.lengthInSteps);
      replay.core.rpc('replayExit');
      expect(replay.tick().scalars.replay).toBeNull();

      // The check bites: a tower that hits harder in the re-simulation parts from the record
      replay.core.rpc('loadReplayFile', file.text, HERE);
      replay.core.rpc('replayEnter', 1, true);
      for (const tower of replay.core.gsm.towerManager.getAll()) tower.combat.damage *= 3;
      state = replay.tick({ replay: { playing: true, speed: 10 } }).scalars.replay!;
      for (let f = 0; f < 20000 && !state.finished; f++) state = replay.tick({ replay: { playing: true, speed: 10 } }).scalars.replay!;
      expect(state.divergedAt).not.toBeNull();
    } finally {
      Math.random = mathRandom;
    }
  });

  it('counts line-of-sight generations from 1 in a new run, so a fresh guest takes the masks of a host who played before', () => {
    const main = mainWorld();
    const place = { type: 'command:place-tower', typeId: 'archer', position: { lat: 60 / M, lon: 9 / M, height: 0 } };
    // The host played a run alone before: its worker lives on
    const host = new Driver(newCore(main.world));
    host.send({ type: 'debug:add-credits', amount: 5000 });
    for (let i = 0; i < 3; i++) host.send({ ...place, position: { ...place.position, lat: (60 + 40 * i) / M } });
    for (const need of host.needs(host.tick())) host.send(answer(main, host.core, need));
    host.tick();
    host.core.loadWorld(main.world);
    const guest = new Driver(newCore(main.world));

    // Both place the same tower in the new run and take the same mask, as the relay hands it to both
    GameObject.resetIdCounter();
    host.send(place);
    const [need] = host.needs(host.tick());
    GameObject.resetIdCounter();
    guest.send(place);
    expect(guest.needs(guest.tick())).toEqual([need]);
    const mask = answer(main, host.core, need);
    host.send(mask);
    guest.send(mask);
    expect(host.tick().towerStates.map((s) => s.losReady)).toEqual([true]);
    expect(guest.tick().towerStates.map((s) => s.losReady)).toEqual([true]);
  });

  it('runs coop commands at the relay ticks the main thread hands over, and answers through `out`', () => {
    const main = mainWorld();
    const core = newCore(main.world);
    core.configure({ players: { players: ['a', 'b'], local: 'a' }, lockstep: { hashEvery: 1 } });
    const out: SimOutput[] = [];
    const input = (commands: QueuedCommand[], lockstep: SimTickInput['lockstep'], now: number): SimTickInput => ({
      now, gameSpeed: 1, paused: false, renderingEnabled: true, commands, lockstep, replay: null,
    });
    const credits = core.gsm.creditsOf('b');

    // A command given here goes to the relay, it does not act
    core.tick(input([{ playerId: 'a', command: { type: 'debug:add-credits', amount: 7 } as unknown as CommandData }], null, 1000), (m) => out.push(m));
    expect(out.filter((m) => m.kind === 'lockstep-send')).toHaveLength(1);
    expect(core.gsm.subStep).toBe(0); // no tick closed: the barrier holds

    // The relay stamped B's gift at tick 1; ticks 0 to 3 closed
    const gift = { tick: 1, seq: 1, playerId: 'b', command: { type: 'debug:add-credits', amount: 5 } as unknown as CommandData };
    const delivery = { confirmedTick: 3, ticks: [0, 1, 2, 3].map((tick) => ({ tick, commands: tick === 1 ? [gift] : [] })) };
    core.tick(input([], delivery, 1100), (m) => out.push(m));
    expect(core.gsm.creditsOf('b')).toBe(credits + 5);
    expect(core.gsm.subStep).toBeGreaterThan(0);
    expect(out.some((m) => m.kind === 'lockstep-hash')).toBe(true);
    expect(out.some((m) => m.kind === 'lockstep-frame')).toBe(true);
    expect(core.gsm.commandLog.entries.map((e) => [e.playerId, e.step])).toEqual([['b', 1 * TICK_SUB_STEPS]]);
  });

  it('starts no second wave while one runs', () => {
    const main = mainWorld();
    const drive = new Driver(newCore(main.world));
    drive.send({ type: 'command:start-wave', config: wave });
    expect(drive.tick().scalars.waveNumber).toBe(1);
    drive.send({ type: 'command:start-wave', config: wave });
    const packet = drive.tick();
    expect(packet.scalars.phase).toBe('wave');
    expect(packet.scalars.waveNumber).toBe(1);
    expect(packet.events.filter((e) => e.type === 'wave:started')).toEqual([]);
  });

  it('writes the enemy table and keeps the tables out of the renderers with rendering off', () => {
    const main = mainWorld();
    const core = newCore(main.world);
    const drive = new Driver(core);
    drive.send({ type: 'command:start-wave', config: wave });
    let packet = drive.tick();
    for (let f = 0; f < 200 && packet.enemies.count === 0; f++) packet = drive.tick();
    expect(packet.enemies.count).toBeGreaterThan(0);
    expect(packet.enemies.data[E_FLAGS] & EF_ALIVE).toBe(EF_ALIVE);
    expect(packet.enemies.data.length).toBeGreaterThanOrEqual(packet.enemies.count * ENEMY_STRIDE);
    expect(packet.presented).toBe(true);
    expect(drive.tick({ renderingEnabled: false }).presented).toBe(false);
    // Paused: no sub-step, nothing to present, the clock stands
    const time = packet.scalars.gameTimeMs;
    const paused = drive.tick({ paused: true });
    expect(paused.stepsRun).toBe(0);
    expect(paused.scalars.paused).toBe(true);
    expect(drive.tick({ paused: true }).scalars.gameTimeMs).toBe(paused.scalars.gameTimeMs);
    expect(paused.scalars.gameTimeMs).toBeGreaterThan(time);
  });

  it('gives the live game back after a replay with the towers that waited for their sight asking again', () => {
    const mathRandom = Math.random;
    Math.random = mulberry32(SEED + 2);
    try {
      const main = mainWorld();
      const core = newCore(main.world);
      const drive = new Driver(core);
      drive.send({ type: 'debug:add-credits', amount: 5000 });
      drive.send({ type: 'debug:complete-all-research' });
      drive.send({ type: 'command:place-tower', typeId: 'archer', position: { lat: 60 / M, lon: 9 / M, height: 0 } });
      let packet = drive.tick();
      for (const need of drive.needs(packet)) drive.send(answer(main, core, need));
      drive.tick();
      drive.send({ type: 'command:start-wave', config: wave });
      for (let f = 0; f < 20000; f++) {
        packet = drive.tick();
        if (packet.scalars.phase !== 'wave' && f > 0) break;
      }
      for (let f = 0; f < 400 && packet.scalars.snapshotRefusal !== null; f++) packet = drive.tick();

      // A second tower asks for its sight; the replay starts before the answer
      drive.send({ type: 'command:place-tower', typeId: 'cannon', position: { lat: 140 / M, lon: -9 / M, height: 0 } });
      packet = drive.tick();
      const [waiting] = drive.needs(packet);
      expect(waiting.reason).toBe('place');
      expect(core.rpc('replayEnter', 1, false)).not.toBeNull();
      for (let f = 0; f < 30; f++) drive.tick({ replay: { playing: true, speed: 4 } });

      core.rpc('replayExit');
      packet = drive.tick();
      // Asked again where the main thread hears it (live), with the same generation
      const again = packet.events.filter((e) => e.type === 'tower:los-needed');
      expect(again.filter((e) => e.live).map((e) => e.payload['towerId'])).toEqual([waiting.towerId]);
      expect(again.filter((e) => e.live).map((e) => e.payload['generation'])).toEqual([waiting.generation]);
      // Both towers stay towers on the main thread: states, no removal of a tower that stands
      const ids = core.gsm.towerManager.getAll().map((t) => t.id);
      expect(packet.removedTowers.filter((id) => ids.includes(id))).toEqual([]);
      expect(packet.towerStates.map((s) => s.id).sort()).toEqual([...ids].sort());
      // The first tower, built anew by the restore, brings its mask along; the second came back as new
      expect(packet.towerStates.find((s) => s.id !== waiting.towerId)!.losMask?.bits.length).toBeGreaterThan(0);

      // Its answer ends the wait
      drive.send(answer(main, core, waiting));
      packet = drive.tick();
      expect(packet.towerStates.find((s) => s.id === waiting.towerId)!.losReady).toBe(true);
    } finally {
      Math.random = mathRandom;
    }
  });
});
