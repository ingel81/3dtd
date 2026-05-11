import { Vector3 } from 'three';
import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { EXPLOSION_PRESETS } from '../configs/visual-effects.config';

/**
 * VFX Service - Handles visual effects via events
 *
 * Framework-agnostic service that subscribes to VFX events
 * and spawns visual effects using ThreeTilesEngine.
 */
export class VFXService {
  private readonly subs = new SubscriptionBag();

  // Scratch vectors to avoid per-event allocations in the chain-lightning handler.
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

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
    this.subs.add(this.eventBus.on('vfx:projectile-impact', (event) => {
      this.handleProjectileImpact(event);
    }));

    // Blood effects
    this.subs.add(this.eventBus.on('vfx:blood', (event) => {
      this.handleBloodEffect(event.position, event.intensity, event.skipGroundDecal);
    }));

    // Generic explosions
    this.subs.add(this.eventBus.on('vfx:explosion', (event) => {
      this.handleExplosionEffect(event.position, event.radius);
    }));

    // Muzzle flash on tower fire (projectile towers only)
    this.subs.add(this.eventBus.on('vfx:muzzle-flash', (event) => {
      this.handleMuzzleFlash(event.towerId, event.towerTypeId);
    }));

    // Chain-lightning bolts: spawn one bolt per segment (tip→primary→jump→…)
    this.subs.add(this.eventBus.on('vfx:chain-lightning', (event) => {
      this.handleChainLightning(event.points);
    }));
  }

  /**
   * Spawn lightning bolts for a chain fire. Each successive pair of points
   * gets one bolt mesh. Bolts rely on additive blending + boosted intensity
   * to stand out — auto-enabling bloom turned out to make every emissive
   * material on the map glow permanently, so we explicitly do NOT touch
   * the global bloom pass here.
   */
  private handleChainLightning(points: { x: number; y: number; z: number }[]): void {
    if (points.length < 2) return;

    const now = performance.now() / 1000;
    for (let i = 0; i < points.length - 1; i++) {
      this.tmpA.set(points[i].x, points[i].y, points[i].z);
      this.tmpB.set(points[i + 1].x, points[i + 1].y, points[i + 1].z);
      this.tilesEngine.lightningBolts.spawnBolt(this.tmpA, this.tmpB, now);
    }
  }

  private handleBloodEffect(position: Vector3, intensity: number, skipGroundDecal?: boolean): void {
    const { lat, lon, height } = this.tilesEngine.sync.localToGeo(position);
    const count = Math.max(1, Math.round(intensity));

    this.tilesEngine.effects.spawnBloodSplatter(lat, lon, height, count);

    if (!skipGroundDecal) {
      const decalSize = this.getBloodDecalSize(intensity);
      if (decalSize > 0) {
        const terrainHeight = this.tilesEngine.getTerrainHeightAtGeo(lat, lon);
        const decalHeight = terrainHeight !== null ? terrainHeight : height;
        this.tilesEngine.effects.spawnBloodDecal(lat, lon, decalHeight, decalSize);
      }
    }
  }

  private handleExplosionEffect(position: Vector3, radius: number): void {
    const { lat, lon, height } = this.tilesEngine.sync.localToGeo(position);
    const count = Math.max(10, Math.round(radius));
    this.tilesEngine.effects.spawnExplosionAtGeo(lat, lon, height, count);
  }

  private getBloodDecalSize(intensity: number): number {
    if (intensity >= 30) return 2.0;
    if (intensity >= 10) return 0.8;
    return 0;
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
    const { lat, lon, height, projectileType, targetLost: _targetLost } = event;

    // Select explosion preset based on projectile type
    let preset: number;

    if (projectileType === 'rocket' || projectileType.includes('homing')) {
      // Rocket explosion - large fire effect
      preset = EXPLOSION_PRESETS.rocket.particles;
    } else if (projectileType === 'cannonball') {
      // Cannonball explosion - medium fire effect
      preset = EXPLOSION_PRESETS.cannon.particles;
    } else if (projectileType === 'bullet') {
      // Minimal impact effect for bullets
      preset = EXPLOSION_PRESETS.bullet.particles;
    } else if (projectileType === 'poison-glob') {
      // Small green impact for poison
      preset = EXPLOSION_PRESETS.poison.particles;
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
   * Beam tower type IDs — no muzzle flash for these
   */
  private static readonly BEAM_TOWER_IDS = new Set(['ice', 'magic', 'fire']);

  /**
   * Handle muzzle flash for projectile towers.
   * Spawns additive particles + triggers pooled PointLight on tower renderer.
   */
  private handleMuzzleFlash(towerId: string, towerTypeId: string): void {
    // Skip beam towers (Ice, Magic, Fire)
    if (VFXService.BEAM_TOWER_IDS.has(towerTypeId)) return;

    const towerData = this.tilesEngine.towers.get(towerId);
    if (!towerData) return;

    const terrainPos = this.tilesEngine.sync.geoToLocal(
      towerData.lat,
      towerData.lon,
      towerData.height
    );

    const shootX = terrainPos.x;
    const shootY = towerData.tipY;
    const shootZ = terrainPos.z;

    // 1. Additive particles (3-5 bright yellow/white, ~50ms)
    this.tilesEngine.effects.spawnMuzzleFlash(shootX, shootY, shootZ);

    // 2. Pooled PointLight (reused, removed after 50ms)
    this.tilesEngine.towers.triggerMuzzleFlash(towerId);
  }

  /**
   * Cleanup (call on destroy)
   */
  destroy(): void {
    this.subs.disposeAll();
  }
}
