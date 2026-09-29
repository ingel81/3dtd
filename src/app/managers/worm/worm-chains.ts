import type { Enemy } from '../../entities/enemy.entity';
import type { EnemyChain, EnemyTypeConfig } from '../../configs/enemy-types.config';
import type { GeoPosition } from '../../models/game.types';
import type { SpawnStart } from '../enemy.manager';
import { getRouteProfile } from '../../utils/route-corridor';
import { WormGroup, WormLink, WormChain, wormSegmentCount, wormSway, type SavedWormState } from './worm-group';

/** A worm group of the wave snapshot: what its constructor took, then its state */
export interface SavedWormGroup {
  typeId: string;
  /** The spawn point whose route it walks */
  pathId: string;
  size: number;
  speedMps: number;
  segmentMaxHp: number;
  origin: number;
  start: SpawnStart | null;
  state: SavedWormState;
}

/**
 * Chains a worm keeps between each other on the same path: the next one's
 * front stays this many spacings behind the tail ahead, the gap one lost
 * segment leaves.
 */
const CHAIN_GAP_SPACINGS = 2;

/** What WormChains needs from EnemyManager. */
export interface WormHost {
  /**
   * Spawn the enemy of a segment where its group comes out (WormGroup.start),
   * linked to its slot, with the head's max HP when the link leads its worm.
   */
  spawnSegment(group: WormGroup, link: WormLink, paused: boolean): Enemy;
  /** Draw a body segment with the head model from now on: it leads a worm now. */
  showAsHead(enemy: Enemy): void;
  /** Draw a body segment with the tail model from now on: it ends a worm now. */
  showAsTail(enemy: Enemy): void;
}

/** A chain in the order of one sub-step, see WormChains.tick(). */
interface ChainRef {
  group: WormGroup;
  chain: WormChain;
  /** Where its front stands: never short of its origin, where its head waits */
  front: number;
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
 * segment drags the rest along. A chain that has lost segments walks faster
 * (WormGroup.rushOf). A chain stands while one of its segments is
 * held (Enemy Debug stop) or its head is halted (freeze, stun). A halted ring
 * behind the head stays out of the mean and is dragged along, its halt only
 * shows (user decision 2026-09-15; until then any halted segment stood the
 * whole chain).
 *
 * A segment comes out when its slot reaches the group's origin: the route
 * start inside the spawn portal for a wave worm, so the worm leaves the portal
 * one segment after another, or the point on the route where Enemy Debug
 * placed it.
 *
 * A destroyed segment splits its worm in two (WormGroup.lose). Both walk on
 * at their own pace, the first segment behind the gap as the new head, the
 * last one in front of it as the new tail (the host switches their models). A
 * chain never closes in on the one ahead on its path to less than the gap one
 * lost segment leaves: a faster rear worm queues behind a slowed one, and a
 * worm spawned while another is still coming out waits behind it. A chain
 * that still has segments to bring out ends at its origin for the one behind.
 */
export class WormChains {
  private readonly groups: WormGroup[] = [];
  /** The chains of this sub-step, reused; see tick() */
  private readonly order: ChainRef[] = [];
  private readonly pathIds = new WeakMap<GeoPosition[], number>();
  private nextSeq = 1;

  constructor(private readonly host: WormHost) {}

  /**
   * Spawn a worm of `type` on `path`: as many segments as fit the route from
   * where it comes out, each with `segmentHp`. That is `path[0]` in the spawn
   * portal, or `start` part-way along the route (Enemy Debug placement).
   * Returns the head, spawned at once; the rest come out as the chain moves.
   */
  spawn(
    path: GeoPosition[],
    type: EnemyTypeConfig,
    chain: EnemyChain,
    speedMps: number,
    segmentHp: number,
    paused: boolean,
    start: SpawnStart | null = null,
  ): Enemy {
    const profile = getRouteProfile(path);
    const origin = start
      ? profile.cumulativeLength[start.segmentIndex] + profile.segmentLengths[start.segmentIndex] * start.segmentProgress
      : 0;
    const size = wormSegmentCount(chain, profile.totalLength - origin);
    const pathId = this.pathIdOf(path);
    // Behind a chain still in the way where it comes out. The head is there
    // at once and waits until its front reaches its origin.
    const front = Math.min(origin, this.endAhead(pathId, origin) - CHAIN_GAP_SPACINGS * chain.spacing);
    const group = new WormGroup(
      type, chain, path, size, speedMps, segmentHp, front, paused, origin, start ? { ...start } : null,
    );
    group.seq = this.nextSeq++;
    group.pathId = pathId;
    this.groups.push(group);
    const head = this.emerge(group, group.chains[0], 0, paused);
    group.spawnedHeadId = head.id;
    return head;
  }

  /** Every worm group as plain data, in their order, for the wave snapshot (wave-snapshot.ts) */
  captureWaveState(pathId: (path: readonly GeoPosition[]) => string | null): { nextSeq: number; groups: SavedWormGroup[] } {
    return {
      nextSeq: this.nextSeq,
      groups: this.groups.map((group) => {
        const id = pathId(group.path);
        if (id === null) throw new Error('A worm walks a route of no spawn point');
        return {
          typeId: group.type.id,
          pathId: id,
          size: group.size,
          speedMps: group.speedMps,
          segmentMaxHp: group.segmentMaxHp,
          origin: group.origin,
          start: group.start ? { ...group.start } : null,
          state: group.saveState(),
        };
      }),
    };
  }

