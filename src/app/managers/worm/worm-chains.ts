import type { Enemy } from '../../entities/enemy.entity';
import type { EnemyChain, EnemyTypeConfig } from '../../configs/enemy-types.config';
import type { MovementComponent } from '../../game-components/movement.component';
import type { GeoPosition } from '../../models/game.types';
import { getRouteProfile } from '../../utils/route-corridor';
import { WormGroup, WormLink, WormChain, wormSegmentCount, wormSway } from './worm-group';

/**
 * Chains a worm keeps between each other on the same path: the next one's
 * front stays this many spacings behind the tail ahead, the gap one lost
 * segment leaves.
 */
const CHAIN_GAP_SPACINGS = 2;

/** What WormChains needs from EnemyManager. */
export interface WormHost {
  /** Spawn the enemy of a segment on the group's path start, linked to its slot. */
  spawnSegment(group: WormGroup, link: WormLink, paused: boolean): Enemy;
  /** Draw a body segment with the head model from now on: it leads a worm now. */
  showAsHead(enemy: Enemy): void;
}

/**
 * Walks every worm (EnemyTypeConfig.chain) in game time, one call per
 * sub-step before EnemyManager moves its enemies.
 *
 * A chain does not integrate its segments one by one. It advances one
 * distance, its front, and hands each segment the distance and sideways place
 * it has to be at (WormLink.target, .lateral); EnemyManager moves the segment
 * there with stepWormSegment(). Nothing accumulates per segment, so the
 * spacing holds exactly at any timescale and after any number of sub-steps.
 *
 * The pace is the mean slow over the chain's segments on the route: a slowed
 * segment drags the rest along. A chain stands while one of its segments is
 * held (Enemy Debug stop).
 *
 * A segment comes out of the portal when its slot reaches distance 0 at the
 * route start, so the worm leaves the spawn portal one segment after another.
 * A worm spawned while another is still coming out on the same path waits
 * behind it inside the portal.
 *
 * A destroyed segment splits its worm in two (WormGroup.lose). Both walk on
 * at their own pace, the first segment behind the gap as the new head; a
 * chain never closes in on the one ahead on its path to less than the gap
 * one lost segment leaves, so a faster rear worm queues behind a slowed one.
 */
export class WormChains {
  private readonly groups: WormGroup[] = [];
  /** Tail of the chain last ticked per path, for the next chain on that path */
  private readonly tails = new Map<GeoPosition[], number>();

  constructor(private readonly host: WormHost) {}

  /**
   * Spawn a worm of `type` on `path`: as many segments as its route fits,
   * each with `segmentHp`. Returns the head, spawned at once; the rest come
   * out as the chain moves.
   */
  spawn(
    path: GeoPosition[],
    type: EnemyTypeConfig,
    chain: EnemyChain,
    speedMps: number,
    segmentHp: number,
    paused: boolean,
  ): Enemy {
    const size = wormSegmentCount(chain, getRouteProfile(path).totalLength);
    // Behind a worm still coming out on this path. The head is there at
    // once and waits at the route start until its front turns positive.
    const ahead = this.tailOnPath(path);
    const front = Math.min(0, ahead - CHAIN_GAP_SPACINGS * chain.spacing);
    const group = new WormGroup(type, chain, path, size, speedMps, segmentHp, front, paused);
    this.groups.push(group);
    const head = this.emerge(group, group.chains[0], 0, paused);
    group.spawnedHeadId = head.id;
    return head;
  }

  /** The worm that was spawned with head `id` and is not beaten yet, if any. */
  groupSpawnedWith(id: string): WormGroup | null {
    return this.groups.find((group) => group.spawnedHeadId === id && group.remaining > 0) ?? null;
  }

  /** Segments of all worms still inside the portal; the wave waits for them. */
  pendingCount(): number {
    let pending = 0;
    for (const group of this.groups) pending += group.pending;
    return pending;
  }

