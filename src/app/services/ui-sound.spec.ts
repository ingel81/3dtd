import { describe, it, expect, vi } from 'vitest';
import { UiSound } from './ui-sound';
import { UI_CUES } from '../configs/game-sounds.config';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';

function fakeAudio() {
  const registered = new Set<string>();
  return {
    registerSound: vi.fn((id: string) => registered.add(id)),
    getSoundConfig: vi.fn((id: string) => (registered.has(id) ? {} : null)),
    playUi: vi.fn(() => Promise.resolve(null)),
  };
}

describe('UiSound', () => {
  it('is silent until connected, and after disconnect', () => {
    const sound = new UiSound();
    const audio = fakeAudio();
    sound.play('denied');
    sound.connect(() => audio as unknown as SpatialAudioManager);
    sound.disconnect();
    sound.play('denied');
    expect(audio.playUi).not.toHaveBeenCalled();
  });

  it('registers a cue on first use with its volume and plays it on the UI channel', () => {
    const sound = new UiSound();
    const audio = fakeAudio();
    sound.connect(() => audio as unknown as SpatialAudioManager);
    sound.play('noMoney');
    sound.play('noMoney');
    const { id, url, volume } = UI_CUES.noMoney;
    expect(audio.registerSound.mock.calls).toEqual([[id, url, { volume }]]);
    expect(audio.playUi.mock.calls).toEqual([[id], [id]]);
  });

  it('registers again with a new engine, which knows none', () => {
    const sound = new UiSound();
    let audio = fakeAudio();
    sound.connect(() => audio as unknown as SpatialAudioManager);
    sound.play('selectBuild');
    audio = fakeAudio();
    sound.play('selectBuild');
    expect(audio.registerSound).toHaveBeenCalledOnce();
  });
});