  /**
   * Put the groups of captureWaveState() back, after clear(); their segments
   * are linked once the enemies are built (WormGroup.restoreSegments).
   */
  restoreWaveState(
    state: { nextSeq: number; groups: readonly SavedWormGroup[] },
    pathOf: (id: string) => GeoPosition[],
    typeOf: (id: string) => EnemyTypeConfig,
  ): WormGroup[] {
    this.nextSeq = state.nextSeq;
    for (const saved of state.groups) {
      const type = typeOf(saved.typeId);
      const group = new WormGroup(
        type, type.chain!, pathOf(saved.pathId), saved.size, saved.speedMps, saved.segmentMaxHp, 0,
        saved.state.idle, saved.origin, saved.start ? { ...saved.start } : null,
      );
      group.restoreState(saved.state);
      this.groups.push(group);
    }
    return this.groups;
  }

  /** Every worm on the routes; one beaten since the last tick is still here with `remaining` 0. */
  get all(): readonly WormGroup[] {
    return this.groups;
  }

  /** The worm that was spawned with head `id` and is not beaten yet, if any. */
  groupSpawnedWith(id: string): WormGroup | null {
    return this.groups.find((group) => group.spawnedHeadId === id && group.remaining > 0) ?? null;
  }

  /** Segments of all worms not out yet; the wave waits for them. */
  pendingCount(): number {
    let pending = 0;
    for (const group of this.groups) pending += group.pending;
    return pending;
  }

  /**
   * One sub-step of every worm. `deltaTime` and `gameTimeMs` as in
   * EnemyManager.update(). The chains of one path go front to back, so each
   * knows where the one ahead of it ends in this very sub-step.
   */
  tick(deltaTime: number, gameTimeMs: number): void {
    if (this.groups.length === 0) return;
    const seconds = Math.min(deltaTime, 100) / 1000;
    const order = this.order;
    let n = 0;
    let write = 0;
    for (const group of this.groups) {
      if (group.remaining === 0) continue;
      this.groups[write++] = group;
      // Idle holds a placed worm only while one of its segments is out to
      // hold it. With all of them gone the rest comes out; parked where it
      // comes out it would keep every later wave from ending.
      if (group.idle && group.pending === group.remaining) group.idle = false;
      for (const chain of group.chains) {
        const ref = order[n] ?? (order[n] = { group, chain, front: 0 });
        ref.group = group;
        ref.chain = chain;
        ref.front = Math.max(chain.front, group.origin);
        n++;
      }
    }
    this.groups.length = write;
    order.length = n;
    order.sort(byPathThenFront);

    let pathId = 0;
    let end = Infinity;
    for (const { group, chain } of order) {
      if (group.pathId !== pathId) {
        pathId = group.pathId;
        end = Infinity;
      }
      this.tickChain(group, chain, seconds, gameTimeMs, end - CHAIN_GAP_SPACINGS * group.chain.spacing);
      end = endOf(group, chain);
    }
  }

  /**
   * Forget every worm (EnemyManager.clear: wave end, reset). The segments
   * still to come out will not; the ones on the route go with their enemies.
   * Nothing that still holds a group (the boss bar) sees a worm left
   * afterwards.
   */
  clear(): void {
    for (const group of this.groups) group.dropPending();
    this.groups.length = 0;
    this.order.length = 0;
  }

  private tickChain(group: WormGroup, chain: WormChain, seconds: number, gameTimeMs: number, limit: number): void {
    let slowSum = 0;
    let paced = 0;
    let walking = 0;
    let held = false;
    let halted = false;
    for (let slot = chain.first; slot <= chain.last; slot++) {
      const enemy = group.segments[slot];
      if (enemy === null) continue;
      if (enemy.movement.paused) held = true;
      walking++;
      const movement = enemy.movement;
      // A frozen or stunned head stands its worm; a ring behind it is dragged
      // along at the pace of the others, its halt only shows
      if (movement.hasStatusEffects && movement.isHalted(gameTimeMs)) {
        if (slot === chain.first) halted = true;
        continue;
      }
      slowSum += movement.getSlowMultiplier(gameTimeMs);
      paced++;
    }
    // An idle worm (debug placement) starts once one of its segments walks
    if (walking > 0 && !held) group.idle = false;

    // The first segment behind a gap leads a worm of its own now, a tail
    // left alone as well. It takes over the head's HP, with the share it has
    // left, and its armor (EnemyChain.head).
    const leader = group.segments[chain.first];
    const lead = leader?.worm;
    if (leader && lead && !lead.head) {
      lead.head = true;
      lead.tail = false;
      leader.health.scaleMaxHp(group.headMaxHp);
      group.headBonusHp += group.headMaxHp - group.segmentMaxHp;
      this.host.showAsHead(leader);
    }
    // The segment in front of a gap ends its worm now. A last slot still in
    // the portal comes out as the tail (emerge).
    const end = group.segments[chain.last]?.worm;
    if (end && !end.head && !end.tail) {
      end.tail = true;
      this.host.showAsTail(group.segments[chain.last]!);
    }

    if (!held && !halted && !group.idle) {
      const pace = paced > 0 ? slowSum / paced : 1;
      // Never backwards: a chain that is already closer only waits
      const speed = group.speedMps * pace * group.rushOf(chain);
      chain.front = Math.max(chain.front, Math.min(chain.front + speed * seconds, limit));
    }

    for (let slot = chain.first; slot <= chain.last; slot++) {
      const distance = group.distanceOf(chain, slot);
      if (group.isPending(slot)) {
        // The slots behind are further back still
        if (distance < group.origin) break;
        this.emerge(group, chain, slot, false);
        continue;
      }
      const link = group.segments[slot]?.worm;
      if (!link) continue;
      link.target = distance;
      link.lateral = wormSway(group.chain, distance, group.origin);
    }
  }

