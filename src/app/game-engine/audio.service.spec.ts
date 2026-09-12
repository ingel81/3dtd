import { describe, it, expect, vi } from 'vitest';
import { GameEventBus } from './game-event-bus';
import { AudioService } from './audio.service';
import type { ThreeTilesEngine } from '../three-engine';
import { GAME_SOUNDS } from '../configs/audio.config';

describe('AudioService nuclear strike', () => {
  function setup() {
    const eventBus = new GameEventBus();
    const spatialAudio = { registerSound: vi.fn(), playAtGeo: vi.fn(() => Promise.resolve(null)) };
    const service = new AudioService(eventBus, { spatialAudio } as unknown as ThreeTilesEngine);
    return { eventBus, spatialAudio, service };
  }

  it('registers the strike sound', () => {
    const { spatialAudio, service } = setup();
    const { id, url, refDistance, rolloffFactor, volume } = GAME_SOUNDS.nuclearStrike;
    expect(spatialAudio.registerSound).toHaveBeenCalledWith(id, url, { refDistance, rolloffFactor, volume });
    service.destroy();
  });

  it('plays it at the impact point', () => {
    const { eventBus, spatialAudio, service } = setup();
    eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 1,
      target: { lat: 48, lon: 9, height: 310 }, radiusM: 25, hits: 3, kills: 1,
    });
    expect(spatialAudio.playAtGeo).toHaveBeenCalledWith(GAME_SOUNDS.nuclearStrike.id, 48, 9, 310, 1);
    service.destroy();
  });
});
