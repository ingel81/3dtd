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
import {
  E_ANIM_SPEED, E_DIST, E_EFF_SPEED, E_FLAGS, E_HOFF, E_HP, E_LAT, E_LON, E_MAXHP, E_PROGRESS, E_ROT, E_TERRAIN,
  EF_ACTIVE, EF_ALIVE, EF_BODY, EF_MOVING, ENEMY_STRIDE,
} from '../protocol/packet';

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

/**
 * A row of numbers an EnemyView reads: the mirror's copy of the last packet's
 * enemy table, or a row of the view's own once no table has it (it left) or
 * an event set its numbers to that moment.
 */
function numberField(view: EnemyView, column: number): PropertyDescriptor {
  return {
    enumerable: true,
    get: () => view.read(column),
    set: (value: number) => view.write(column, value),
  };
}

/** A flag of E_FLAGS as a boolean field */
function flagField(view: EnemyView, flag: number, set = true): PropertyDescriptor {
  return {
    enumerable: true,
    get: () => (view.read(E_FLAGS) & flag) !== 0 === set,
    set: (value: boolean) => {
      const flags = view.read(E_FLAGS);
      view.write(E_FLAGS, value === set ? flags | flag : flags & ~flag);
    },
  };
}

/**
 * An enemy as the main thread reads it. Its numbers are not copied into it
 * per packet: the fields read the enemy's row of the mirror's copy of the
 * table when asked (SimMirror.pointAt), which spares the main thread thousands
 * of writes per packet at many enemies. The mirror gives it a row of its own
 * (settle) when the enemy left the table or an event sets its numbers to the
 * moment of the event. Fields are own enumerable accessors, so a copy
 * (`{ ...view.position }`) and a comparison see them.
 */
export class EnemyView {
  private data: Float64Array;
  private at = 0;
  /** Its own row, once settle() made one */
  private own: Float64Array | null = null;
  declare readonly position: GeoPosition;
  declare readonly transform: { terrainHeight: number; rotation: number; readonly position: GeoPosition };
  declare heightOffset: number;
  declare readonly health: { hp: number; maxHp: number; readonly healthPercent: number; readonly isDead: boolean };
  declare alive: boolean;
  declare active: boolean;
  /** E_FLAGS of the last packet */
  declare flags: number;
  declare animSpeed: number;
  /** An ooze: the main thread has its stations through the renderer op, not here */
  declare hasBody: boolean;
  worm: { readonly group: WormGroupView; readonly slot: number; head: boolean } | null = null;
  /** Its row in the last packet's enemy table, -1 without one (the mirror's) */
  row = -1;
  /** The mirror's packet count when a row last had it (the mirror's) */
  stamp = 0;
  /** Index of its route in the world's spawn list (E_ROUTE), -1 for none (the mirror's) */
  route = -1;
  declare readonly movement: EnemyMovementView;

  constructor(
    readonly id: string,
    readonly num: number,
    readonly typeConfig: EnemyTypeConfig,
  ) {
    this.own = new Float64Array(ENEMY_STRIDE);
    this.own[E_FLAGS] = EF_ALIVE | EF_ACTIVE;
    this.data = this.own;
    const position = Object.defineProperties({} as GeoPosition, {
      lat: numberField(this, E_LAT),
      lon: numberField(this, E_LON),
      height: { enumerable: true, get: () => this.read(E_TERRAIN) + this.read(E_HOFF) },
    });
    const movement = {
      routeId: '',
      path: [] as readonly GeoPosition[],
      speedMps: 0,
      getPathProgress: () => this.read(E_PROGRESS),
      getDistanceAlongPath: () => this.read(E_DIST),
      getEffectiveSpeed: () => this.read(E_EFF_SPEED),
    };
    Object.defineProperties(movement, {
      progress: numberField(this, E_PROGRESS),
      distanceAlongPath: numberField(this, E_DIST),
      effectiveSpeed: numberField(this, E_EFF_SPEED),
      paused: flagField(this, EF_MOVING, false),
    });
    Object.defineProperties(this, {
      position: { enumerable: true, value: position },
      transform: {
        enumerable: true,
        value: Object.defineProperties({ position } as EnemyView['transform'], {
          terrainHeight: numberField(this, E_TERRAIN),
          rotation: numberField(this, E_ROT),
        }),
      },
      heightOffset: numberField(this, E_HOFF),
      health: {
        enumerable: true,
        value: Object.defineProperties({} as EnemyView['health'], {
          hp: numberField(this, E_HP),
          maxHp: numberField(this, E_MAXHP),
          healthPercent: { enumerable: true, get: () => {
            const max = this.read(E_MAXHP);
            return max > 0 ? this.read(E_HP) / max : 0;
          } },
          isDead: { enumerable: true, get: () => this.read(E_HP) <= 0 },
        }),
      },
      alive: flagField(this, EF_ALIVE),
      active: flagField(this, EF_ACTIVE),
      hasBody: flagField(this, EF_BODY),
      flags: numberField(this, E_FLAGS),
      animSpeed: numberField(this, E_ANIM_SPEED),
      movement: { enumerable: true, value: movement },
    });
  }

  /** Read its numbers from row `at` of `table` from now on (the mirror's copy of the packet's enemy table) */
  pointAt(table: Float64Array, at: number): void {
    this.data = table;
    this.at = at;
    this.own = null;
  }

  /** Its numbers into a row of its own: the table's row goes with the next packets */
  settle(): void {
    if (this.own !== null) return;
    const own = new Float64Array(ENEMY_STRIDE);
    own.set(this.data.subarray(this.at, this.at + ENEMY_STRIDE));
    this.own = own;
    this.data = own;
    this.at = 0;
  }

  /** Column `column` of its row (ENEMY_STRIDE layout) */
  read(column: number): number {
    return this.data[this.at + column];
  }

  /** Set column `column`: the view keeps its own row from then on */
  write(column: number, value: number): void {
    this.settle();
    this.own![column] = value;
  }

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
