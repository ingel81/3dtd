import { Injectable } from '@angular/core';
import type { PresentationHost } from './presentation-host';

/**
 * Where the UI reaches the presentation (music volume, screen shake, the
 * shot prediction) without knowing when the engine and its PresentationHost
 * come and go. Settings given while no host is attached apply to the next
 * one.
 */
@Injectable({ providedIn: 'root' })
export class PresentationService {
  private current: PresentationHost | null = null;
  private musicVolume: number | null = null;
  private shotPrediction: ((towerId: string) => boolean) | null = null;

  /** The host of the running engine, null without one */
  get host(): PresentationHost | null {
    return this.current;
  }

  /** The engine's host is up (the lead's wiring): it takes the settings given so far. */
  attach(host: PresentationHost): void {
    this.current = host;
    if (this.musicVolume !== null) host.backgroundMusic.setVolume(this.musicVolume);
    host.setShotPrediction(this.shotPrediction);
  }

  detach(host: PresentationHost): void {
    if (this.current === host) this.current = null;
  }

  /** Music volume, 0-1 */
  setMusicVolume(volume: number): void {
    this.musicVolume = volume;
    this.current?.backgroundMusic.setVolume(volume);
  }

  /** The loading screen is gone: the main theme hands over to the build music. */
  onLoadingComplete(): void {
    this.current?.backgroundMusic.onLoadingComplete();
  }

  /** Screen shake on or off (display option); the service starts from the stored option on its own. */
  setScreenShake(enabled: boolean): void {
    if (enabled) this.current?.screenShake.enable();
    else this.current?.screenShake.disable();
  }

  /** Whether a manned tower's shot was shown at the click (ShotPrediction.take); its simulated shot stays quiet. */
  setShotPrediction(take: ((towerId: string) => boolean) | null): void {
    this.shotPrediction = take;
    this.current?.setShotPrediction(take);
  }
}
