import { Injectable } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GameEventBus } from '../game-engine';
import { Enemy } from '../entities/enemy.entity';

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
   * Emit a blood splatter VFX event at the given geo position.
   */
  emitBloodEffect(lat: number, lon: number, height: number, intensity: number): void {
    if (!this.tilesEngine || !this.eventBus) return;

    const position = this.tilesEngine.sync.geoToLocalSimple(lat, lon, height);
    this.eventBus.emitDeferred({
      type: 'vfx:blood',
      position,
      intensity,
    });
  }

  /**
   * Spawn blood effect for a hit on an enemy (if it can bleed).
   */
  emitHitBlood(enemy: Enemy, isSplashDamage: boolean): void {
    if (!enemy.typeConfig.canBleed) return;
    const splatterHeight = enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + 1;
    const intensity = isSplashDamage ? 8 : 15;
    this.emitBloodEffect(enemy.position.lat, enemy.position.lon, splatterHeight, intensity);
  }

  /**
   * Spawn large blood effect when an enemy dies.
   */
  emitDeathBlood(enemy: Enemy): void {
    if (!enemy.typeConfig.canBleed || !this.tilesEngine) return;
    const splatterHeight = enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + 1;
    this.emitBloodEffect(enemy.position.lat, enemy.position.lon, splatterHeight, 40);
  }

  // =====================================================
  // EXPLOSION EFFECTS
  // =====================================================

  /**
   * Spawn a generic explosion VFX at an enemy's position.
   */
  emitExplosion(enemy: Enemy): void {
    if (!this.tilesEngine || !this.eventBus) return;

    const groundOffset = enemy.typeConfig.isAirUnit ? 0 : 2;
    const explosionHeight = enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + groundOffset;

    const explosionPos = this.tilesEngine.sync.geoToLocalSimple(
      enemy.position.lat,
      enemy.position.lon,
      explosionHeight
    );
    this.eventBus.emitDeferred({
      type: 'vfx:explosion',
      position: explosionPos,
      radius: 30,
    });
  }

  // =====================================================
  // ICE EFFECTS
  // =====================================================

  /**
   * Spawn ice explosion + ice decals around an enemy.
   */
  emitIceExplosion(enemy: Enemy): void {
    if (!this.tilesEngine) return;

    const groundOffset = enemy.typeConfig.isAirUnit ? 0 : 2;
    const explosionHeight = enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + groundOffset;

    this.tilesEngine.effects.spawnIceExplosionAtGeo(
      enemy.position.lat,
      enemy.position.lon,
      explosionHeight,
      35
    );

    // Ice decals on ground (only for ground units)
    if (!enemy.typeConfig.isAirUnit) {
      const mainDecalHeight = this.getTerrainHeightForDecal(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight
      );
      this.tilesEngine.effects.spawnIceDecal(
        enemy.position.lat,
        enemy.position.lon,
        mainDecalHeight,
        3.5
      );
      // Additional smaller decals
      for (let i = 0; i < 3; i++) {
        const offsetLat = (Math.random() - 0.5) * 0.00008;
        const offsetLon = (Math.random() - 0.5) * 0.00008;
        const decalLat = enemy.position.lat + offsetLat;
        const decalLon = enemy.position.lon + offsetLon;
        const decalHeight = this.getTerrainHeightForDecal(
          decalLat,
          decalLon,
          enemy.transform.terrainHeight
        );
        this.tilesEngine.effects.spawnIceDecal(
          decalLat,
          decalLon,
          decalHeight,
          1.5 + Math.random() * 1.5
        );
      }
    }
  }

  /**
   * Spawn a single ice decal under an enemy (for splash targets).
   */
  emitIceDecal(enemy: Enemy): void {
    if (!this.tilesEngine || enemy.typeConfig.isAirUnit) return;

    const decalHeight = this.getTerrainHeightForDecal(
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight
    );
    this.tilesEngine.effects.spawnIceDecal(
      enemy.position.lat,
      enemy.position.lon,
      decalHeight,
      2.0 + Math.random()
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
