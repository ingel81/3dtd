import { GameEventBus } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { EXPLOSION_PRESETS } from '../configs/visual-effects.config';

/**
 * VFX Service - Handles visual effects via events
 *
 * Framework-agnostic service that subscribes to VFX events
 * and spawns visual effects using ThreeTilesEngine.
 */
export class VFXService {
  constructor(
    private eventBus: GameEventBus,
    private tilesEngine: ThreeTilesEngine
  ) {
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for VFX events
   */
  private setupEventHandlers(): void {
    // Projectile impact effects
    this.eventBus.on('vfx:projectile-impact', (event) => {
      this.handleProjectileImpact(event);
    });

    // Blood effects (for later)
    this.eventBus.on('vfx:blood', (event) => {
      // TODO: Implement blood effect
      console.log('[VFXService] Blood effect at', event.position);
    });

    // Generic explosions (for later)
    this.eventBus.on('vfx:explosion', (event) => {
      // TODO: Implement generic explosion
      console.log('[VFXService] Explosion at', event.position, 'radius:', event.radius);
    });
  }

  /**
   * Handle projectile impact effect
   */
  private handleProjectileImpact(event: {
    lat: number;
    lon: number;
    height: number;
    projectileType: string;
    targetLost: boolean;
  }): void {
    const { lat, lon, height, projectileType, targetLost } = event;

    // Select explosion preset based on projectile type
    let preset: any;

    if (projectileType === 'rocket' || projectileType.includes('homing')) {
      // Rocket explosion - large fire effect
      preset = EXPLOSION_PRESETS.rocket.particles;
    } else if (projectileType === 'cannonball') {
      // Cannonball explosion - medium fire effect
      preset = EXPLOSION_PRESETS.cannon.particles;
    } else if (projectileType === 'bullet') {
      // Minimal impact effect for bullets
      preset = EXPLOSION_PRESETS.bullet.particles;
    } else if (projectileType !== 'arrow') {
      // Small impact effect for other projectiles (ice, etc.)
      preset = EXPLOSION_PRESETS.small.particles;
    } else {
      // No effect for arrows
      return;
    }

    // Spawn explosion effect
    this.tilesEngine.effects.spawnExplosionAtGeo(lat, lon, height, preset);
  }

  /**
   * Cleanup (call on destroy)
   */
  destroy(): void {
    // Events auto-cleanup via WeakMap in EventBus
    // Nothing to do here unless we add manual cleanup
  }
}
