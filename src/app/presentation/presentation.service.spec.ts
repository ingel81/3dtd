import { describe, it, expect, vi } from 'vitest';
import { PresentationService } from './presentation.service';
import type { PresentationHost } from './presentation-host';

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
