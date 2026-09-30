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

import { MAX_AHEAD_MS, MAX_PUBLISH_GAP_MS, MIN_PUBLISH_GAP_MS, SimCore } from './sim-core';
import { OriginSync } from './sim-coords';
import { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import { buildRoute } from '../../integration/sim-step-bench';
import { worldKeyOf } from '../protocol/world-key';
import { losMaskToJson } from '../../utils/los-mask';
import { METERS_PER_DEGREE_LAT as M } from '../../utils/geo-utils';
import { mulberry32 } from '../../utils/game-rng';
import { GameObject } from '../../core/game-object';
import type { SimWorld, SimInput, SimOutput, QueuedCommand } from '../protocol/messages';
import { GameClock } from '../../managers/game-state/game-clock';
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

const SETTINGS: SimInput = { gameSpeed: 4, paused: false, renderingEnabled: true, commands: [], lockstep: null, replay: null };

/**
 * Drives a core frame by frame, as the SimClient does with the simulation in
 * its own thread: the input with the commands given, then a pass with every
 * sub-step due. An input every frame, so every pass has a packet.
 */
class Driver {
  now = 1000;
  packets: SimFramePacket[] = [];
  private queued: QueuedCommand[] = [];

  constructor(readonly core: SimCore) {}

  send(command: object): void {
    this.queued.push({ playerId: 'local', command: command as CommandData });
  }

  tick(overrides: Partial<SimInput> = {}): SimFramePacket {
    this.now += GameClock.FIXED_STEP_MS;
    const commands = this.queued;
    this.queued = [];
    this.core.input({ ...SETTINGS, commands, ...overrides }, this.now);
    const packet = this.core.pass(this.now)!;
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
    core.output((m) => out.push(m));
    const frame = (commands: QueuedCommand[], lockstep: SimInput['lockstep'], now: number): void => {
      core.input({ ...SETTINGS, gameSpeed: 1, commands, lockstep }, now);
      core.pass(now);
    };
    const credits = core.gsm.creditsOf('b');

    // A command given here goes to the relay, it does not act
    frame([{ playerId: 'a', command: { type: 'debug:add-credits', amount: 7 } as unknown as CommandData }], null, 1000);
    expect(out.filter((m) => m.kind === 'lockstep-send')).toHaveLength(1);
    expect(core.gsm.subStep).toBe(0); // no tick closed: the barrier holds
    // Only the relay's next tick brings work: the loop sleeps until a message
    expect(core.idleMs()).toBe(Infinity);

    // The relay stamped B's gift at tick 1; ticks 0 to 3 closed
    const gift = { tick: 1, seq: 1, playerId: 'b', command: { type: 'debug:add-credits', amount: 5 } as unknown as CommandData };
    const own = { tick: 2, seq: 2, playerId: 'a', command: { type: 'debug:add-credits', amount: 7 } as unknown as CommandData };
    const delivery = { confirmedTick: 3, ticks: [0, 1, 2, 3].map((tick) => ({ tick, commands: tick === 1 ? [gift] : tick === 2 ? [own] : [] })) };
    frame([], delivery, 1100);
    expect(core.gsm.creditsOf('b')).toBe(credits + 5);
    // The own command ran here now: the input delay counts from this, not from the hand-over
    expect(out.filter((m) => m.kind === 'lockstep-ran')).toEqual([{ kind: 'lockstep-ran', count: 1 }]);
    expect(core.gsm.subStep).toBeGreaterThan(0);
    expect(out.some((m) => m.kind === 'lockstep-hash')).toBe(true);
    expect(out.some((m) => m.kind === 'lockstep-frame')).toBe(true);
    expect(core.gsm.commandLog.entries.map((e) => [e.playerId, e.step])).toEqual([['b', 1 * TICK_SUB_STEPS], ['a', 2 * TICK_SUB_STEPS]]);
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

  it('times the simulation by part only while the perf panel asks for it (TODO E82)', () => {
    const main = mainWorld();
    const core = newCore(main.world);
    const drive = new Driver(core);
    drive.send({ type: 'command:start-wave', config: wave });
    for (let f = 0; f < 200 && drive.tick().enemies.count === 0; f++) { /* until enemies walk */ }

    // Off: no sums, and a pass takes only the three timestamps of its own tickMs
    expect(core.rpc('profileSums')).toBeNull();
    const now = vi.spyOn(performance, 'now');
    drive.tick();
    expect(now).toHaveBeenCalledTimes(3);
    now.mockClear();

    core.configure({ profile: true });
    for (let f = 0; f < 30; f++) drive.tick();
    expect(now.mock.calls.length).toBeGreaterThan(30 * 3);
    now.mockRestore();
    const sums = core.rpc('profileSums')!;
    expect(sums.ticks).toBe(30);
    expect(sums.subSteps).toBe(drive.packets.slice(-30).reduce((a, p) => a + p.stepsRun, 0));
    expect(sums.tickMs).toBeCloseTo(sums.commandsMs + sums.updateMs + sums.packetMs, 6);
    expect(sums.enemyMs).toBeGreaterThan(0);
    expect(sums.enemyMs + sums.projectileMs + sums.combatMs + sums.eventsMs).toBeLessThanOrEqual(sums.updateMs);
    // Taken: the next window starts empty
    expect(core.rpc('profileSums')!.ticks).toBe(0);

    core.configure({ profile: false });
    expect(core.rpc('profileSums')).toBeNull();
    expect(core.gsm.enemyManager.onProfileTiming).toBeNull();
  });

  describe('as the loop drives it (docs/SIM_DECOUPLE_PLAN.md)', () => {
    const STEP = GameClock.FIXED_STEP_MS;

    /** A core at speed 1 with the first pass behind it (it opens the clock) */
    function running(gameSpeed = 1): SimCore {
      const core = newCore(mainWorld().world);
      core.input({ ...SETTINGS, gameSpeed }, 1000);
      core.pass(1000);
      return core;
    }

    it('publishes nothing while no sub-step is due and nothing changed, and says how long to sleep', () => {
      const core = running();
      // The first pass took 16 ms, short of a sub-step
      expect(core.gsm.subStep).toBe(0);
      expect(core.idleMs()).toBeCloseTo(STEP - 16, 6);
      expect(core.pass(1000.3)).toBeNull();

      // One sub-step and 1 ms are due
      const at = 1000 + STEP - 15;
      const packet = core.pass(at)!;
      expect(packet.stepsRun).toBe(1);
      expect(core.idleMs()).toBeCloseTo(STEP - 1, 6);
      // Four times the speed, a quarter of the wait
      core.input({ ...SETTINGS, gameSpeed: 4 }, at);
      expect(core.pass(at)!.stepsRun).toBe(0);
      expect(core.idleMs()).toBeCloseTo((STEP - 1) / 4, 6);
    });

    it('publishes what an input, a setting or a call changed at once, without a sub-step', () => {
      const core = running();
      expect(core.pass(1000.1)).toBeNull();
      core.input({ ...SETTINGS, gameSpeed: 1, commands: [{ playerId: 'local', command: { type: 'debug:add-credits', amount: 9 } as unknown as CommandData }] }, 1000.2);
      expect(core.idleMs()).toBe(0);
      const packet = core.pass(1000.2)!;
      expect(packet.stepsRun).toBe(0);
      expect(packet.presented).toBe(true);
      expect(core.pass(1000.3)).toBeNull();

      core.configure({ damageNumbers: true });
      expect(core.idleMs()).toBe(0);
      expect(core.pass(1000.4)!.presented).toBe(false);
      core.rpc('stateHash');
      expect(core.pass(1000.5)).not.toBeNull();
      expect(core.pass(1000.6)).toBeNull();
    });

    it('stops at the deadline with the rest carried over, the same sub-steps as without one', () => {
      const core = running(4);
      const free = running(4);
      const before = core.gsm.subStep;
      // 100 ms at speed 4 and what the first pass left: `due` sub-steps. The deadline has passed: one runs, the
      // pass asks to go on at once
      const due = Math.floor((64 - before * STEP + 400) / STEP);
      expect(due).toBeGreaterThan(10);
      const hashes = new Set<number>();
      let passes = 0;
      do {
        expect(core.pass(1100, performance.now() - 1)!.stepsRun).toBe(1);
        hashes.add(core.gsm.stateHash());
        passes++;
      } while (core.idleMs() === 0 && passes < 100);
      expect(passes).toBe(due);
      expect(hashes.size).toBe(due);
      expect(core.pass(1100, performance.now() - 1)).toBeNull();

      expect(free.pass(1100)!.stepsRun).toBe(due);
      expect(core.gsm.subStep).toBe(before + due);
      expect(core.gsm.stateHash()).toBe(free.gsm.stateHash());
    });

    it('publishes on demand: what ran meanwhile goes with the next packet, events and ops in order', () => {
      const core = running();
      const free = running();
      core.input({ ...SETTINGS, gameSpeed: 1, commands: [{ playerId: 'local', command: { type: 'command:start-wave', config: wave } as unknown as CommandData }] }, 1000);
      free.input({ ...SETTINGS, gameSpeed: 1, commands: [{ playerId: 'local', command: { type: 'command:start-wave', config: wave } as unknown as CommandData }] }, 1000);
      core.pass(1000);
      free.pass(1000);

      // The main thread asks for nothing: sub-steps run, no packet is written
      const asked = { demandPending: () => false, takeDemand: vi.fn(() => false) };
      let now = 1000;
      const every: SimFramePacket[] = [];
      for (let i = 0; i < 2; i++) {
        now += 34;
        expect(core.pass(now, Infinity, asked)).toBeNull();
        every.push(free.pass(now)!);
      }
      expect(core.gsm.subStep).toBe(free.gsm.subStep);
      expect(core.idleMs()).toBeGreaterThan(0);
      // It asks: one packet with everything since the last
      now += 34;
      every.push(free.pass(now)!);
      const packet = core.pass(now, Infinity, { demandPending: () => false, takeDemand: () => true })!;
      expect(packet.stepsRun).toBe(every.reduce((a, p) => a + p.stepsRun, 0));
      expect(packet.stepsRun).toBeGreaterThanOrEqual(3);
      expect(packet.presented).toBe(true);
      expect(packet.events.map((e) => e.type)).toEqual(every.flatMap((p) => p.events.map((e) => e.type)));
      expect(packet.ops.map((op) => op[0])).toEqual(every.flatMap((p) => p.ops.map((op) => op[0])));
      expect(packet.scalars.gameTimeMs).toBe(every[every.length - 1].scalars.gameTimeMs);
      // Nothing held after it
      expect(core.pass(now + 1, Infinity, asked)).toBeNull();
      // Asked only from when the next packet is due (MIN_PUBLISH_GAP_MS)
      expect(asked.takeDemand).toHaveBeenCalledTimes(1);
    });

    it('ends the pass after the sub-step running when the main thread waits for a packet', () => {
      const core = running(4);
      // 100 ms at speed 4 and what the first pass left are due, the demand comes during the third sub-step
      const due = Math.floor((64 - core.gsm.subStep * STEP + 400) / STEP);
      let checks = 0;
      const packet = core.pass(1100, Infinity, { demandPending: () => ++checks >= 3, takeDemand: () => true })!;
      expect(packet.stepsRun).toBe(3);
      // The rest is still due
      expect(core.idleMs()).toBe(0);
      expect(core.pass(1100)!.stepsRun).toBe(due - 3);
    });

    it('answers demands MIN_PUBLISH_GAP_MS apart, behind or not', () => {
      const always = { demandPending: () => true, takeDemand: vi.fn(() => true) };
      const past = () => performance.now() - 1;
      const core = running(4);
      // 250 ms of backlog at speed 4, one sub-step per pass (the deadline has passed): behind all the way
      expect(core.pass(1300, past(), always)).not.toBeNull();
      let now = 1300;
      const gaps: number[] = [];
      let last = now;
      for (let i = 0; i < 40; i++) {
        now += 5;
        if (core.pass(now, past(), always)) {
          gaps.push(now - last);
          last = now;
        }
      }
      expect(core.idleMs()).toBe(0);
      expect(gaps.length).toBeGreaterThan(3);
      // A schedule: the passes come every 5 ms, the packets every 33 ms on average, never closer than half of it
      const later = gaps.slice(1);
      expect(later.reduce((a, b) => a + b, 0) / later.length).toBeCloseTo(MIN_PUBLISH_GAP_MS, 0);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_PUBLISH_GAP_MS / 2);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(MIN_PUBLISH_GAP_MS + 5);
      // The demand is left standing meanwhile, not used up
      expect(always.takeDemand).toHaveBeenCalledTimes(gaps.length + 1);

      // Keeping up at speed 1: every second sub-step goes out, about 30 states a second
      const kept = running(1);
      let packets = 0;
      for (let t = 1017; t <= 2000; t += GameClock.FIXED_STEP_MS) {
        if (kept.pass(t, Infinity, always)) packets++;
      }
      expect(packets).toBeGreaterThanOrEqual(29);
      expect(packets).toBeLessThanOrEqual(30);
      // A pass that comes late does not push the next packet a sub-step further
      const late = running(1);
      packets = 0;
      for (let t = 1017; t <= 2000; t += GameClock.FIXED_STEP_MS) {
        if (late.pass(t + (packets % 2 === 0 ? 3 : 0), Infinity, always)) packets++;
      }
      expect(packets).toBeGreaterThanOrEqual(28);
      // And an input goes out at once, however young the last packet
      core.input({ ...SETTINGS }, now + 1);
      expect(core.pass(now + 1, past(), always)).not.toBeNull();
    });

    it('publishes without being asked: after an input, before it sleeps for good, and after MAX_PUBLISH_GAP_MS', () => {
      const never = { demandPending: () => false, takeDemand: () => false };
      const core = running();
      // One sub-step runs and is held: nobody asked
      let at = 1000 + STEP - 15;
      expect(core.pass(at, Infinity, never)).toBeNull();
      expect(core.gsm.subStep).toBe(1);
      // An input: its packet goes at once, with the sub-step held
      core.input({ ...SETTINGS, gameSpeed: 1 }, at);
      expect(core.pass(at, Infinity, never)!.stepsRun).toBe(1);

      // The pause: the loop sleeps until a message, the last state goes out first
      at += STEP;
      expect(core.pass(at, Infinity, never)).toBeNull();
      core.gsm.paused.set(true);
      const last = core.pass(at + 1, Infinity, never)!;
      expect(last.stepsRun).toBe(1);
      expect(core.idleMs()).toBe(Infinity);
      core.gsm.paused.set(false);

      // A main thread that does not ask: a packet every MAX_PUBLISH_GAP_MS
      const free = running();
      let asks = true;
      const demand = { demandPending: () => false, takeDemand: () => asks };
      expect(free.pass(1034, Infinity, demand)).not.toBeNull();
      asks = false;
      let packets = 0;
      for (let now = 1068; now < 1034 + 2 * MAX_PUBLISH_GAP_MS + 17; now += 34) {
        if (free.pass(now, Infinity, demand)) packets++;
      }
      expect(packets).toBe(2);
    });

    it('waits for the main thread after MAX_AHEAD_MS without a demand, and goes on without catching up', () => {
      const core = running();
      let pending = false;
      const demand = { demandPending: () => pending, takeDemand: () => pending && !(pending = false) };
      pending = true;
      expect(core.pass(1034, Infinity, demand)).not.toBeNull();

      // The main thread stands: the simulation runs on for MAX_AHEAD_MS, then its last state goes out and it sleeps
      let now = 1034;
      let last: SimFramePacket | null = null;
      while (now < 1034 + MAX_AHEAD_MS + 100) {
        now += 17;
        last = core.pass(now, Infinity, demand) ?? last;
      }
      const stood = core.gsm.subStep;
      expect(stood).toBeGreaterThan(MAX_AHEAD_MS / STEP - 2);
      expect(stood).toBeLessThan(MAX_AHEAD_MS / STEP + 3);
      expect(last!.scalars.subStep).toBe(stood);
      expect(core.idleMs()).toBe(Infinity);
      expect(core.pass(now + 5000, Infinity, demand)).toBeNull();
      expect(core.gsm.subStep).toBe(stood);

      // A call is still answered with a packet, without a sub-step
      core.rpc('stateHash');
      expect(core.pass(now + 6000, Infinity, demand)!.stepsRun).toBe(0);
      expect(core.idleMs()).toBe(Infinity);

      // The demand comes a minute later: on from here, nothing caught up
      pending = true;
      now += 60_000;
      core.pass(now, Infinity, demand);
      expect(core.gsm.subStep).toBe(stood);
      expect(core.idleMs()).toBeLessThan(STEP);
      expect(core.pass(now + 34, Infinity, demand)!.stepsRun).toBeGreaterThanOrEqual(1);
    });

    it('keeps at most MAX_BACKLOG_MS of wall clock times the speed: a loop that stood does not run minutes at once', () => {
      const core = running(4);
      const packet = core.pass(61_000)!;
      expect(packet.stepsRun).toBe(Math.floor((GameClock.MAX_BACKLOG_MS * 4) / STEP));
      // And what a deadline leaves undone stays within it
      const slow = running(4);
      for (let t = 1100; t <= 5000; t += 100) slow.pass(t, performance.now() - 1);
      expect(slow.pass(5000)!.stepsRun).toBeLessThanOrEqual(Math.floor((GameClock.MAX_BACKLOG_MS * 4) / STEP));
    });

    it('sleeps through a pause and goes on where it stood, without a jump', () => {
      const core = running();
      core.pass(1100);
      const steps = core.gsm.subStep;
      core.input({ ...SETTINGS, gameSpeed: 1, paused: true }, 1100);
      expect(core.pass(1100)!.scalars.paused).toBe(true);
      expect(core.idleMs()).toBe(Infinity);

      // A minute later: the clock is held at the moment the pause ends
      core.input({ ...SETTINGS, gameSpeed: 1 }, 61_100);
      expect(core.pass(61_100)!.stepsRun).toBe(0);
      expect(core.gsm.subStep).toBe(steps);
      expect(core.idleMs()).toBeLessThan(STEP);
      // What the pause held over and a sub-step's time: one sub-step
      expect(core.pass(61_100 + STEP)!.stepsRun).toBe(1);
    });

    it('runs nothing without a world: the loop sleeps until the next one', () => {
      const core = running();
      core.unloadWorld();
      core.input({ ...SETTINGS, gameSpeed: 1 }, 1100);
      expect(core.pass(1100)).toBeNull();
      expect(core.idleMs()).toBe(Infinity);
      expect(core.gsm.subStep).toBe(0);

      core.rpc('reset', SEED);
      core.loadWorld(mainWorld().world);
      expect(core.idleMs()).toBe(0);
      const packet = core.pass(9000)!;
      expect(packet.events.some((e) => e.type === 'game:reset')).toBe(true);
      expect(packet.stepsRun).toBe(0);
    });

    it('holds a replay that does not play, and plays it by the wall clock from where it was let go', () => {
      const mathRandom = Math.random;
      Math.random = mulberry32(SEED + 3);
      try {
        const drive = new Driver(newCore(mainWorld().world));
        drive.send({ type: 'command:start-wave', config: wave });
        let packet = drive.tick();
        for (let f = 0; f < 20000 && (packet.scalars.phase === 'wave' || f === 0); f++) packet = drive.tick();
        for (let f = 0; f < 400 && packet.scalars.snapshotRefusal !== null; f++) packet = drive.tick();
        const core = drive.core;
        expect(core.rpc('replayEnter', 1, false)).not.toBeNull();
        let now = drive.now;
        core.pass(now);
        // Entered, not playing: only a message brings work
        expect(core.idleMs()).toBe(Infinity);

        now += 30_000;
        core.input({ ...SETTINGS, paused: true, replay: { playing: true, speed: 2 } }, now);
        expect(core.pass(now)!.scalars.replay!.stepInWave).toBe(0);
        expect(core.idleMs()).toBeCloseTo(STEP / 2, 6);
        expect(core.pass(now + 50)!.scalars.replay!.stepInWave).toBe(Math.floor(100 / STEP));
      } finally {
        Math.random = mathRandom;
      }
    });
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
      // The live game's show goes before the replay's start is set up
      expect(drive.tick({ replay: { playing: true, speed: 4 } }).ops[0][0]).toBe('show.clear');
      for (let f = 0; f < 30; f++) drive.tick({ replay: { playing: true, speed: 4 } });
      core.rpc('replaySeek', 10);
      expect(drive.tick({ replay: { playing: false, speed: 4 } }).ops.map((op) => op[0])).toContain('show.clear');

      core.rpc('replayExit');
      packet = drive.tick();
      // The replay's show goes before the live state is set up again
      expect(packet.ops[0][0]).toBe('show.clear');
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
