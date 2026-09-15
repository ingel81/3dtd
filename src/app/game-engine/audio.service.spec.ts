import { describe, it, expect, vi, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { GameEventBus } from './game-event-bus';
import { AudioService } from './audio.service';
import type { ThreeTilesEngine } from '../three-engine';
import { ABILITY_IMPACT_SOUNDS, GAME_SOUNDS, type AbilityImpactSound } from '../configs/audio.config';
import { SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
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

  function setup(loopArrives?: () => Promise<string | null>) {
    let handles = 0;
    const arrives = loopArrives ?? (() => Promise.resolve(`loop_${++handles}`));
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
    expect(spatialAudio.stopLoop.mock.calls).toEqual([['loop_1']]);
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
    expect(spatialAudio.stopLoop.mock.calls).toEqual([['loop_2']]);
    service.destroy();
    expect(spatialAudio.stopLoop.mock.calls).toEqual([['loop_2'], ['loop_1']]);
  });

  it('stops a siren whose loop arrives after the strike landed', async () => {
    let arrive: (handle: string) => void = () => undefined;
    const { spatialAudio, service, used, impact, settle } = setup(
      () => new Promise<string | null>((resolve) => (arrive = resolve)),
    );
    used('nuclear-strike', 1);
    impact(1);
    expect(spatialAudio.stopLoop).not.toHaveBeenCalled();
    arrive('late');
    await settle();
    expect(spatialAudio.stopLoop.mock.calls).toEqual([['late']]);
    service.destroy();
  });

  it('ends on a restart and on a replay jump', async () => {
    const { eventBus, spatialAudio, service, used, settle } = setup();
    used('nuclear-strike', 1);
    await settle();
    eventBus.emit({ type: 'game:reset' });
    expect(spatialAudio.stopLoop.mock.calls).toEqual([['loop_1']]);

    used('nuclear-strike', 2);
    await settle();
    service.clearAbilitySounds();
    expect(spatialAudio.stopLoop.mock.calls).toEqual([['loop_1'], ['loop_2']]);
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
