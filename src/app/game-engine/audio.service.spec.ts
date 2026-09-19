import { describe, it, expect, vi, afterEach } from 'vitest';
import { Group, Vector3 } from 'three';
import { GameEventBus } from './game-event-bus';
import { AudioService } from './audio.service';
import type { ThreeTilesEngine } from '../three-engine';
import { ABILITY_IMPACT_SOUNDS, GAME_SOUNDS, type AbilityImpactSound } from '../configs/audio.config';
import { MISSILE_LAUNCH_LOOK, SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
import { MissileFlight } from '../utils/missile-flight';
import { TOWER_TYPES } from '../configs/tower-types.config';
import type { TowerRenderData } from '../three-engine/renderers/three-tower.renderer';
import { ABILITIES, abilityBeamReachM, type AbilityEffect } from '../configs/abilities.config';
import { NUKE_BLAST_S, NUKE_RUMBLE_S, NUKE_RUMBLES } from '../utils/nuke-sound';

const nuke: AbilityImpactSound = GAME_SOUNDS.nuclearStrike;
const { id, tail } = nuke;
/** The sound a repeat of the tail plays */
const soundOf = (repeat: AbilityImpactSound['tail'][number]) => (repeat.sample ?? nuke).id;
const FIRST_TAIL_MS = Math.min(...tail.map((repeat) => repeat.delayMs));
const LAST_TAIL_MS = Math.max(...tail.map((repeat) => repeat.delayMs));
/** One gameplay sub-step, see GameClock */
const STEP_MS = 1000 / 60;

describe('AudioService nuclear strike', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const eventBus = new GameEventBus();
    const spatialAudio = { registerSound: vi.fn(), playAtGeo: vi.fn(() => Promise.resolve(null)) };
    const service = new AudioService(eventBus, { spatialAudio } as unknown as ThreeTilesEngine);
    const impact = () => eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 1,
      target: { lat: 48, lon: 9, height: 310 }, radiusM: 25,
    });
    /** `ms` of game time in sub-steps, as GameStateManager runs them */
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += STEP_MS) service.update(STEP_MS);
    };
    /** What registerSound got for `soundId` */
    const registered = (soundId: string) => {
      const call = spatialAudio.registerSound.mock.calls.find((args: unknown[]) => args[0] === soundId);
      return call as unknown as [string, string, Record<string, unknown>] | undefined;
    };
    return { eventBus, spatialAudio, service, impact, run, registered };
  }

  it('registers the blast and every roll of the rumble once, synthesised, with priority, heard as far as the strike shakes', () => {
    const { spatialAudio, service, registered } = setup();
    const ids = spatialAudio.registerSound.mock.calls.map((args: unknown[]) => args[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const soundId of [id, ...tail.map(soundOf)]) {
      const [, url, config] = registered(soundId)!;
      expect(url.startsWith('data:audio/wav;base64,')).toBe(true);
      expect(config).toEqual({
        refDistance: nuke.refDistance,
        rolloffFactor: nuke.rolloffFactor,
        volume: nuke.volume,
        maxInstances: nuke.maxInstances,
        priority: true,
        audibleDistance: SCREEN_SHAKE_CONFIG.strikeFarDistance,
      });
    }
    service.destroy();
  });

  it('leaves priority and audible distance of the other abilities\' sounds to the manager\'s defaults', () => {
    const { service, registered } = setup();
    const { url, refDistance, rolloffFactor, volume, maxInstances } = GAME_SOUNDS.frostBomb;
    expect(registered(GAME_SOUNDS.frostBomb.id)).toEqual([
      GAME_SOUNDS.frostBomb.id, url, { refDistance, rolloffFactor, volume, maxInstances },
    ]);
    service.destroy();
  });

  it('plays the blast at the impact point, then the rolls of rumble, quieter, in game time', () => {
    const { spatialAudio, service, impact, run } = setup();
    impact();
    expect(spatialAudio.playAtGeo.mock.calls).toEqual([[id, 48, 9, 310, 1]]);

    run(FIRST_TAIL_MS - 2 * STEP_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(1);

    run(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo.mock.calls).toEqual([
      [id, 48, 9, 310, 1],
      ...tail.map((repeat) => [soundOf(repeat), 48, 9, 310, repeat.volume]),
    ]);
    for (const repeat of tail) expect(repeat.volume).toBeLessThan(1);
    service.destroy();
  });

  it('rumbles for several seconds: the first roll under the boom, each roll into the next, each once', () => {
    expect(new Set(tail.map(soundOf)).size).toBe(NUKE_RUMBLES);
    expect(tail).toHaveLength(NUKE_RUMBLES);
    expect(FIRST_TAIL_MS).toBeLessThan(NUKE_BLAST_S * 1000);
    for (let k = 1; k < tail.length; k++) {
      expect(tail[k].delayMs).toBeLessThan(tail[k - 1].delayMs + NUKE_RUMBLE_S * 1000);
      expect(tail[k].volume).toBeLessThan(tail[k - 1].volume);
    }
    expect(LAST_TAIL_MS + NUKE_RUMBLE_S * 1000).toBeGreaterThanOrEqual(7000);
  });

  it('plays the sound of the ability that landed: one without an entry stays silent', () => {
    const { eventBus, spatialAudio, service, run } = setup();
    expect(ABILITY_IMPACT_SOUNDS['nuclear-strike']).toBe(GAME_SOUNDS.nuclearStrike);
    // Stands for an ability added later; the typed table would not compile without its entry
    eventBus.emit({
      type: 'ability:impact', abilityId: 'later-ability' as never, strikeId: 2,
      target: { lat: 48, lon: 9, height: 310 }, radiusM: 25,
    });
    run(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo).not.toHaveBeenCalled();
    service.destroy();
  });

  it('holds the tail while no sub-step runs, as in a pause', () => {
    vi.useFakeTimers();
    const { spatialAudio, service, impact, run } = setup();
    impact();
    vi.advanceTimersByTime(10 * LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(1);

    run(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(1 + tail.length);
    service.destroy();
  });

  it('drops the repeats still to come on a restart and on destroy', () => {
    const { eventBus, spatialAudio, service, impact, run } = setup();
    impact();
    eventBus.emit({ type: 'game:reset' });
    run(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(1);

    impact();
    service.destroy();
    run(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(2);
  });
});

describe('AudioService nuclear strike siren', () => {
  const siren = GAME_SOUNDS.nuclearStrike.warning;
  const TARGET = { lat: 48, lon: 9, height: 310 };

  function setup(loopArrives?: () => Promise<number | null>) {
    let handles = 0;
    const arrives = loopArrives ?? (() => Promise.resolve(++handles));
    const eventBus = new GameEventBus();
    const spatialAudio = {
      registerSound: vi.fn(),
      playAtGeo: vi.fn(() => Promise.resolve(null)),
      // Stand-in for the engine's conversion: x lon, y height, z lat
      geoToLocalPosition: vi.fn((lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat)),
      createLoop: vi.fn((_soundId: string, _position: Vector3) => arrives()),
      stopLoop: vi.fn(),
    };
    const service = new AudioService(eventBus, { spatialAudio } as unknown as ThreeTilesEngine);
    const used = (abilityId: 'nuclear-strike' | 'frost-bomb', strikeId: number) => eventBus.emit({
      type: 'ability:used', abilityId, strikeId, target: TARGET, radiusM: 25, warningMs: 1500,
    });
    const impact = (strikeId: number) => eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId, target: TARGET, radiusM: 25,
    });
    /** createLoop resolves after its awaits */
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { eventBus, spatialAudio, service, used, impact, settle };
  }

  it('registers the siren once, as a loop that rolls off like the blast', () => {
    const { spatialAudio, service } = setup();
    const calls = spatialAudio.registerSound.mock.calls.filter((args: unknown[]) => args[0] === siren.id);
    expect(calls).toEqual([[siren.id, siren.url, {
      refDistance: GAME_SOUNDS.nuclearStrike.refDistance,
      rolloffFactor: GAME_SOUNDS.nuclearStrike.rolloffFactor,
      volume: siren.volume,
      loop: true,
    }]]);
    service.destroy();
  });

  it('wails at the target from the command on, for the nuclear strike only', async () => {
    const { spatialAudio, service, used, settle } = setup();
    used('frost-bomb', 1);
    expect(spatialAudio.createLoop).not.toHaveBeenCalled();

    used('nuclear-strike', 2);
    await settle();
    expect(spatialAudio.createLoop.mock.calls).toEqual([[siren.id, new Vector3(9, 310, 48)]]);
    expect(spatialAudio.stopLoop).not.toHaveBeenCalled();
    service.destroy();
  });

  it('ends when its strike lands, before the blast plays', async () => {
    const { spatialAudio, service, used, impact, settle } = setup();
    used('nuclear-strike', 1);
    await settle();
    impact(1);
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[1]]);
    expect(spatialAudio.stopLoop.mock.invocationCallOrder[0])
      .toBeLessThan(spatialAudio.playAtGeo.mock.invocationCallOrder[0]);
    service.destroy();
  });

  it('ends only the siren of the strike that landed', async () => {
    const { spatialAudio, service, used, impact, settle } = setup();
    used('nuclear-strike', 1);
    used('nuclear-strike', 2);
    await settle();
    impact(2);
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[2]]);
    service.destroy();
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[2], [1]]);
  });

  it('stops a siren whose loop arrives after the strike landed', async () => {
    let arrive: (handle: number) => void = () => undefined;
    const { spatialAudio, service, used, impact, settle } = setup(
      () => new Promise<number | null>((resolve) => (arrive = resolve)),
    );
    used('nuclear-strike', 1);
    impact(1);
    expect(spatialAudio.stopLoop).not.toHaveBeenCalled();
    arrive(77); // a loop that arrives after the impact
    await settle();
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[77]]);
    service.destroy();
  });

  it('ends on a restart and on a replay jump', async () => {
    const { eventBus, spatialAudio, service, used, settle } = setup();
    used('nuclear-strike', 1);
    await settle();
    eventBus.emit({ type: 'game:reset' });
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[1]]);

    used('nuclear-strike', 2);
    await settle();
    service.clearAbilitySounds();
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[1], [2]]);
    service.destroy();
  });

  it('stands on the route grid\'s ground where the grid has one', async () => {
    const { spatialAudio, service, used, settle } = setup();
    service.setGround({ getGroundLocalYAt: (x, z) => (x === 9 && z === 48 ? 12 : null) });
    used('nuclear-strike', 1);
    await settle();
    expect(spatialAudio.createLoop.mock.calls[0][1]).toEqual(new Vector3(9, 12, 48));
    service.destroy();
  });
});