  /** One sub-step of every worm. `deltaTime` and `gameTimeMs` as in EnemyManager.update(). */
  tick(deltaTime: number, gameTimeMs: number): void {
    if (this.groups.length === 0) return;
    const seconds = Math.min(deltaTime, 100) / 1000;
    this.tails.clear();
    let write = 0;
    for (const group of this.groups) {
      if (group.remaining === 0) continue;
      this.groups[write++] = group;
      // Idle holds a placed worm only while one of its segments is out to
      // hold it. With all of them gone the rest comes out; parked in the
      // portal it would keep every later wave from ending.
      if (group.idle && group.pending === group.remaining) group.idle = false;
      for (const chain of group.chains) this.tickChain(group, chain, seconds, gameTimeMs);
    }
    this.groups.length = write;
  }

  /**
   * Forget every worm (EnemyManager.clear: wave end, reset). The segments
   * still in the portal will not come out; the ones on the route go with
   * their enemies. Nothing that still holds a group (the boss bar) sees a
   * worm left afterwards.
   */
  clear(): void {
    for (const group of this.groups) group.dropPending();
    this.groups.length = 0;
    this.tails.clear();
  }

  private tickChain(group: WormGroup, chain: WormChain, seconds: number, gameTimeMs: number): void {
    let slowSum = 0;
    let walking = 0;
    let held = false;
    for (let slot = chain.first; slot <= chain.last; slot++) {
      const enemy = group.segments[slot];
      if (enemy === null) continue;
      if (enemy.movement.paused) held = true;
      slowSum += enemy.movement.getSlowMultiplier(gameTimeMs);
      walking++;
    }
    // An idle worm (debug placement) starts once one of its segments walks
    if (walking > 0 && !held) group.idle = false;

    // The first segment behind a gap leads a worm of its own now
    const lead = group.segments[chain.first]?.worm;
    if (lead && !lead.head) {
      lead.head = true;
      this.host.showAsHead(group.segments[chain.first]!);
    }

    const ahead = this.tails.get(group.path);
    if (!held && !group.idle) {
      const pace = walking > 0 ? slowSum / walking : 1;
      const limit = ahead === undefined ? Infinity : ahead - CHAIN_GAP_SPACINGS * group.chain.spacing;
      // Never backwards: a chain that is already closer only waits
      chain.front = Math.max(chain.front, Math.min(chain.front + group.speedMps * pace * seconds, limit));
    }
    this.tails.set(group.path, group.tailOf(chain));

    for (let slot = chain.first; slot <= chain.last; slot++) {
      const distance = group.distanceOf(chain, slot);
      if (group.isPending(slot)) {
        // The slots behind are further back still
        if (distance < 0) break;
        this.emerge(group, chain, slot, false);
        continue;
      }
      const link = group.segments[slot]?.worm;
      if (!link) continue;
      link.target = distance;
      link.lateral = wormSway(group.chain, distance);
    }
  }

  private emerge(group: WormGroup, chain: WormChain, slot: number, paused: boolean): Enemy {
    const distance = group.distanceOf(chain, slot);
    const link: WormLink = {
      group,
      slot,
      head: slot === chain.first,
      target: distance,
      lateral: wormSway(group.chain, distance),
    };
    const enemy = this.host.spawnSegment(group, link, paused);
    group.emerge(slot, enemy);
    return enemy;
  }

  /** Tail of the rearmost chain on `path`, Infinity with none. */
  private tailOnPath(path: GeoPosition[]): number {
    let tail = Infinity;
    for (const group of this.groups) {
      if (group.path !== path || group.remaining === 0) continue;
      for (const chain of group.chains) tail = Math.min(tail, group.tailOf(chain));
    }
    return tail;
  }
}

/**
 * Move a worm segment to where its chain puts it (WormChains.tick), in place
 * of MovementComponent.move(). A held segment stays, and so does one whose
 * target is not ahead of it: the head waiting inside the portal, or a chain
 * that stands.
 */
export function stepWormSegment(movement: MovementComponent, link: WormLink): 'moving' | 'reached_end' {
  if (movement.paused) return 'moving';
  const meters = link.target - movement.getDistanceAlongPath();
  if (meters <= 0) return 'moving';
  movement.setLateralFactor(link.lateral);
  return movement.advance(meters);
}
