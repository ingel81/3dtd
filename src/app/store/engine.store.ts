import { Injectable, signal } from '@angular/core';
import { CameraDebugInfo, LoadingStep, TileStats } from './tower-defense.store.types';

@Injectable({ providedIn: 'root' })
export class EngineStore {
  /** Global loading flag */
  readonly loading = signal<boolean>(true);

  // NOTE: tilesLoading, osmLoading, heightsLoading, heightProgress
  // are owned by EngineInitializationService / HeightUpdateService (the writers).
  // Component reads them directly from those services.

  /** Error message (null = no error) */
  readonly error = signal<string | null>(null);

  /** Loading status string for progress UI */
  readonly loadingStatus = signal<string>('Initializing...');

  /** Ordered loading steps */
  readonly loadingSteps = signal<LoadingStep[]>([]);

  /** Frames per second */
  readonly fps = signal<number>(0);

  /** Tile loading statistics */
  readonly tileStats = signal<TileStats>({ parsing: 0, downloading: 0, total: 0, visible: 0 });

  /** Active spatial audio sound count */
  readonly activeSounds = signal<number>(0);

  /** Map attribution text */
  readonly mapAttribution = signal<string>('Map data ©2024 Google');

  /** Camera compass heading (0=N, 90=E, 180=S, 270=W) */
  readonly cameraHeading = signal<number>(0);

  /** Accumulated compass rotation (avoids 0°/360° flip) */
  readonly compassRotation = signal<number>(0);

  /** Camera debug overlay enabled */
  readonly cameraDebugEnabled = signal<boolean>(false);

  /** Camera debug info */
  readonly cameraDebugInfo = signal<CameraDebugInfo | null>(null);

  /** Camera framing debug visualization */
  readonly cameraFramingDebug = signal<boolean>(false);

  /**
   * Update performance stats from engine.
   * Called ~10Hz from the game loop (outside Angular zone).
   * Pure state update — no side effects.
   */
  updateEngineStats(snapshot: {
    fps: number;
    tileStats: TileStats;
    activeSoundCount: number;
    attribution?: string;
    cameraHeading: number;
    cameraDebugInfo?: CameraDebugInfo | null;
  }): void {
    // Only update fps when value changed (avoid unnecessary signal notifications)
    if (this.fps() !== snapshot.fps) {
      this.fps.set(snapshot.fps);
    }

    // Only update tileStats when values changed
    const prev = this.tileStats();
    const next = snapshot.tileStats;
    if (prev.parsing !== next.parsing || prev.downloading !== next.downloading ||
        prev.total !== next.total || prev.visible !== next.visible) {
      this.tileStats.set(next);
    }

    this.activeSounds.set(snapshot.activeSoundCount);

    if (snapshot.attribution) {
      this.mapAttribution.set(snapshot.attribution);
    }

    // Compass heading with wrap-around
    const heading = Math.round(snapshot.cameraHeading);
    if (heading !== this.cameraHeading()) {
      const oldHeading = this.cameraHeading();
      this.cameraHeading.set(heading);

      let delta = heading - oldHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      this.compassRotation.update(rot => rot + delta);
    }

    if (this.cameraDebugEnabled() && snapshot.cameraDebugInfo) {
      this.cameraDebugInfo.set(snapshot.cameraDebugInfo);
    }
  }

  resetAll(): void {
    this.loading.set(true);
    this.error.set(null);
    this.loadingStatus.set('Initializing...');
    this.loadingSteps.set([]);
    this.fps.set(0);
    this.tileStats.set({ parsing: 0, downloading: 0, total: 0, visible: 0 });
    this.activeSounds.set(0);
    this.mapAttribution.set('Map data ©2024 Google');
    this.cameraHeading.set(0);
    this.compassRotation.set(0);
    this.cameraDebugEnabled.set(false);
    this.cameraDebugInfo.set(null);
    this.cameraFramingDebug.set(false);
  }
}
