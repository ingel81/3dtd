import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import {
  TransformComponent,
  HealthComponent,
  RenderComponent,
  AudioComponent,
  MovementComponent,
} from '../game-components';
import { GeoPosition } from '../models/game.types';
import { EnemyTypeId, getEnemyType, EnemyTypeConfig } from '../configs/enemy-types.config';
import { ArmorType } from '../configs/combat/combat.types';
import type { RouteCell } from '../utils/route-cell';
import type { AirPortalExit } from '../utils/air-portal-exit';
import type { WormLink } from '../managers/worm/worm-group';
import type { RouteBody } from '../utils/route-body';
import type { SpatialEntry } from '../services/world/spatial-grid.service';
import type { EnemyInstanceState } from '../three-engine/renderers/instanced-enemy/enemy-instance.manager';
import { EnemyRush } from './enemy-rush';

/**
 * Enemy entity - combines Transform, Health, Render, Movement, and Audio components
 */
export class Enemy extends GameObject {
  readonly typeConfig: EnemyTypeConfig;

  // Armor type override (e.g., Armor Break sets this to 'unarmored')
  private _armorTypeOverride: ArmorType | null = null;

  // Component shortcuts
  private _transform!: TransformComponent;
  private _health!: HealthComponent;
  private _render!: RenderComponent;
  private _movement!: MovementComponent;
  private _audio!: AudioComponent;

  private isMoving = false;

  // ── Hot-path mirrors and caches ─────────────────────────────────
  // EnemyManager touches every enemy several times a frame. These plain
  // fields let it answer "anything to do?" and find the enemy's grid and
  // render slots without loading a component or hashing the string id into
  // a 20k-entry Map. Each is written only by the owner named on it, and every
  // cache is validated before use, so none of them can change an outcome.

  /** Mirror of `health.isDead`. Written only by HealthComponent (DeathFlagSink). */
  deadFlag = false;
  /** Whether the audio component holds loop handles. Written only by AudioComponent (LoopFlagSink). */
  hasAudioLoops = false;
  /**
   * Game time to the next random call (ms), -1 while none is due: the enemy
   * has no randomSound or does not move. Written only by the enemy itself;
   * EnemyManager ticks it (tickRandomSound) in game time, so the calls stop
   * in the pause and follow the game speed.
   */
  randomSoundLeftMs = -1;
  /** Whether the transform still turns toward its heading. Written only by TransformComponent (TurningFlagSink). */
  isTurning = false;
  /** GlobalRouteGrid's memo of this enemy's last cell evaluation, see updateEnemyPosition(). */
  routeCellGen = -1;
  routeCellKey = 0;
  routeCell: RouteCell | undefined = undefined;
  /** SpatialGrid entry kept by EnemyManager, re-validated on every use (SpatialGrid.updateTracked). */
  spatialEntry: SpatialEntry | null = null;
  /** Renderer instance slot, resolved lazily by EnemyManager.presentFrame(). */
  renderSlot: EnemyInstanceState | null = null;
  /**
   * Walk/run alternation, only for types with `animationVariation` and a run
   * clip; null for everyone else, so EnemyManager skips it on a field check.
   */
  readonly rush: EnemyRush | null;

  /**
   * Height of the model origin above `transform.terrainHeight` (m): the
   * type's `heightOffset`, lower while an air unit climbs out of its spawn
   * portal (`portalExit`). Everything placed on or aimed at the model reads
   * this, not the config.
   */
  heightOffset: number;
  /**
   * An air unit's way out of its spawn portal, null once it cruises and for
   * every other enemy. Written only by EnemyManager, which sets
   * `heightOffset` from it every sub-step.
   */
  portalExit: AirPortalExit | null = null;
  /**
   * A worm segment's place in its chain (managers/worm), null for every other
   * enemy. Written only by EnemyManager at spawn; the chain writes its
   * target every sub-step.
   */
  worm: WormLink | null = null;
  /**
   * The body along the route of an enemy that lies on it instead of standing
   * on it (the ooze, OozeConfig), null for every other enemy. Set by
   * EnemyManager at the spawn; hits, radius queries and the renderer use it
   * instead of `position`.
   */
  body: RouteBody | null = null;