describe('AudioService orbital laser burn', () => {
  const laser = GAME_SOUNDS.orbitalLaser;
  const burn = laser.beam;
  const effect = ABILITIES['orbital-laser'].effect as Extract<AbilityEffect, { kind: 'beam' }>;
  const REACH_M = abilityBeamReachM(effect);
  /** Local x is lon in the stand-in conversion: a straight path, 40 m then 60 m on */
  const PATH = [{ lat: 0, lon: 0, height: 5 }, { lat: 0, lon: 40, height: 5 }, { lat: 0, lon: 100, height: 5 }];

  function setup() {
    let handles = 0;
    const eventBus = new GameEventBus();
    /** Where the loop was put, per update */
    const moves: Vector3[] = [];
    const spatialAudio = {
      registerSound: vi.fn(),
      playAtGeo: vi.fn(() => Promise.resolve(null)),
      geoToLocalPosition: vi.fn((lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat)),
      createLoop: vi.fn((_soundId: string, _position: Vector3) => Promise.resolve(++handles)),
      stopLoop: vi.fn(),
      updateLoopPosition: vi.fn((_handle: number, position: Vector3) => {
        moves.push(position.clone());
      }),
      setLoopVolume: vi.fn(),
    };
    const service = new AudioService(eventBus, { spatialAudio } as unknown as ThreeTilesEngine);
    const impact = (path: typeof PATH = PATH, strikeId = 1) => eventBus.emit({
      type: 'ability:impact', abilityId: 'orbital-laser', strikeId, target: path[0], radiusM: 5, path,
    });
    /** `ms` of game time in sub-steps */
    const run = (ms: number) => {
      for (let k = Math.round(ms / STEP_MS); k > 0; k--) service.update(STEP_MS);
    };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { eventBus, spatialAudio, service, impact, run, settle, moves };
  }

  it('registers the burn once as a loop; the strike has no pieces of burn left', () => {
    const { spatialAudio, service } = setup();
    expect(laser.tail).toEqual([]);
    const calls = spatialAudio.registerSound.mock.calls.filter((args: unknown[]) => args[0] === burn.id);
    expect(calls).toEqual([[burn.id, burn.url, {
      refDistance: burn.refDistance, rolloffFactor: burn.rolloffFactor, volume: burn.volume, loop: true,
    }]]);
    service.destroy();
  });

  it('comes down with the strike at the start of the path', async () => {
    const { spatialAudio, service, impact, settle } = setup();
    impact();
    await settle();
    expect(spatialAudio.playAtGeo.mock.calls).toEqual([[laser.id, 0, 0, 5, 1]]);
    expect(spatialAudio.createLoop.mock.calls).toEqual([[burn.id, new Vector3(0, 5, 0)]]);
    service.destroy();
  });

  it('runs along the path with the beam, at its speed in game time', async () => {
    const { service, impact, run, settle, moves } = setup();
    impact();
    await settle();
    run(1000);
    expect(moves.at(-1)!.x).toBeCloseTo(effect.speedMps, 1);
    // Past the corner at 40 m, on the second stretch
    run(2000);
    expect(moves.at(-1)!.x).toBeCloseTo(3 * effect.speedMps, 1);
    expect(moves.at(-1)!.y).toBe(5);
    service.destroy();
  });

  it('stands while no sub-step runs, as in a pause', async () => {
    vi.useFakeTimers();
    const { spatialAudio, service, impact, run } = setup();
    impact();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spatialAudio.updateLoopPosition).not.toHaveBeenCalled();
    expect(spatialAudio.stopLoop).not.toHaveBeenCalled();
    run(500);
    expect(spatialAudio.updateLoopPosition).toHaveBeenCalled();
    service.destroy();
    vi.useRealTimers();
  });

  it('fades out where the beam ended, then stops', async () => {
    const { spatialAudio, service, impact, run, settle, moves } = setup();
    impact();
    await settle();
    run(effect.durationMs);
    expect(spatialAudio.setLoopVolume).not.toHaveBeenCalled();
    expect(moves.at(-1)!.x).toBeCloseTo(REACH_M, 1);

    run(burn.fadeOutMs / 2);
    const volumes = spatialAudio.setLoopVolume.mock.calls.map((args: unknown[]) => args[1] as number);
    expect(volumes.length).toBeGreaterThan(1);
    for (let k = 1; k < volumes.length; k++) expect(volumes[k]).toBeLessThan(volumes[k - 1]);
    expect(volumes.at(-1)!).toBeCloseTo(0.5, 1);
    expect(moves.at(-1)!.x).toBeCloseTo(REACH_M, 1);
    expect(spatialAudio.stopLoop).not.toHaveBeenCalled();

    run(burn.fadeOutMs);
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[1]]);
    service.destroy();
    expect(spatialAudio.stopLoop).toHaveBeenCalledTimes(1);
  });

  it('ends sooner where the route ends sooner', async () => {
    const { spatialAudio, service, impact, run, settle, moves } = setup();
    const short = [{ lat: 0, lon: 0, height: 5 }, { lat: 0, lon: 36, height: 5 }];
    impact(short);
    await settle();
    run((36 / effect.speedMps) * 1000 + burn.fadeOutMs + STEP_MS);
    expect(spatialAudio.stopLoop).toHaveBeenCalledTimes(1);
    expect(moves.at(-1)!.x).toBeCloseTo(36, 1);
    service.destroy();
  });

  it('ends on a restart and on a replay jump', async () => {
    const { eventBus, spatialAudio, service, impact, run, settle } = setup();
    impact();
    await settle();
    eventBus.emit({ type: 'game:reset' });
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[1]]);
    run(1000);
    expect(spatialAudio.updateLoopPosition).not.toHaveBeenCalled();

    impact(PATH, 2);
    await settle();
    service.clearAbilitySounds();
    expect(spatialAudio.stopLoop.mock.calls).toEqual([[1], [2]]);
    service.destroy();
  });
});

