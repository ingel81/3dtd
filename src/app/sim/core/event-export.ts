/**
 * The simulation's events for the main thread (docs/SIM_WORKER.md): every
 * event the simulation emits, the inputs aside, as an ExportedEvent with its
 * entities turned into references carrying the numbers of that moment
 * (sim/protocol/events.ts). The main thread's mirror puts its views back in.
 */
import { Vector3 } from 'three';
import type { GameEvent, GameEventBus } from '../../game-engine/game-event-bus';
import { Enemy } from '../../entities/enemy.entity';
import { Tower } from '../../entities/tower.entity';
import { Projectile } from '../../entities/projectile.entity';
import { WormGroup } from '../../managers/worm/worm-group';
import type { EnemyRef, ExportedEvent, ProjectileRef, TowerRef, WormGroupRef } from '../protocol/events';
import { entityNum } from '../protocol/packet';

/** Where an enemy's route stands in the world's spawn list, -1 for none (packet column E_ROUTE). */
export type RouteIndexOf = (enemy: Enemy) => number;

/** Inputs the main thread gave; it heard them itself when it emitted them. */
function isInput(type: string): boolean {
  return type.startsWith('command:') || (type.startsWith('debug:') && type !== 'debug:sound');
}

/** Group numbers per WormGroup, handed out in the order the main thread first hears of a group. */
const wormNums = new WeakMap<WormGroup, number>();
let nextWormNum = 1;

export function wormGroupNum(group: WormGroup): number {
  let num = wormNums.get(group);
  if (num === undefined) {
    num = nextWormNum++;
    wormNums.set(group, num);
  }
  return num;
}

export function enemyRef(enemy: Enemy, routeIndex: RouteIndexOf): EnemyRef {
  const ref: EnemyRef = {
    $e: entityNum(enemy.id),
    lat: enemy.position.lat,
    lon: enemy.position.lon,
    th: enemy.transform.terrainHeight,
    ho: enemy.heightOffset,
    hp: enemy.health.hp,
    alive: enemy.alive,
    type: enemy.typeConfig.id,
    route: routeIndex(enemy),
    pr: enemy.movement.getPathProgress(),
  };
  const worm = enemy.worm;
  if (worm) ref.worm = { g: wormGroupNum(worm.group), slot: worm.slot, head: worm.head };
  if (enemy.body) ref.body = true;
  return ref;
}

function wormRef(group: WormGroup): WormGroupRef {
  return { $w: wormGroupNum(group), size: group.size, remaining: group.remaining, type: group.type.id };
}

function towerRef(tower: Tower): TowerRef {
  return { $t: tower.id };
}

function projectileRef(p: Projectile): ProjectileRef {
  return {
    $p: entityNum(p.id),
    type: p.typeConfig.id,
    sourceTowerId: p.sourceTowerId ?? null,
    lat: p.position.lat,
    lon: p.position.lon,
    height: p.flightHeight,
  };
}

function exportValue(value: unknown, routeIndex: RouteIndexOf): unknown {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  if (value instanceof Enemy) return enemyRef(value, routeIndex);
  if (value instanceof Tower) return towerRef(value);
  if (value instanceof Projectile) return projectileRef(value);
  if (value instanceof WormGroup) return wormRef(value);
  if (value instanceof Vector3) return { x: value.x, y: value.y, z: value.z };
  if (value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map((v) => exportValue(v, routeIndex));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const v = exportValue((value as Record<string, unknown>)[key], routeIndex);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** The game clock at an emit: a packet of many sub-steps carries events of different times. */
export interface EmitClock {
  gameTimeMs(): number;
  subStep(): number;
}

/** One event as it crosses; its mute flags as the bus had them, the clock of its emit. */
export function exportEvent(event: GameEvent, bus: GameEventBus, routeIndex: RouteIndexOf, clock?: EmitClock): ExportedEvent {
  const { type, ...rest } = event as { type: string } & Record<string, unknown>;
  return {
    type,
    payload: exportValue(rest, routeIndex) as Record<string, unknown>,
    live: !bus.isLiveMuted,
    show: !bus.isShowMuted,
    ...(clock ? { t: clock.gameTimeMs(), step: clock.subStep() } : {}),
  };
}

/**
 * Collect every output event of `bus` into `sink` (the packet's events).
 * Returns the unsubscribe. The catch-all listener runs before the typed ones,
 * so the order is the emit order.
 */
export function exportEvents(bus: GameEventBus, sink: () => ExportedEvent[], routeIndex: RouteIndexOf, clock?: EmitClock): () => void {
  const sub = bus.onAny((event) => {
    if (isInput(event.type)) return;
    sink().push(exportEvent(event, bus, routeIndex, clock));
  });
  return () => sub.dispose();
}
