import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameEventBus } from './game-event-bus';
import { AudioService } from './audio.service';
import type { ThreeTilesEngine } from '../three-engine';
import { GAME_SOUNDS } from '../configs/audio.config';

const { id, tail } = GAME_SOUNDS.nuclearStrike;
const LAST_TAIL_MS = Math.max(...tail.map((repeat) => repeat.delayMs));

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
    return { eventBus, spatialAudio, service, impact };
  }

  it('registers the strike sound', () => {
    const { spatialAudio, service } = setup();
    const { url, refDistance, rolloffFactor, volume, maxInstances } = GAME_SOUNDS.nuclearStrike;
    expect(spatialAudio.registerSound).toHaveBeenCalledWith(id, url, { refDistance, rolloffFactor, volume, maxInstances });
    // The impact and every repeat of the tail play at once
    expect(maxInstances).toBeGreaterThan(tail.length);
    service.destroy();
  });

  it('plays it at the impact point, then quieter repeats for a rumbling tail', () => {
    vi.useFakeTimers();
    const { spatialAudio, service, impact } = setup();
    impact();
    expect(spatialAudio.playAtGeo.mock.calls).toEqual([[id, 48, 9, 310, 1]]);

    vi.advanceTimersByTime(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo.mock.calls).toEqual([
      [id, 48, 9, 310, 1],
      ...tail.map((repeat) => [id, 48, 9, 310, repeat.volume]),
    ]);
    for (const repeat of tail) expect(repeat.volume).toBeLessThan(1);
    service.destroy();
  });

  it('drops the repeats still to come on a restart and on destroy', () => {
    vi.useFakeTimers();
    const { eventBus, spatialAudio, service, impact } = setup();
    impact();
    eventBus.emit({ type: 'game:reset' });
    vi.advanceTimersByTime(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(1);

    impact();
    service.destroy();
    vi.advanceTimersByTime(LAST_TAIL_MS);
    expect(spatialAudio.playAtGeo).toHaveBeenCalledTimes(2);
  });
});
