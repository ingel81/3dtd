import { clearStrikeEffects } from '../three-engine/strike-effects';
import { Vector3 } from 'three';
import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import {
  BURST_PALETTES,
  EXPLOSION_PRESETS,
  FROST_BOMB_ICE_RINGS,
  MISSILE_LAUNCH_LOOK,
  MUZZLE_FLASH_PROFILES,
  NUCLEAR_STRIKE_SCORCH_RINGS,
  type ScorchSource,
} from '../configs/visual-effects.config';
import { PROJECTILE_TYPES } from '../configs/projectile-types.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import { ABILITIES, ABILITY_IDS, type AbilityId } from '../configs/abilities.config';
import { createMissileStart, launchSiteLoaded, missileStartAt } from '../three-engine/renderers/missile-silo';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { GeoPosition } from '../models/game.types';
import type { GameEvent } from './game-event-bus';
import { enemyBloodColor } from '../utils/enemy-hit-spot';

/** Blood particles per piece a bleeding enemy splits into (the ooze's clumps) */
const SPLIT_SPLASH_PARTICLES = 12;

/** What an ability shows while it is on its way and where it lands. */
interface AbilityVfx {
  used(event: Extract<GameEvent, { type: 'ability:used' }>): void;
  impact(event: Extract<GameEvent, { type: 'ability:impact' }>): void;
}