  private emerge(group: WormGroup, chain: WormChain, slot: number, paused: boolean): Enemy {
    const distance = group.distanceOf(chain, slot);
    const link: WormLink = {
      group,
      slot,
      head: slot === chain.first,
      // The last slot of its chain comes out as the tail, unless it leads it
      tail: slot === chain.last && slot !== chain.first,
      target: distance,
      lateral: wormSway(group.chain, distance, group.origin),
    };
    const enemy = this.host.spawnSegment(group, link, paused);
    group.emerge(slot, enemy);
    if (link.head) group.headBonusHp += group.headMaxHp - group.segmentMaxHp;
    // On the curve where it comes out, in case it does not move this sub-step
    const at = enemy.movement.getDistanceAlongPath();
    placeWormSegment(enemy, group, at, wormSway(group.chain, at, group.origin));
    return enemy;
  }

  /**
   * Where the nearest chain ahead of a new worm coming out at `origin` on
   * path `pathId` ends, Infinity with none. Ahead: its front is past
   * `origin`, or at it (an older worm waiting there).
   */
  private endAhead(pathId: number, origin: number): number {
    let nearestFront = Infinity;
    let end = Infinity;
    for (const group of this.groups) {
      if (group.pathId !== pathId || group.remaining === 0) continue;
      for (const chain of group.chains) {
        const front = Math.max(chain.front, group.origin);
        if (front < origin || front > nearestFront) continue;
        nearestFront = front;
        end = Math.min(end, endOf(group, chain));
      }
    }
    return end;
  }

  /**
   * The id worms on `path` share: from the path itself (its ends and length),
   * not from the order paths first saw a worm. That order depends on the
   * session, and the id sorts the chains, which sets the ids their segments
   * get: a replay from a file in a fresh session has to give the same.
   */
  private pathIdOf(path: GeoPosition[]): number {
    let id = this.pathIds.get(path);
    if (id === undefined) {
      id = pathKey(path);
      this.pathIds.set(path, id);
    }
    return id;
  }
}

/** FNV-1a over a path's first and last point and its length, never 0 (0 is "no path yet" in tick). */
function pathKey(path: readonly GeoPosition[]): number {
  const first = path[0];
  const last = path[path.length - 1];
  const text = `${path.length}|${first?.lat},${first?.lon}|${last?.lat},${last?.lon}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 1;
}

/** Chains by path, then front to back, an older worm first where two wait at one origin. */
function byPathThenFront(a: ChainRef, b: ChainRef): number {
  return a.group.pathId - b.group.pathId || b.front - a.front || a.group.seq - b.group.seq;
}

/**
 * Where `chain` ends for the chain behind it: its last slot, but no further
 * back than its origin while slots are still to come out there.
 */
function endOf(group: WormGroup, chain: WormChain): number {
  return Math.max(group.tailOf(chain), group.origin);
}

/**
 * Move a worm segment to where its chain puts it (WormChains.tick), in place
 * of MovementComponent.move(): its distance along the route, and where it
 * stands and faces on its worm's curve (WormPath). A held segment stays, and
 * so does one whose target is not ahead of it: a head waiting where its worm
 * comes out, or a chain that stands.
 */
export function stepWormSegment(enemy: Enemy, link: WormLink): 'moving' | 'reached_end' {
  const movement = enemy.movement;
  if (movement.paused) return 'moving';
  if (link.target <= movement.getDistanceAlongPath()) return 'moving';
  movement.setLateralFactor(link.lateral);
  if (movement.seekDistance(link.target) === 'reached_end') return 'reached_end';
  placeWormSegment(enemy, link.group, link.target, link.lateral);
  return 'moving';
}

/** Put a segment of `group` on its curve `distance` m along the route, `lateral` across it. */
function placeWormSegment(enemy: Enemy, group: WormGroup, distance: number, lateral: number): void {
  const half = group.chain.spacing / 2;
  group.bend.place(
    enemy.movement,
    enemy.transform,
    distance,
    lateral,
    wormSway(group.chain, distance - half, group.origin),
    wormSway(group.chain, distance + half, group.origin),
    half,
  );
}
