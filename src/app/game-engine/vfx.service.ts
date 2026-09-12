import { Vector3 } from 'three';
import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { BURST_PALETTES, EXPLOSION_PRESETS, MUZZLE_FLASH_PROFILES, type ScorchSource } from '../configs/visual-effects.config';
import { PROJECTILE_TYPES } from '../configs/projectile-types.config';
import type { TowerTypeId } from '../configs/tower-types.config';

/**
 * VFX Service - Handles visual effects via events
 *
 * Framework-agnostic service that subscribes to VFX events
 * and spawns visual effects using ThreeTilesEngine.
 */
export class VFXService {
  private readonly subs = new SubscriptionBag();

  // Scratch vectors to avoid per-event allocations (chain lightning, scorch marks).
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

    // Muzzle flash on tower fire (projectile towers only)
    this.subs.add(this.eventBus.on('vfx:muzzle-flash', (event) => {
      this.handleMuzzleFlash(event.towerId, event.towerTypeId);
    }));

    // Chain-lightning bolts: spawn one bolt per segment (tip→primary→jump→…)
    this.subs.add(this.eventBus.on('vfx:chain-lightning', (event) => {
      this.handleChainLightning(event.points);
    }));

    // Bone burst a metre above the body a split came from. The impact bursts'
    // pool and switch: nothing while impact effects are off (VFX settings).
    this.subs.add(this.eventBus.on('enemy:split', ({ enemy }) => {
      const height = enemy.transform.terrainHeight + enemy.typeConfig.heightOffset + 1;
      this.tilesEngine.effects.spawnBurstAtGeo(
        enemy.position.lat,
        enemy.position.lon,
        height,
        EXPLOSION_PRESETS.bone.particles,
        BURST_PALETTES.bone,
      );
    }));
  }

  /**
   * Spawn lightning bolts for a chain fire. Each successive pair of points
   * gets one bolt (one instance in the bolt renderer). Bolts rely on additive
   * blending + boosted intensity to stand out: auto-enabling bloom turned
   * out to make every emissive material on the map glow permanently, so we
   * explicitly do NOT touch the global bloom pass here.
   *
   * Each bolt also requests a pooled additive halo sprite at its end (the
   * impact point on the hit enemy). The halo fades with the bolt's lifetime
   * and briefly brightens whatever is behind it, a local-scope substitute
   * for global bloom (3D Tiles ignore dynamic lights).
   */
  private handleChainLightning(points: { x: number; y: number; z: number }[]): void {
    if (points.length < 2) return;

    const now = performance.now() / 1000;
    for (let i = 0; i < points.length - 1; i++) {
      this.tmpA.set(points[i].x, points[i].y, points[i].z);
      this.tmpB.set(points[i + 1].x, points[i + 1].y, points[i + 1].z);
      this.tilesEngine.lightningBolts.spawnBolt(this.tmpA, this.tmpB, now, {
        attachLight: true,
      });
    }
  }

  private handleBloodEffect(position: Vector3, intensity: number, skipGroundDecal?: boolean): void {
    const { lat, lon, height } = this.tilesEngine.sync.localToGeo(position);
    const count = Math.max(1, Math.round(intensity));

    this.tilesEngine.effects.spawnBloodSplatter(lat, lon, height, count);

    // With ground marks off there is no decal, and no terrain raycast for one
    if (!skipGroundDecal && this.tilesEngine.effects.groundMarksEnabled) {
      const decalSize = this.getBloodDecalSize(intensity);
      if (decalSize > 0) {
        const terrainHeight = this.tilesEngine.getTerrainHeightAtGeo(lat, lon);
        const decalHeight = terrainHeight !== null ? terrainHeight : height;
        this.tilesEngine.effects.spawnBloodDecal(lat, lon, decalHeight, decalSize);
      }
    }
  }

  /**
   * Blood decal diameter in meters. Until 2026-09-12 these were 2.0 and 0.8
   * and gave ovals of 2*size by 2 m; the round decals keep their area
   * (diameter 2 * sqrt(old size)).
   */
  private getBloodDecalSize(intensity: number): number {
    if (intensity >= 30) return 2.8;
    if (intensity >= 10) return 1.8;
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
    const { lat, lon, height, projectileType } = event;
    const effects = this.tilesEngine.effects;

    if (projectileType === 'rocket' || projectileType.includes('homing')) {
      // Rocket explosion - large fire effect, the radius is visual only
      const { particles, radius, smokePuffs } = EXPLOSION_PRESETS.rocket;
      effects.spawnExplosionAtGeo(lat, lon, height, particles, radius, smokePuffs);
      this.markScorch(lat, lon, height, 'rocket');
    } else if (projectileType === 'cannonball') {
      // Cannonball explosion - as wide as the splash that deals its damage
      const { particles, smokePuffs } = EXPLOSION_PRESETS.cannon;
      const radius = PROJECTILE_TYPES.cannonball.splashRadius ?? EXPLOSION_PRESETS.cannon.radius;
      effects.spawnExplosionAtGeo(lat, lon, height, particles, radius, smokePuffs);
      this.markScorch(lat, lon, height, 'cannon');
    } else if (projectileType === 'bullet') {
      // Minimal impact effect for bullets
      effects.spawnExplosionAtGeo(lat, lon, height, EXPLOSION_PRESETS.bullet.particles);
    } else if (projectileType === 'poison-glob') {
      // Green spark burst instead of the fire-atlas explosion
      effects.spawnBurstAtGeo(lat, lon, height, EXPLOSION_PRESETS.poison.particles, BURST_PALETTES.poison);
    } else if (projectileType === 'arcane-orb') {
      // Violet/cyan spark burst instead of the fire-atlas explosion
      effects.spawnBurstAtGeo(lat, lon, height, EXPLOSION_PRESETS.arcane.particles, BURST_PALETTES.arcane);
    } else if (projectileType === 'chaos-orb') {
      // Same burst in violet/magenta for the Chaos Tower
      effects.spawnBurstAtGeo(lat, lon, height, EXPLOSION_PRESETS.chaos.particles, BURST_PALETTES.chaos);
    }
    // Nothing for arrows. The ice shard's burst and frost decals come from
    // the hit itself (CombatVfxService.emitIceExplosion).
  }

  /**
   * Scorch mark on the ground below an impact. The effects renderer keeps
   * one per route cell and skips hits off the route or high in the air.
   */
  private markScorch(lat: number, lon: number, height: number, source: ScorchSource): void {
    const p = this.tilesEngine.sync.geoToLocalSimpleInto(lat, lon, height, this.tmpA);
    this.tilesEngine.effects.markScorch(p.x, p.y, p.z, source);
  }

  /**
   * Handle muzzle flash for projectile towers.
   * Only towers with a MUZZLE_FLASH_PROFILES entry flash (Archer, Gatling,
   * Cannon, Rocket); the profile sizes the additive particles and the pooled
   * PointLight on the tower renderer.
   */
  private handleMuzzleFlash(towerId: string, towerTypeId: string): void {
    const profile = MUZZLE_FLASH_PROFILES[towerTypeId as TowerTypeId];
    if (!profile) return;

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

    // 1. Additive particles (bright yellow/white, a few ten ms)
    this.tilesEngine.effects.spawnMuzzleFlash(shootX, shootY, shootZ, profile);

    // 2. Pooled PointLight (always in the scene, lit for 50 ms)
    if (profile.lightIntensity > 0) {
      this.tilesEngine.towers.triggerMuzzleFlash(towerId, profile.lightIntensity);
    }
  }

  /**
   * Cleanup (call on destroy)
   */
  destroy(): void {
    this.subs.disposeAll();
  }
}
