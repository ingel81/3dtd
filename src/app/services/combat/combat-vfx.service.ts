import { Injectable, inject } from '@angular/core';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { Enemy } from '../../entities/enemy.entity';
import { enemyBloodColor, enemyHitSpot } from '../../utils/enemy-hit-spot';
import { SimCoords } from '../../sim/core/sim-coords';
import { SimOps, type SimSink } from '../../sim/core/sim-sink';

/**
 * CombatVfxService - Visual effects for combat (blood, explosions, ice decals)
 *
 * Extracted from CombatEffectService for Single Responsibility.
 * Pure VFX orchestration — no damage logic, no game state mutations. Blood
 * goes out as `vfx:blood`, ice as ops the main thread completes on the tile
 * ground (SimSink.main).
 */
@Injectable()
export class CombatVfxService {
  private readonly coords = inject(SimCoords);
  private readonly sink: SimSink = inject(SimOps).sink;
  private eventBus: GameEventBus | null = null;

  initialize(eventBus: GameEventBus): void {
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
    if (!this.eventBus) return;

    const position = this.coords.sync.geoToLocalSimple(lat, lon, height);
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
    if (!enemy.typeConfig.canBleed) return;
    const spot = enemyHitSpot(enemy);
    this.emitBloodEffect(spot.lat, spot.lon, spot.height + 1, 40, !!enemy.typeConfig.isAirUnit, enemyBloodColor(enemy));
  }

  // =====================================================
  // ICE EFFECTS
  // =====================================================

  /**
   * Ice explosion and frost decals around an enemy (SimSink.main.iceExplosion):
   * where the hit landed, the burst a little above it for a ground unit.
   */
  emitIceExplosion(enemy: Enemy): void {
    const { lat, lon, height } = enemyHitSpot(enemy);
    const air = !!enemy.typeConfig.isAirUnit;
    const explosionHeight = height + (air ? 0 : 2);
    const groundHeight = enemy.body ? height : enemy.transform.terrainHeight;
    this.sink.main.iceExplosion(lat, lon, explosionHeight, groundHeight, air);
  }

  /** A single frost decal under a splash target of the ice shard (ground units only). */
  emitIceDecal(enemy: Enemy): void {
    if (enemy.typeConfig.isAirUnit) return;
    const { lat, lon, height } = enemyHitSpot(enemy);
    this.sink.main.iceDecal(lat, lon, enemy.body ? height : enemy.transform.terrainHeight);
  }
}
