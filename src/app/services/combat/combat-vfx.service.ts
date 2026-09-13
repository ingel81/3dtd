import { Injectable } from '@angular/core';
import { ThreeTilesEngine } from '../../three-engine';
import { GameEventBus } from '../../game-engine';
import { Enemy } from '../../entities/enemy.entity';
import { enemyBloodColor, enemyHitSpot } from '../../utils/enemy-hit-spot';

/**
 * CombatVfxService - Visual effects for combat (blood, explosions, ice decals)
 *
 * Extracted from CombatEffectService for Single Responsibility.
 * Pure VFX orchestration — no damage logic, no game state mutations.
 */
@Injectable({ providedIn: 'root' })
export class CombatVfxService {
  private tilesEngine: ThreeTilesEngine | null = null;
  private eventBus: GameEventBus | null = null;

  initialize(tilesEngine: ThreeTilesEngine, eventBus: GameEventBus): void {
    this.tilesEngine = tilesEngine;
    this.eventBus = eventBus;
  }

  // =====================================================
  // BLOOD EFFECTS
  // =====================================================

  /**
   * Emit a blood splatter VFX event at the given geo position. `color` is
   * the blood's colour as hex (EnemyTypeConfig.bloodColor), red when unset.
   */
  emitBloodEffect(
    lat: number,
    lon: number,
    height: number,
    intensity: number,
    skipGroundDecal = false,
    color?: number,
  ): void {
    if (!this.tilesEngine || !this.eventBus) return;

    const position = this.tilesEngine.sync.geoToLocalSimple(lat, lon, height);
    this.eventBus.emitDeferred({
      type: 'vfx:blood',
      position,
      intensity,
      skipGroundDecal,
      color,
    });
  }

  /**
   * Spawn blood effect for a hit on an enemy (if it can bleed), where the hit
   * landed (enemyHitSpot).
   */
  emitHitBlood(enemy: Enemy, isSplashDamage: boolean): void {
    if (!enemy.typeConfig.canBleed) return;
    const spot = enemyHitSpot(enemy);
    const intensity = isSplashDamage ? 8 : 15;
    this.emitBloodEffect(spot.lat, spot.lon, spot.height + 1, intensity, !!enemy.typeConfig.isAirUnit, enemyBloodColor(enemy));
  }

  /**
   * Spawn large blood effect when an enemy dies.
   */
  emitDeathBlood(enemy: Enemy): void {
    if (!enemy.typeConfig.canBleed || !this.tilesEngine) return;
    const spot = enemyHitSpot(enemy);
    this.emitBloodEffect(spot.lat, spot.lon, spot.height + 1, 40, !!enemy.typeConfig.isAirUnit, enemyBloodColor(enemy));
  }

  // =====================================================
  // ICE EFFECTS
  // =====================================================

  /**
   * Spawn ice explosion + ice decals around an enemy.
   */
  emitIceExplosion(enemy: Enemy): void {
    if (!this.tilesEngine) return;

    // Where the hit landed; copied, the decal raycasts below reuse nothing of it
    const { lat, lon, height } = enemyHitSpot(enemy);
    const groundOffset = enemy.typeConfig.isAirUnit ? 0 : 2;
    const explosionHeight = height + groundOffset;
    const groundHeight = enemy.body ? height : enemy.transform.terrainHeight;

    this.tilesEngine.effects.spawnIceExplosionAtGeo(
      lat,
      lon,
      explosionHeight,
      35
    );

    // Ice decals on ground (only for ground units). Sizes are diameters of
    // round decals; until 2026-09-12 they were 3.5, 1.5-3 and 2-3 and gave
    // ovals of 2*size by 2 m, the diameters below keep that area (2 * sqrt).
    // None while ground marks are off, which also spares the four terrain raycasts
    if (!enemy.typeConfig.isAirUnit && this.tilesEngine.effects.groundMarksEnabled) {
      const mainDecalHeight = this.getTerrainHeightForDecal(lat, lon, groundHeight);
      this.tilesEngine.effects.spawnIceDecal(
        lat,
        lon,
        mainDecalHeight,
        3.7
      );
      // Additional smaller decals
      for (let i = 0; i < 3; i++) {
        const offsetLat = (Math.random() - 0.5) * 0.00008;
        const offsetLon = (Math.random() - 0.5) * 0.00008;
        const decalLat = lat + offsetLat;
        const decalLon = lon + offsetLon;
        const decalHeight = this.getTerrainHeightForDecal(
          decalLat,
          decalLon,
          groundHeight
        );
        this.tilesEngine.effects.spawnIceDecal(
          decalLat,
          decalLon,
          decalHeight,
          2.4 + Math.random() * 1.1
        );
      }
    }
  }

  /**
   * Spawn a single ice decal under an enemy (for splash targets), none
   * while ground marks are off.
   */
  emitIceDecal(enemy: Enemy): void {
    if (!this.tilesEngine || enemy.typeConfig.isAirUnit || !this.tilesEngine.effects.groundMarksEnabled) return;

    const { lat, lon, height } = enemyHitSpot(enemy);
    const decalHeight = this.getTerrainHeightForDecal(
      lat,
      lon,
      enemy.body ? height : enemy.transform.terrainHeight
    );
    this.tilesEngine.effects.spawnIceDecal(
      lat,
      lon,
      decalHeight,
      2.8 + Math.random() * 0.7 // diameter, was 2-3 as an oval (see emitIceExplosion)
    );
  }

  // =====================================================
  // TERRAIN HELPERS
  // =====================================================

  /**
   * Get terrain height at geo position with raycast (for accurate decal placement).
   */
  private getTerrainHeightForDecal(lat: number, lon: number, fallbackHeight: number): number {
    if (!this.tilesEngine) return fallbackHeight + 0.15;

    const terrainY = this.tilesEngine.getTerrainHeightAtGeo(lat, lon);
    if (terrainY === null) return fallbackHeight + 0.15;

    const origin = this.tilesEngine.sync.getOrigin();
    return terrainY + origin.height + 0.15;
  }
}
