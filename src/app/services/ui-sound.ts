import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { UI_CUES, type UiCueId } from '../configs/game-sounds.config';

/**
 * The UI's cues (UI_CUES), at the UI volume of the audio menu: a build card
 * picked, a dialog opening and closing, an order to the hero, and the two
 * refusals, too few credits and anything else the game says no to.
 *
 * One for the app, like cameraTimeline, not an Angular service: its callers
 * are services with every kind of test setup, and a cue is a side effect
 * those tests do not care about. The audio comes from connect() (the
 * facade, per game session); silent until then, so in tests as well.
 */
export class UiSound {
  private audio: () => SpatialAudioManager | null = () => null;

  /** Where the audio of a game session is, as long as it runs. */
  connect(audio: () => SpatialAudioManager | null): void {
    this.audio = audio;
  }

  disconnect(): void {
    this.audio = () => null;
  }

  play(cue: UiCueId): void {
    const audio = this.audio();
    if (!audio) return;
    const { id, url, volume } = UI_CUES[cue];
    // Registered on first use, with the engine at hand (a new one after a reload has none)
    if (!audio.getSoundConfig(id)) audio.registerSound(id, url, { volume });
    audio.playUi(id).catch(() => undefined);
  }
}

export const uiSound = new UiSound();