  /**
   * `startIndex` and `startProgress` start the enemy part-way along `path`
   * (a split child where its parent died), see MovementComponent.setPath().
   */
  constructor(
    typeId: EnemyTypeId,
    path: GeoPosition[],
    speedOverride?: number,
    startIndex = 0,
    startProgress = 0,
  ) {
    super('enemy');
    this.typeConfig = getEnemyType(typeId);
    this.heightOffset = this.typeConfig.heightOffset;
    this.rush =
      this.typeConfig.animationVariation && this.typeConfig.runAnimation
        ? new EnemyRush(this.id, this.typeConfig.runSpeedMultiplier ?? 1)
        : null;

    // Add components
    this._transform = this.addComponent(
      new TransformComponent(this, this),
      ComponentType.TRANSFORM
    );
    this._health = this.addComponent(
      new HealthComponent(this, this.typeConfig.baseHp, this),
      ComponentType.HEALTH
    );
    this._render = this.addComponent(
      new RenderComponent(this),
      ComponentType.RENDER
    );
    this._movement = this.addComponent(
      new MovementComponent(this),
      ComponentType.MOVEMENT
    );
    this._audio = this.addComponent(
      new AudioComponent(this, this),
      ComponentType.AUDIO
    );

    // Configure movement
    this._movement.setPath(path, startIndex, startProgress);
    this._movement.speedMps = speedOverride ?? this.typeConfig.baseSpeed;

    // Register sounds
    if (this.typeConfig.movingSound) {
      this._audio.registerSound('moving', this.typeConfig.movingSound, {
        volume: this.typeConfig.movingSoundVolume ?? 0.3,
        refDistance: this.typeConfig.movingSoundRefDistance ?? 30,
        loop: true,
        randomStart: this.typeConfig.randomSoundStart ?? false,
      });
    }

    // Register random sound (not looped, played in game time, see
    // tickRandomSound). At volume 1: each call picks its own volume between
    // randomSoundVolumeMin and Max, which would otherwise be scaled twice.
    if (this.typeConfig.randomSound) {
      this._audio.registerSound('randomSound', this.typeConfig.randomSound, {
        volume: 1,
        refDistance: this.typeConfig.randomSoundRefDistance ?? 30,
        loop: false,
      });
    }
  }

  /** Get effective armor type (checks for active override like Armor Break, then falls back to config). */
  getEffectiveArmorType(): ArmorType {
    return this._armorTypeOverride ?? this.typeConfig.armorType;
  }

  // Convenience getters
  get transform(): TransformComponent {
    return this._transform;
  }
  get health(): HealthComponent {
    return this._health;
  }
  get render(): RenderComponent {
    return this._render;
  }
  get movement(): MovementComponent {
    return this._movement;
  }
  get audio(): AudioComponent {
    return this._audio;
  }

  /**
   * `!health.isDead`, read from the mirror so the check does not load the
   * health component, and still in the world.
   *
   * `active` goes false when the EnemyManager removes the enemy. Without it
   * a leak at the HQ stayed "alive" for everyone holding a reference: a leak
   * is no kill, so its HP is untouched. A tower that had it as its target
   * kept it on findTarget's fast path — the mesh was gone, but the turret
   * fired at the empty spot at the HQ, wave after wave, and never looked for
   * a real enemy again.
   */
  get alive(): boolean {
    return !this.deadFlag && this.active;
  }
  get position(): GeoPosition {
    return this.transform.position;
  }

  /**
   * Start moving and play moving sound
   */
  startMoving(): void {
    this.movement.resume();
    this.isMoving = true;

    // Loop sound for normal enemies
    if (this.typeConfig.movingSound) {
      this.audio.play('moving', true);
    }

    if (this.typeConfig.randomSound) {
      this.randomSoundLeftMs = this.nextRandomSoundInterval();
    }
  }

  /**
   * Debug: walk or run from now on. The speed is simulation state, so this
   * sets it here; the caller switches the clip. A rushing enemy keeps
   * alternating from this state on.
   */
  setRunning(running: boolean): void {
    if (this.rush) this.rush.force(running);
    this.movement.speedMultiplier = running ? (this.typeConfig.runSpeedMultiplier ?? 1) : 1;
  }

  /**
   * Stop moving and sound
   */
  stopMoving(): void {
    this.movement.pause();
    this.isMoving = false;
    this.audio.stop('moving');
    this.randomSoundLeftMs = -1;
  }

  /**
   * Advance the random call by `deltaMs` of game time and play it when due.
   * EnemyManager calls this only while randomSoundLeftMs >= 0.
   */
  tickRandomSound(deltaMs: number): void {
    this.randomSoundLeftMs -= deltaMs;
    if (this.randomSoundLeftMs > 0) return;
    const minVol = this.typeConfig.randomSoundVolumeMin ?? 0.2;
    const maxVol = this.typeConfig.randomSoundVolumeMax ?? 0.6;
    this.audio.play('randomSound', false, minVol + Math.random() * (maxVol - minVol));
    this.randomSoundLeftMs = this.nextRandomSoundInterval();
  }

  private nextRandomSoundInterval(): number {
    const minInterval = this.typeConfig.randomSoundMinInterval ?? 2000;
    const maxInterval = this.typeConfig.randomSoundMaxInterval ?? 5000;
    return minInterval + Math.random() * (maxInterval - minInterval);
  }

  /**
   * Cleanup on destroy
   */
  override destroy(): void {
    this.randomSoundLeftMs = -1;
    this.isMoving = false;

    super.destroy();
  }
}
