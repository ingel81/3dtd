import { describe, it, expect, vi, afterEach } from 'vitest';
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
