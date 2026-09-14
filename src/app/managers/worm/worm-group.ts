import type { Enemy } from '../../entities/enemy.entity';
import type { EnemyChain, EnemyTypeConfig } from '../../configs/enemy-types.config';
import type { GeoPosition } from '../../models/game.types';
import type { SpawnStart } from '../enemy.manager';
import { PORTAL_DEPTH } from '../../configs/marker-geometry.config';
import { WormPath, wormPathOf } from './worm-path';

/** A slot not out of the portal yet, walking, or killed, through or removed. */
const PENDING = 0;
const ALIVE = 1;
const GONE = 2;

/**
 * Metres over which the sway fades in after the portal's front face
 * (PORTAL_DEPTH / 2 past where the worm comes out, at scale 1): the worm
 * comes out straight and starts to snake once clear of the gate.
 */
export const WORM_SWAY_RAMP_M = 12;

/**
 * One worm of a group: a run of segment slots that walk together. `front` is
 * the route distance (m, centre line) of slot `first`, and each further slot
 * trails it by the spacing. A slot short of the group's origin (0, the route
 * start in the spawn portal, for a wave worm) has not come out yet and has no
 * enemy.
 */
export interface WormChain {
  first: number;
  last: number;
  front: number;
}

/** A segment enemy's place in its worm, kept on the enemy (Enemy.worm). */
export interface WormLink {
  readonly group: WormGroup;
  readonly slot: number;
  /** Drawn with the head model */
  head: boolean;
  /** Where the chain puts the segment in this sub-step: route distance (m) ... */
  target: number;
  /** ... and place across the corridor (-1..1, see MovementComponent.setLateralFactor) */
  lateral: number;
}

/**
 * Segments of a worm on a route `routeLength` m long: as many as it takes
 * for the head to reach the HQ just as the tail leaves the start, within the
 * type's bounds.
 */
export function wormSegmentCount(chain: EnemyChain, routeLength: number): number {
  const fit = Math.floor(Math.max(0, routeLength) / chain.spacing) + 1;
  return Math.max(chain.minSegments, Math.min(chain.maxSegments, fit));
}

/**
 * Place across the corridor of the segment `distance` m along the route, for a
 * worm that comes out at route distance `origin`. A function of the distance
 * alone, so every segment passes a point of the route where the head passed
 * it: the body follows the head's S-curve, at any timescale.
 */
export function wormSway(chain: EnemyChain, distance: number, origin = 0): number {
  const t = (distance - origin - PORTAL_DEPTH / 2) / WORM_SWAY_RAMP_M;
  if (t <= 0) return 0;
  const ramp = t >= 1 ? 1 : t * t * (3 - 2 * t);
  return chain.sway * ramp * Math.sin((2 * Math.PI * distance) / chain.swayWavelength);
}

/**
 * One spawned worm and everything that becomes of it: `size` segment slots,
 * each an enemy of `type` once it has come out of the portal. Holds the
 * bookkeeping only; WormChains moves the chains and spawns the segments.
 */
export class WormGroup {
  /** Segment enemies by slot, null while the slot is pending and once it is gone */
  readonly segments: (Enemy | null)[];
  /** The worms of this group, front to back */
  readonly chains: WormChain[];
  /** The curve its segments stand on, the route with its corners rounded */
  readonly bend: WormPath;
  /** Id of the head it was spawned with, the one Enemy Debug lists */
  spawnedHeadId = '';
  /** Spawn order and path, the order WormChains ticks chains on one path in */
  seq = 0;
  pathId = 0;
  private readonly state: Uint8Array;
  private aliveSlots = 0;
  private pendingSlots: number;

  constructor(
    /** The chained type; every segment is an enemy of it */
    readonly type: EnemyTypeConfig,
    readonly chain: EnemyChain,
    readonly path: GeoPosition[],
    readonly size: number,
    readonly speedMps: number,
    readonly segmentMaxHp: number,
    front: number,
    /**
     * Spawned idle (Enemy Debug placement): stands until one of its segments
     * is started, see WormChains.tick().
     */
    public idle: boolean,
    /**
     * Route distance where its segments come out: 0, the route start inside
     * the spawn portal, for a wave worm; where Enemy Debug placed it, for a
     * placed one.
     */
    readonly origin = 0,
    /** Where its segment enemies are spawned: null on path[0], else part-way (placement) */
    readonly start: SpawnStart | null = null,
  ) {
    this.segments = new Array<Enemy | null>(size).fill(null);
    this.state = new Uint8Array(size);
    this.pendingSlots = size;
    this.chains = [{ first: 0, last: size - 1, front }];
    this.bend = wormPathOf(path);
  }

  /** Slots still inside the portal */
  get pending(): number {
    return this.pendingSlots;
  }

  /** Slots still to beat: walking or yet to come out */
  get remaining(): number {
    return this.aliveSlots + this.pendingSlots;
  }

  get maxHp(): number {
    return this.size * this.segmentMaxHp;
  }

  /** HP left over all its worms, the segments still in the portal at full HP */
  hp(): number {
    let hp = this.pendingSlots * this.segmentMaxHp;
    for (const enemy of this.segments) {
      if (enemy !== null) hp += enemy.health.hp;
    }
    return hp;
  }

  isPending(slot: number): boolean {
    return this.state[slot] === PENDING;
  }

  isAlive(slot: number): boolean {
    return this.state[slot] === ALIVE;
  }

  /** Route distance of `slot` in `chain` */
  distanceOf(chain: WormChain, slot: number): number {
    return chain.front - (slot - chain.first) * this.chain.spacing;
  }

  /** Route distance of the last slot of `chain` */
  tailOf(chain: WormChain): number {
    return this.distanceOf(chain, chain.last);
  }

  /** The pending `slot` came out as `enemy`. */
  emerge(slot: number, enemy: Enemy): void {
    if (this.state[slot] !== PENDING) return;
    this.state[slot] = ALIVE;
    this.segments[slot] = enemy;
    this.pendingSlots--;
    this.aliveSlots++;
  }

  /**
   * The segment of `slot` was killed, reached the HQ or was removed, or a
   * pending slot will never come out. Its chain falls apart into two
   * independent worms: the part in front keeps its front, the part behind
   * starts at its first slot's distance, and that slot is its head
   * (WormChains draws it with the head model). Either part may be empty.
   */
  lose(slot: number): void {
    const state = this.state[slot];
    if (state === GONE) return;
    if (state === PENDING) this.pendingSlots--;
    else this.aliveSlots--;
    this.state[slot] = GONE;
    this.segments[slot] = null;

    const i = this.chains.findIndex((c) => c.first <= slot && slot <= c.last);
    if (i < 0) return;
    const chain = this.chains[i];
    const parts: WormChain[] = [];
    if (slot > chain.first) parts.push({ first: chain.first, last: slot - 1, front: chain.front });
    if (slot < chain.last) {
      parts.push({ first: slot + 1, last: chain.last, front: this.distanceOf(chain, slot + 1) });
    }
    this.chains.splice(i, 1, ...parts);
  }

  /** Nothing more comes out of the portal (debug kill-all, removal). */
  dropPending(): void {
    for (let slot = 0; slot < this.size; slot++) {
      if (this.state[slot] === PENDING) this.lose(slot);
    }
  }
}
