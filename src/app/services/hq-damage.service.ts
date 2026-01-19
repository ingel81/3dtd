import { Injectable, signal } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { GAME_SOUNDS } from '../configs/audio.config';

/**
 * HQDamageService - Handles HQ fire effects, damage sounds, and game over visuals
 *
 * Extracted from GameStateManager to reduce god object complexity.
 * Manages:
 * - Fire intensity based on health
 * - HQ damage sound
 * - Game over explosion and inferno
 * - Game over screen signal
 */
@Injectable({ providedIn: 'root' })
export class HQDamageService {
  /** Signal to show game over screen (after delay) */
  readonly showGameOverScreen = signal(false);

  private tilesEngine: ThreeTilesEngine | null = null;
  private basePosition: GeoPosition | null = null;

  // Fire effect tracking
  private activeFireId: string | null = null;
  private hqTerrainHeight: number | null = null;

  // Game over timeout for cleanup
  private gameOverTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialize with engine and base position
   */
  initialize(tilesEngine: ThreeTilesEngine, basePosition: GeoPosition): void {
    this.tilesEngine = tilesEngine;
    this.basePosition = basePosition;

    // Register HQ damage sound
    if (tilesEngine.spatialAudio) {
      tilesEngine.spatialAudio.registerSound(
        GAME_SOUNDS.hqDamage.id,
        GAME_SOUNDS.hqDamage.url,
        {
          refDistance: GAME_SOUNDS.hqDamage.refDistance,
          rolloffFactor: GAME_SOUNDS.hqDamage.rolloffFactor,
          volume: GAME_SOUNDS.hqDamage.volume,
        }
      );
    }
  }

  /**
   * Called when tiles are loaded - cache HQ terrain height
   */
  onTilesLoaded(): void {
    if (!this.basePosition || !this.tilesEngine) return;

    const terrainHeight = this.tilesEngine.getTerrainHeightAtGeo(
      this.basePosition.lat,
      this.basePosition.lon
    );
    if (terrainHeight !== null) {
      this.hqTerrainHeight = terrainHeight;
    }
  }

  /**
   * Get cached HQ terrain height
   */
  getHqTerrainHeight(): number | null {
    return this.hqTerrainHeight;
  }

  /**
   * Play HQ damage sound at base position
   */
  playDamageSound(): void {
    if (this.basePosition && this.tilesEngine?.spatialAudio) {
      this.tilesEngine.spatialAudio.playAtGeo(
        GAME_SOUNDS.hqDamage.id,
        this.basePosition.lat,
        this.basePosition.lon,
        this.basePosition.height ?? 0
      ).catch(err => console.warn('[HQDamage] Sound failed:', err));
    }
  }

  /**
   * Update fire intensity based on current health
   *
   * Fire behavior:
   * - HP 51-100%: Brief fire flash (temporary damage indicator)
   * - HP 1-50%: Permanent fire that scales with damage
   * - HP 0%: Handled by triggerGameOver
   */
  updateFireIntensity(currentHealth: number): void {
    if (!this.basePosition || !this.tilesEngine) return;

    // No fire at full health
    if (currentHealth >= 100) {
      if (this.activeFireId) {
        this.tilesEngine.effects.stopFire(this.activeFireId);
        this.activeFireId = null;
      }
      return;
    }

    // Get fire height
    let fireY = this.hqTerrainHeight;
    if (fireY === null) {
      fireY = this.tilesEngine.getTerrainHeightAtGeo(
        this.basePosition.lat,
        this.basePosition.lon
      ) ?? 0;
    }

    // HP above threshold: Brief fire flash
    if (currentHealth > GAME_BALANCE.fire.permanentThreshold) {
      if (this.activeFireId) {
        this.tilesEngine.effects.stopFire(this.activeFireId);
        this.activeFireId = null;
      }
      this.tilesEngine.effects.spawnFireFlash(
        this.basePosition.lat,
        this.basePosition.lon,
        fireY
      );
      return;
    }

    // HP below threshold: Permanent scaled fire
    if (this.activeFireId) {
      this.tilesEngine.effects.stopFireImmediate(this.activeFireId);
    }

    const threshold = GAME_BALANCE.fire.permanentThreshold;
    const scale = 1 - (currentHealth / threshold);

    this.activeFireId = this.tilesEngine.effects.spawnScaledFire(
      this.basePosition.lat,
      this.basePosition.lon,
      fireY,
      scale
    );
  }

  /**
   * Trigger game over visual effects (explosion + inferno)
   * @param onComplete Callback when game over screen should show
   */
  triggerGameOverEffects(onComplete?: () => void): void {
    if (!this.basePosition || !this.tilesEngine) {
      onComplete?.();
      return;
    }

    // Stop existing fire to free particles
    if (this.activeFireId) {
      this.tilesEngine.effects.stopFireImmediate(this.activeFireId);
      this.activeFireId = null;
    }

    // Get terrain height
    let localY = this.hqTerrainHeight;
    if (localY === null) {
      localY = this.tilesEngine.getTerrainHeightAtGeo(
        this.basePosition.lat,
        this.basePosition.lon
      ) ?? 0;
    }

    // Spawn massive HQ destruction explosion
    this.tilesEngine.effects.spawnHQExplosion(
      this.basePosition.lat,
      this.basePosition.lon,
      localY
    );

    // Spawn inferno fire
    this.activeFireId = this.tilesEngine.effects.spawnScaledFire(
      this.basePosition.lat,
      this.basePosition.lon,
      localY,
      1.0 // Maximum intensity
    );

    // Show game over screen after delay
    this.gameOverTimeout = setTimeout(() => {
      this.gameOverTimeout = null;
      this.showGameOverScreen.set(true);
      onComplete?.();
    }, 3000);
  }

  /**
   * Heal base - stop all fires
   */
  healBase(): void {
    if (this.tilesEngine) {
      this.tilesEngine.effects.stopAllFires();
      this.activeFireId = null;
    }
  }

  /**
   * Reset service state
   */
  reset(): void {
    if (this.gameOverTimeout) {
      clearTimeout(this.gameOverTimeout);
      this.gameOverTimeout = null;
    }

    if (this.tilesEngine) {
      this.tilesEngine.effects.stopAllFires();
    }

    this.activeFireId = null;
    this.hqTerrainHeight = null;
    this.showGameOverScreen.set(false);
  }

  /**
   * Spawn debug point at HQ location
   */
  spawnDebugPoint(): void {
    if (!this.basePosition || !this.tilesEngine || this.hqTerrainHeight === null) return;

    this.tilesEngine.effects.spawnDebugSphere(
      this.basePosition.lat,
      this.basePosition.lon,
      this.hqTerrainHeight,
      1,
      0xff0000
    );
  }
}