describe('AudioService nuclear strike missile', () => {
  const launchSounds = GAME_SOUNDS.nuclearStrike.launch;
  const SITE = { lat: 0, lon: 0, height: 20 };
  const TARGET = { lat: 300, lon: 400, height: 10 };
  const WARNING_MS = 6500;

  function setup() {
    let handles = 0;
    const eventBus = new GameEventBus();
    /** Where the engine loop was put, per update */
    const moves: Vector3[] = [];
    const voices: object[] = [];
    const spatialAudio = {
      registerSound: vi.fn(),
      playAtGeo: vi.fn((soundId: string) => {
        const voice = { soundId };
        voices.push(voice);
        return Promise.resolve(voice);
      }),
      stopOneShot: vi.fn(),
      // Stand-in for the engine's conversion: x lon, y height, z lat
      geoToLocalPosition: vi.fn((lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat)),
      createLoop: vi.fn((soundId: string, _position: Vector3, _config?: object) => Promise.resolve(`${soundId}_${++handles}`)),
      stopLoop: vi.fn(),
      updateLoopPosition: vi.fn((_handle: number, position: Vector3) => {
        moves.push(position.clone());
      }),
      setLoopVolume: vi.fn(),
    };
    /** The silo's render object, none unless a test puts one there */
    const towers = { get: vi.fn((_id: string): TowerRenderData | undefined => undefined) };
    const service = new AudioService(eventBus, { spatialAudio, towers } as unknown as ThreeTilesEngine);
    const used = (strikeId = 1, launch = true, abilityId: 'nuclear-strike' | 'frost-bomb' = 'nuclear-strike') =>
      eventBus.emit({
        type: 'ability:used', abilityId, strikeId, target: TARGET, radiusM: 25, warningMs: WARNING_MS,
        ...(launch ? { launch: { towerId: 'silo', position: SITE } } : {}),
      });
    const impact = (strikeId = 1) => eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId, target: TARGET, radiusM: 25,
    });
    /** `ms` of game time in sub-steps */
    const run = (ms: number) => {
      for (let k = Math.round(ms / STEP_MS); k > 0; k--) service.update(STEP_MS);
    };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const played = (soundId: string) => spatialAudio.playAtGeo.mock.calls.filter((args: unknown[]) => args[0] === soundId);
    /** Engine loops stopped, in order */
    const engineStops = () =>
      spatialAudio.stopLoop.mock.calls.map((args: unknown[]) => args[0] as string).filter((h) => h.startsWith(launchSounds.engine.id));
    return { eventBus, spatialAudio, towers, service, used, impact, run, settle, moves, voices, played, engineStops };
  }

  it('registers the ignition and the dive as one-shots heard as far as the blast, the engine as a loop', () => {
    const { spatialAudio, service } = setup();
    const config = (soundId: string) =>
      spatialAudio.registerSound.mock.calls.filter((args: unknown[]) => args[0] === soundId).map((args: unknown[]) => args.slice(1));
    for (const sample of [launchSounds.ignition, launchSounds.dive]) {
      expect(config(sample.id)).toEqual([[sample.url, {
        refDistance: sample.refDistance,
        rolloffFactor: sample.rolloffFactor,
        volume: sample.volume,
        maxInstances: 2,
        priority: true,
        audibleDistance: SCREEN_SHAKE_CONFIG.strikeFarDistance,
      }]]);
    }
    const { engine } = launchSounds;
    expect(config(engine.id)).toEqual([[engine.url, {
      refDistance: engine.refDistance, rolloffFactor: engine.rolloffFactor, volume: engine.volume, loop: true,
    }]]);
    service.destroy();
  });

  it('ignites at the silo and starts the engine there, silent at first, only for a strike with a launch site', async () => {
    const { spatialAudio, service, used, settle, played } = setup();
    used(1, false);
    used(2, true, 'frost-bomb');
    await settle();
    expect(played(launchSounds.ignition.id)).toEqual([]);
    expect(spatialAudio.createLoop.mock.calls.some((args: unknown[]) => args[0] === launchSounds.engine.id)).toBe(false);

    used(3);
    await settle();
    expect(played(launchSounds.ignition.id)).toEqual([[launchSounds.ignition.id, SITE.lat, SITE.lon, SITE.height, 1]]);
    const engine = spatialAudio.createLoop.mock.calls.filter((args: unknown[]) => args[0] === launchSounds.engine.id);
    expect(engine).toEqual([[
      launchSounds.engine.id,
      new Vector3(SITE.lon, SITE.height + MISSILE_LAUNCH_LOOK.missile.baseHeight, SITE.lat),
      { volumeMultiplier: 0 },
    ]]);
    service.destroy();
  });

  it('moves the engine along the flight the renderer flies, fading it in, in game time', async () => {
    const { spatialAudio, service, used, run, settle, moves } = setup();
    used();
    await settle();
    run(3000);
    const flight = new MissileFlight().plan(
      new Vector3(SITE.lon, SITE.height + MISSILE_LAUNCH_LOOK.missile.baseHeight, SITE.lat),
      new Vector3(TARGET.lon, TARGET.height, TARGET.lat),
      WARNING_MS / 1000,
    );
    const expected = new Vector3();
    flight.at((Math.round(3000 / STEP_MS) * STEP_MS) / WARNING_MS, expected);
    expect(moves.at(-1)!.distanceTo(expected)).toBeLessThan(1e-3);
    expect(moves.at(-1)!.y).toBeGreaterThan(SITE.height + 50);
    const volumes = spatialAudio.setLoopVolume.mock.calls.map((args: unknown[]) => args[1] as number);
    expect(volumes[0]).toBeLessThan(0.02);
    expect(volumes.at(-1)).toBe(1);
    service.destroy();
  });

  it('starts the engine where the placed silo\'s missile node stands, as the renderer starts the missile', async () => {
    const { spatialAudio, towers, service, used, settle } = setup();
    const mesh = new Group();
    mesh.position.set(3, 21, -4);
    mesh.scale.setScalar(7.36);
    const node = new Group();
    node.name = MISSILE_LAUNCH_LOOK.missile.node;
    node.position.set(0.01, 0.3126, 0);
    mesh.add(node);
    towers.get.mockImplementation((id: string) =>
      id === 'silo' ? ({ mesh, typeConfig: TOWER_TYPES['missile-silo'] } as unknown as TowerRenderData) : undefined);
    used();
    await settle();
    const [, position] = spatialAudio.createLoop.mock.calls.find((args: unknown[]) => args[0] === launchSounds.engine.id)!;
    expect(position.distanceTo(new Vector3(3 + 0.01 * 7.36, 21 + 0.3126 * 7.36, -4))).toBeLessThan(1e-6);
    service.destroy();
  });

  it('stands while no sub-step runs, as in a pause', async () => {
    vi.useFakeTimers();
    const { spatialAudio, service, used, run } = setup();
    used();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spatialAudio.updateLoopPosition).not.toHaveBeenCalled();
    expect(spatialAudio.playAtGeo.mock.calls.map((args: unknown[]) => args[0])).toEqual([launchSounds.ignition.id]);
    run(500);
    expect(spatialAudio.updateLoopPosition).toHaveBeenCalled();
    service.destroy();
    vi.useRealTimers();
  });

  it('dives at the target its lead before the impact; the impact ends the engine and cuts the dive', async () => {
    const { spatialAudio, service, used, impact, run, settle, played, voices, engineStops } = setup();
    used();
    await settle();
    run(WARNING_MS - launchSounds.dive.leadMs - 2 * STEP_MS);
    expect(played(launchSounds.dive.id)).toEqual([]);
    run(4 * STEP_MS);
    expect(played(launchSounds.dive.id)).toEqual([[launchSounds.dive.id, TARGET.lat, TARGET.lon, TARGET.height, 1]]);
    await settle();

    impact();
    expect(engineStops()).toHaveLength(1);
    const dive = voices.find((voice) => (voice as { soundId: string }).soundId === launchSounds.dive.id);
    expect(spatialAudio.stopOneShot.mock.calls).toEqual([[dive]]);
    // Before the blast plays
    expect(spatialAudio.stopOneShot.mock.invocationCallOrder[0]).toBeLessThan(
      spatialAudio.playAtGeo.mock.invocationCallOrder.at(-1)!,
    );
    run(1000);
    expect(played(launchSounds.dive.id)).toHaveLength(1);
    service.destroy();
  });

  it('ends only the missile of the strike that landed', async () => {
    const { spatialAudio, service, used, impact, settle, engineStops } = setup();
    used(1);
    used(2);
    await settle();
    const [first, second] = spatialAudio.createLoop.mock.results
      .map((result) => result.value as Promise<number>)
      .filter((_, k) => spatialAudio.createLoop.mock.calls[k][0] === launchSounds.engine.id);
    impact(2);
    expect(engineStops()).toEqual([await second]);
    service.destroy();
    expect(engineStops()).toEqual([await second, await first]);
  });

  it('ends at the end of its flight if no impact comes, and on a restart and a replay jump', async () => {
    const { eventBus, service, used, run, settle, engineStops } = setup();
    used(1);
    await settle();
    run(WARNING_MS + STEP_MS);
    expect(engineStops()).toHaveLength(1);

    used(2);
    await settle();
    eventBus.emit({ type: 'game:reset' });
    expect(engineStops()).toHaveLength(2);
    run(1000);

    used(3);
    await settle();
    service.clearAbilitySounds();
    expect(engineStops()).toHaveLength(3);
    service.destroy();
  });
});
