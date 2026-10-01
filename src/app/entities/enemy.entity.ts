import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import {
  TransformComponent,
  HealthComponent,
  RenderComponent,
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
import { EnemyRush } from './enemy-rush';
import type { BossTraits } from '../managers/boss-traits';

/**
 * Enemy entity - combines Transform, Health, Render and Movement components.
 * Its sounds and looks are the main thread's (presentation/), from the
 * frame packet's enemy table and the simulation's events.
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

  private isMoving = false;

  // ── Hot-path mirrors and caches ─────────────────────────────────
  // EnemyManager touches every enemy several times a frame. These plain
  // fields let it answer "anything to do?" and find the enemy's grid slots
  // without loading a component or hashing the string id into
  // a 20k-entry Map. Each is written only by the owner named on it, and every
  // cache is validated before use, so none of them can change an outcome.

  /** Mirror of `health.isDead`. Written only by HealthComponent (DeathFlagSink). */
  deadFlag = false;
  /** Whether the transform still turns toward its heading. Written only by TransformComponent (TurningFlagSink). */
  isTurning = false;
  /** GlobalRouteGrid's memo of this enemy's last cell evaluation, see updateEnemyPosition(). */
  routeCellGen = -1;
  routeCellKey = 0;
  routeCell: RouteCell | undefined = undefined;
  /** SpatialGrid entry kept by EnemyManager, re-validated on every use (SpatialGrid.updateTracked). */
  spatialEntry: SpatialEntry | null = null;
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
  /** A boss's rage (EnemyTypeConfig.traits), null for most */
  readonly traits: BossTraits | null;
  /** Share of a tower's damage it takes (a raging boss less), see managers/boss-traits.ts */
  damageTaken = 1;
  /** An elite of its kind (SpawnEntry.elite) or split from one; the packet marks it (EF_ELITE) */
  elite = false;
  /** Its rage has begun (boss-traits); the packet shows it (EF_ENRAGED) */
  enraged = false;

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
    this.traits = this.typeConfig.traits ?? null;
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

    // Configure movement
    this._movement.setPath(path, startIndex, startProgress);
    this._movement.speedMps = speedOverride ?? this.typeConfig.baseSpeed;
  }

  /** Get effective armor type (checks for active override like Armor Break, then falls back to config). */
  getEffectiveArmorType(): ArmorType {
    if (this._armorTypeOverride) return this._armorTypeOverride;
    // The segment that leads a worm wears the head's armor (EnemyChain.head)
    if (this.worm?.head) return this.worm.group.chain.head.armorType;
    return this.typeConfig.armorType;
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
  /** Walking (startMoving) rather than stopped; its moving sound loops on the main thread (EF_MOVING) */
  get moving(): boolean {
    return this.isMoving;
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

  /** Start moving */
  startMoving(): void {
    this.movement.resume();
    this.isMoving = true;
  }

  /**
   * Debug: walk or run from now on. The speed is simulation state, so this
   * sets it here; the renderer shows the clip from the packet (EF_RUNNING).
   * A rushing enemy keeps alternating from this state on.
   */
  setRunning(running: boolean): void {
    if (this.rush) this.rush.force(running);
    this.movement.speedMultiplier = running ? (this.typeConfig.runSpeedMultiplier ?? 1) : 1;
  }

  /** Stop moving */
  stopMoving(): void {
    this.movement.pause();
    this.isMoving = false;
  }

  /**
   * Cleanup on destroy
   */
  override destroy(): void {
    this.isMoving = false;

    super.destroy();
  }
}
