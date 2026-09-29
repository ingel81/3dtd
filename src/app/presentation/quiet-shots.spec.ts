import { describe, it, expect, vi } from 'vitest';
import { QuietShots } from './quiet-shots';
import { PresentationService } from './presentation.service';
import type { PresentationHost } from './presentation-host';

describe('QuietShots', () => {
  it('takes the prediction once per shot: the sound asks, the flash after it gets the same answer', () => {
    const predicted = new Set(['tower-1']);
    const take = vi.fn((id: string) => predicted.delete(id));
    const shots = new QuietShots();
    shots.setSource(take);

    expect(shots.sound('tower-1')).toBe(true);
    expect(shots.sound('tower-1')).toBe(false);
    expect(shots.flash('tower-1')).toBe(true);
    expect(shots.flash('tower-1')).toBe(false);
    expect(take).toHaveBeenCalledTimes(2);
  });

  it('asks for a flash without a sound, and forgets unanswered sounds at the end of the frame', () => {
    const take = vi.fn(() => true);
    const shots = new QuietShots();
    expect(shots.flash('tower-1')).toBe(false);
    shots.setSource(take);
    shots.sound('tower-2');
    shots.endFrame();
    expect(shots.flash('tower-2')).toBe(true);
    expect(take).toHaveBeenCalledTimes(2);
  });
});

describe('PresentationService', () => {
  function host() {
    return {
      backgroundMusic: { setVolume: vi.fn(), onLoadingComplete: vi.fn() },
      screenShake: { enable: vi.fn(), disable: vi.fn() },
      setShotPrediction: vi.fn(),
    };
  }

  it('hands settings given before the host to it when it attaches, and later ones at once', () => {
    const service = new PresentationService();
    const take = () => false;
    service.setMusicVolume(0.3);
    service.setShotPrediction(take);
    service.setScreenShake(false);
    const h = host();
    service.attach(h as unknown as PresentationHost);
    expect(h.backgroundMusic.setVolume).toHaveBeenCalledWith(0.3);
    expect(h.setShotPrediction).toHaveBeenCalledWith(take);

    service.setScreenShake(false);
    service.onLoadingComplete();
    expect(h.screenShake.disable).toHaveBeenCalledTimes(1);
    expect(h.backgroundMusic.onLoadingComplete).toHaveBeenCalled();

    service.detach(h as unknown as PresentationHost);
    expect(service.host).toBeNull();
  });
});