/** The hero's level-up text: --td-gold-light, larger and longer than a reward popup. */
const HERO_LEVEL_UP_TEXT = { color: '#D9BC68', durationMs: 2200, floatSpeed: 1.4, scale: 1.1 } as const;

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
  /** Where the last missile stood in its silo, see handleLaunch */
  private readonly missileStart = createMissileStart();

  /**
   * Effects per ability, picked by the event's ability id. Complete per
   * AbilityId, so a new ability decides here what it shows.
   */
  private readonly abilityVfx: Record<AbilityId, AbilityVfx> = {
    // Target marker while it is on its way, fired from a silo the missile's
    // flight onto it; mushroom cloud and scorch marks on impact
    'nuclear-strike': {
      used: (event) => {
        this.handleStrikeUsed(event.strikeId, event.target, event.radiusM, event.warningMs);
        if (event.launch) this.handleLaunch(event.abilityId, event.strikeId, event.launch, event.target, event.warningMs);
      },
      impact: (event) => this.handleStrikeImpact(event.strikeId, event.target, event.radiusM),
    },
    // Target marker while the bomb is on its way, frost burst and frost patches where it bursts
    'frost-bomb': {
      used: (event) => this.handleStrikeUsed(event.strikeId, event.target, event.radiusM, event.warningMs),
      impact: (event) => this.handleFrostImpact(event.strikeId, event.target, event.radiusM),
    },
    // Target marker while the pulse charges, the EMP pulse where it goes off
    emp: {
      used: (event) => this.handleStrikeUsed(event.strikeId, event.target, event.radiusM, event.warningMs),
      impact: (event) => this.handleEmpImpact(event.strikeId, event.target, event.radiusM),
    },
    // Target marker and the band of the route it will burn along, then the beam
    'orbital-laser': {
      used: (event) => this.handleStrikeUsed(event.strikeId, event.target, event.radiusM, event.warningMs, event.path),
      impact: (event) => this.handleBeamImpact(event.strikeId, event.path ?? [event.target], event.radiusM),
    },
  };

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
    this.subs.add(this.eventBus.onShow('vfx:projectile-impact', (event) => {
      this.handleProjectileImpact(event);
    }));

    // Blood effects
    this.subs.add(this.eventBus.onShow('vfx:blood', (event) => {
      this.handleBloodEffect(event.position, event.intensity, event.skipGroundDecal, event.color);
    }));

    // Muzzle flash on tower fire (projectile towers only)
    this.subs.add(this.eventBus.onShow('vfx:muzzle-flash', (event) => {
      this.handleMuzzleFlash(event.towerId, event.towerTypeId);
    }));

    // Chain-lightning bolts: spawn one bolt per segment (tip→primary→jump→…)
    this.subs.add(this.eventBus.onShow('vfx:chain-lightning', (event) => {
      this.handleChainLightning(event.points);
    }));

    // Bone burst a metre above the body a split came from. The impact bursts'
    // pool and switch: nothing while impact effects are off (VFX settings).
    // An ooze throws up its debris from its whole body while its band
    // collapses (OozeBandRenderer.collapse), so no burst at its tip. A parent
    // that bleeds (the ooze breaking into clumps along its body) splashes in
    // its blood colour where each piece lands.
    this.subs.add(this.eventBus.onShow('enemy:split', ({ enemy, children }) => {
      if (!enemy.typeConfig.ooze) {
        const height = enemy.transform.terrainHeight + enemy.heightOffset + 1;
        this.tilesEngine.effects.spawnBurstAtGeo(
          enemy.position.lat,
          enemy.position.lon,
          height,
          EXPLOSION_PRESETS.bone.particles,
          BURST_PALETTES.bone,
        );
      }
      if (!enemy.typeConfig.canBleed) return;
      const color = enemyBloodColor(enemy);
      for (const child of children) {
        this.tilesEngine.effects.spawnBloodSplatter(
          child.position.lat,
          child.position.lon,
          child.transform.terrainHeight + 1,
          SPLIT_SPLASH_PARTICLES,
          color,
        );
      }
    }));

    // Abilities: what each one shows, see abilityVfx
    this.subs.add(this.eventBus.onShow('ability:used', (event) => {
      this.abilityVfx[event.abilityId]?.used(event);
    }));
    this.subs.add(this.eventBus.onShow('ability:impact', (event) => {
      this.abilityVfx[event.abilityId]?.impact(event);
    }));
    // The building an ability launches from shows its missile while a charge
    // is ready and no strike is on its way (launchSiteLoaded)
    this.subs.add(this.eventBus.onShow('ability:state-changed', ({ abilities }) => {
      for (const status of abilities) this.showLoaded(status.id, launchSiteLoaded(status));
    }));
    // A restart drops the markers, the missiles and the clouds
    this.subs.add(this.eventBus.onShow('game:reset', () => this.clearStrikes()));

    // Hero level-up: "LEVEL N" in gold rising from his head
    this.subs.add(this.eventBus.onShow('hero:level-up', (event) => this.handleHeroLevelUp(event.level)));
  }

  private handleHeroLevelUp(level: number): void {
    const head = this.tilesEngine.hero.headPosition(this.tmpA);
    if (!head) return;
    const { lat, lon, height } = this.tilesEngine.sync.localToGeo(head);
    this.tilesEngine.effects.spawnFloatingText(`LEVEL ${level}`, lat, lon, height, {
      color: HERO_LEVEL_UP_TEXT.color,
      duration: HERO_LEVEL_UP_TEXT.durationMs,
      floatSpeed: HERO_LEVEL_UP_TEXT.floatSpeed,
      scale: HERO_LEVEL_UP_TEXT.scale,
    });
  }

  private handleStrikeUsed(
    strikeId: number,
    target: GeoPosition,
    radiusM: number,
    warningMs: number,
    path?: readonly GeoPosition[],
  ): void {
    const center = this.tilesEngine.sync.geoToLocalSimpleInto(target.lat, target.lon, target.height ?? 0, this.tmpA);
    if (path) {
      this.tilesEngine.abilityMarkers.showStrike(strikeId, center, radiusM, warningMs, this.localPath(path));
    } else {
      this.tilesEngine.abilityMarkers.showStrike(strikeId, center, radiusM, warningMs);
    }
  }

  /**
   * The missile lifts off its silo and flies onto `target` in the warning's
   * game time (MISSILE_LAUNCH_LOOK, the engine runs it in game time); the
   * impact lands it. It starts where the silo's own missile stands
   * (missileStartAt), which the silo hides at once: in the replay too, which
   * plays no state snapshots.
   */
  private handleLaunch(
    abilityId: AbilityId,
    strikeId: number,
    launch: { towerId: string; position: GeoPosition },
    target: GeoPosition,
    warningMs: number,
  ): void {
    const from = ABILITIES[abilityId].launchFrom;
    if (!from) return;
    const { lat, lon, height } = launch.position;
    const site = this.tilesEngine.sync.geoToLocalSimpleInto(lat, lon, height ?? 0, this.tmpA);
    const start = missileStartAt(this.tilesEngine.towers.get(launch.towerId), from, site, this.missileStart);
    this.showLoaded(abilityId, false);
    const onto = this.tilesEngine.sync.geoToLocalSimpleInto(target.lat, target.lon, target.height ?? 0, this.tmpB);
    this.tilesEngine.missileLaunches.launch(strikeId, start, onto, warningMs / 1000);
  }

  /** The missile in the buildings `id` launches from, shown or hidden; nothing for an ability that launches from none. */
  private showLoaded(id: AbilityId, loaded: boolean): void {
    const from = ABILITIES[id]?.launchFrom;
    if (from) this.tilesEngine.towers.setPartShown(from, MISSILE_LAUNCH_LOOK.missile.node, loaded);
  }

  /** `path` in local coordinates, a new array (a beam's handful of points, once per use). */
  private localPath(path: readonly GeoPosition[]): Vector3[] {
    return path.map((p) => this.tilesEngine.sync.geoToLocalSimpleInto(p.lat, p.lon, p.height ?? 0, new Vector3()));
  }

  /**
   * The marker and the missile go, its smoke stands on, and the mushroom
   * cloud goes up on the ground point (MUSHROOM_CLOUD_LOOK; the engine runs
   * it in game time). Scorch marks burn in on the centre and on
   * NUCLEAR_STRIKE_SCORCH_RINGS around it, each ring turned half a step
   * against the previous one, where they meet route cells.
   */
  private handleStrikeImpact(strikeId: number, target: GeoPosition, radiusM: number): void {
    this.tilesEngine.abilityMarkers.removeStrike(strikeId);
    this.tilesEngine.missileLaunches.land(strikeId);

    const ground = this.tilesEngine.sync.geoToLocalSimpleInto(target.lat, target.lon, target.height ?? 0, this.tmpA);
    this.tilesEngine.mushroomClouds.detonate(ground, radiusM);

    const { x, y, z } = ground;
    const effects = this.tilesEngine.effects;
    effects.markScorch(x, y, z, 'rocket');
    NUCLEAR_STRIKE_SCORCH_RINGS.forEach((ring, ringIndex) => {
      const distance = ring.distance * radiusM;
      for (let i = 0; i < ring.count; i++) {
        const angle = ((i + ringIndex * 0.5) / ring.count) * Math.PI * 2;
        effects.markScorch(x + Math.cos(angle) * distance, y, z + Math.sin(angle) * distance, 'rocket');
      }
    });
  }

  /**
   * The marker goes, the frost burst goes off on the ground point
   * (FROST_BURST_LOOK, in game time) with its rime held as long as the
   * freeze, and frost patches settle on the centre and on
   * FROST_BOMB_ICE_RINGS (ice decals, with ground marks on only).
   */
  private handleFrostImpact(strikeId: number, target: GeoPosition, radiusM: number): void {
    this.tilesEngine.abilityMarkers.removeStrike(strikeId);

    const ground = this.tilesEngine.sync.geoToLocalSimpleInto(target.lat, target.lon, target.height ?? 0, this.tmpA);
    const effect = ABILITIES['frost-bomb'].effect;
    const holdS = effect.kind === 'freeze' ? effect.durationMs / 1000 : 0;
    this.tilesEngine.frostBursts.burst(ground, radiusM, holdS);

    const effects = this.tilesEngine.effects;
    if (!effects.groundMarksEnabled) return;
    const height = target.height ?? 0;
    const lonPerM = 1 / (METERS_PER_DEGREE_LAT * Math.cos(target.lat * DEG_TO_RAD));
    effects.spawnIceDecal(target.lat, target.lon, height, FROST_BOMB_ICE_RINGS[0].size);
    FROST_BOMB_ICE_RINGS.forEach((ring, ringIndex) => {
      const distance = ring.distance * radiusM;
      for (let i = 0; i < ring.count; i++) {
        const angle = ((i + ringIndex * 0.5) / ring.count) * Math.PI * 2;
        effects.spawnIceDecal(
          target.lat + (Math.sin(angle) * distance) / METERS_PER_DEGREE_LAT,
          target.lon + Math.cos(angle) * distance * lonPerM,
          height,
          ring.size,
        );
      }
    });
  }

  /**
   * The marker goes and the beam comes down on the start of `path` and runs
   * along it (ORBITAL_BEAM_LOOK, in game time, at the ability's speed for
   * its duration), leaving its own wide, dark scorch marks (source `beam`)
   * on the route cells it passes.
   */
  private handleBeamImpact(strikeId: number, path: readonly GeoPosition[], radiusM: number): void {
    this.tilesEngine.abilityMarkers.removeStrike(strikeId);
    const effect = ABILITIES['orbital-laser'].effect;
    if (effect.kind !== 'beam') return;
    const effects = this.tilesEngine.effects;
    this.tilesEngine.orbitalBeams.fire(
      this.localPath(path),
      radiusM,
      effect.speedMps,
      effect.durationMs / 1000,
      (x, y, z) => effects.markScorch(x, y, z, 'beam'),
    );
  }

  /** The marker goes and the EMP pulse runs out from the ground point (EMP_PULSE_LOOK, in game time). */
  private handleEmpImpact(strikeId: number, target: GeoPosition, radiusM: number): void {
    this.tilesEngine.abilityMarkers.removeStrike(strikeId);
    const ground = this.tilesEngine.sync.geoToLocalSimpleInto(target.lat, target.lon, target.height ?? 0, this.tmpA);
    this.tilesEngine.empPulses.pulse(ground, radiusM);
  }

  private clearStrikes(): void {
    clearStrikeEffects(this.tilesEngine);
    // A new game's silo stands loaded until a snapshot says otherwise
    for (const id of ABILITY_IDS) this.showLoaded(id, true);
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

  private handleBloodEffect(position: Vector3, intensity: number, skipGroundDecal?: boolean, color?: number): void {
    const { lat, lon, height } = this.tilesEngine.sync.localToGeo(position);
    const count = Math.max(1, Math.round(intensity));

    this.tilesEngine.effects.spawnBloodSplatter(lat, lon, height, count, color);

    // With ground marks off there is no decal, and no terrain raycast for one
    if (!skipGroundDecal && this.tilesEngine.effects.groundMarksEnabled) {
      const decalSize = this.getBloodDecalSize(intensity);
      if (decalSize > 0) {
        const terrainHeight = this.tilesEngine.getTerrainHeightAtGeo(lat, lon);
        const decalHeight = terrainHeight !== null ? terrainHeight : height;
        this.tilesEngine.effects.spawnBloodDecal(lat, lon, decalHeight, decalSize, color);
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
    } else if (projectileType === 'bullet' || projectileType === 'hero-round') {
      // Minimal impact effect for bullets
      effects.spawnExplosionAtGeo(lat, lon, height, EXPLOSION_PRESETS.bullet.particles);
    } else if (projectileType === 'hero-shell') {
      // The hero's explosive round: a small blast, visual only (no splash)
      const { particles, radius, smokePuffs } = EXPLOSION_PRESETS.heroShell;
      effects.spawnExplosionAtGeo(lat, lon, height, particles, radius, smokePuffs);
    } else if (projectileType === 'hero-rune') {
      // The hero's rune round: a few sparks in the arcane orb's colours
      effects.spawnBurstAtGeo(lat, lon, height, EXPLOSION_PRESETS.heroRune.particles, BURST_PALETTES.arcane);
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
    // Markers and clouds belong to the engine: game:reset clears them, engine.dispose() frees them
  }
}
