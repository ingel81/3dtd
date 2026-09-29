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
import type { ProjectileTypeConfig } from '../../configs/projectile-types.config';
import type { GeoPosition } from '../../models/game.types';

export class WormGroupView {
  remaining = 0;
  seq = 0;
  constructor(
    readonly num: number,
    readonly size: number,
  ) {}
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
  getPathProgress(): number;
  getDistanceAlongPath(): number;
  getEffectiveSpeed(): number;
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
}

export class ProjectileView {
  readonly position: GeoPosition = { lat: 0, lon: 0, height: 0 };
  constructor(
    readonly id: string,
    readonly typeConfig: ProjectileTypeConfig,
    readonly sourceTowerId: string | null,
  ) {}
}
