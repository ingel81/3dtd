import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameEventBus } from './game-event-bus';
import { AudioService } from './audio.service';
import type { ThreeTilesEngine } from '../three-engine';
import { ABILITY_IMPACT_SOUNDS, GAME_SOUNDS } from '../configs/audio.config';

const { id, tail } = GAME_SOUNDS.nuclearStrike;
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
      target: { lat: 48, lon: 9, height: 310 }, radiusM: 25, hits: 3, kills: 1,
    });
    /** `ms` of game time in sub-steps, as GameStateManager runs them */
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += STEP_MS) service.update(STEP_MS);
    };
    return { eventBus, spatialAudio, service, impact, run };
  }

  it('registers the strike sound', () => {
    const { spatialAudio, service } = setup();
    const { url, refDistance, rolloffFactor, volume, maxInstances } = GAME_SOUNDS.nuclearStrike;
    expect(spatialAudio.registerSound).toHaveBeenCalledWith(id, url, { refDistance, rolloffFactor, volume, maxInstances });
    // The impact and every repeat of the tail play at once
    expect(maxInstances).toBeGreaterThan(tail.length);
    service.destroy();
  });

  it('plays it at the impact point, then quieter repeats for a rumbling tail, in game time', () => {
    const { spatialAudio, service, impact, run } = setup();
    impact();
    expect(spatialAudio.playAtGeo.mock.calls).toEqual([[id, 48, 9, 310, 1]]);

    run(FIRST_TAIL_MS - 2 * STEP_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(1);

    run(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo.mock.calls).toEqual([
      [id, 48, 9, 310, 1],
      ...tail.map((repeat) => [id, 48, 9, 310, repeat.volume]),
    ]);
    for (const repeat of tail) expect(repeat.volume).toBeLessThan(1);
    service.destroy();
  });

  it('plays the sound of the ability that landed: one without an entry stays silent', () => {
    const { eventBus, spatialAudio, service, run } = setup();
    expect(ABILITY_IMPACT_SOUNDS['nuclear-strike']).toBe(GAME_SOUNDS.nuclearStrike);
    // Stands for an ability added later; the typed table would not compile without its entry
    eventBus.emit({
      type: 'ability:impact', abilityId: 'later-ability' as never, strikeId: 2,
      target: { lat: 48, lon: 9, height: 310 }, radiusM: 25, hits: 3, kills: 1,
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
