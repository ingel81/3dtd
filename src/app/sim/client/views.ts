/**
 * What the main thread holds of the simulation's entities (docs/SIM_WORKER.md).
 * The property paths are the entities' own for what the main thread reads
 * (`enemy.position.lat`, `enemy.transform.terrainHeight`, `enemy.health.hp`,
 * `enemy.worm.group.remaining`), so a listener reads a view as it read the
 * entity. Towers are shadow `Tower` objects (sim/client/mirror), not views.
 *
 * Filled by the mirror: from the reference an event carries (sim/protocol/events)
 * and from the enemy table of every packet (sim/protocol/packet).
 */
import type { EnemyTypeConfig } from '../../configs/enemy-types.config';
import type { ArmorType } from '../../configs/combat/combat.types';
import type { ProjectileTypeConfig } from '../../configs/projectile-types.config';
import type { GeoPosition } from '../../models/game.types';

export class WormGroupView {
  remaining = 0;
  seq = 0;
  /** The chained type, null until a reference or its head named it */
  type: EnemyTypeConfig | null = null;
  /** Worms of the group now (rows of the worm table) */
  chains = 0;
  /** HP left over the whole group (W_HP) */
  hpLeft = 0;
  /** WormGroup.maxHp (W_MAXHP) */
  maxHp = 0;
  constructor(
    readonly num: number,
    readonly size: number,
  ) {}

  /** HP left over all its worms, as WormGroup.hp() */
  hp(): number {
    return this.hpLeft;
  }
}

export interface EnemyMovementView {
  /** Spawn id of the route it walks, '' for none */
  routeId: string;
  /** The route it walks as the main thread has it (PathAndRouteService), [] for none */
  path: readonly GeoPosition[];
  speedMps: number;
  progress: number;
  distanceAlongPath: number;
  effectiveSpeed: number;
  /** Stopped (E_FLAGS without EF_MOVING): Enemy Debug's paused enemies */
  paused: boolean;
  getPathProgress(): number;
  getDistanceAlongPath(): number;
  /** E_EFF_SPEED of the last packet; the argument (game time) of the entity's is not needed here */
  getEffectiveSpeed(gameTimeMs?: number): number;
}

export class EnemyView {
  readonly position: GeoPosition = { lat: 0, lon: 0, height: 0 };
  readonly transform = { terrainHeight: 0, rotation: 0, position: this.position };
  heightOffset = 0;
  readonly health = {
    hp: 0,
    maxHp: 0,
    get healthPercent(): number {
      return this.maxHp > 0 ? this.hp / this.maxHp : 0;
    },
    get isDead(): boolean {
      return this.hp <= 0;
    },
  };
  alive = true;
  active = true;
  /** E_FLAGS of the last packet */
  flags = 0;
  animSpeed = 0;
  worm: { readonly group: WormGroupView; readonly slot: number; head: boolean } | null = null;
  /** An ooze: the main thread has its stations through the renderer op, not here */
  hasBody = false;
  readonly movement: EnemyMovementView = {
    routeId: '',
    path: [],
    speedMps: 0,
    progress: 0,
    distanceAlongPath: 0,
    effectiveSpeed: 0,
    paused: false,
    getPathProgress() {
      return this.progress;
    },
    getDistanceAlongPath() {
      return this.distanceAlongPath;
    },
    getEffectiveSpeed() {
      return this.effectiveSpeed;
    },
  };

  constructor(
    readonly id: string,
    readonly num: number,
    readonly typeConfig: EnemyTypeConfig,
  ) {}

  /** The armor it wears (Enemy.getEffectiveArmorType): the head's for the segment that leads a worm */
  getEffectiveArmorType(): ArmorType {
    if (this.worm?.head && this.typeConfig.chain) return this.typeConfig.chain.head.armorType;
    return this.typeConfig.armorType;
  }
}

export class ProjectileView {
  readonly position: GeoPosition = { lat: 0, lon: 0, height: 0 };
  constructor(
    readonly id: string,
    readonly typeConfig: ProjectileTypeConfig,
    readonly sourceTowerId: string | null,
  ) {}
}
