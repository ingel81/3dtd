/**
 * The events of the main thread's bus (SimClient.bus): the simulation's
 * events with its entities replaced by the main thread's views
 * (sim/client/views.ts). Towers stay `Tower`: the main thread holds shadow
 * towers (sim/client/mirror). A Vector3 arrives as plain { x, y, z }.
 */
import type { Vector3 } from 'three';
import type { GameEvent } from '../../game-engine/game-event-bus';
import { GameEventBus } from '../../game-engine/game-event-bus';
import type { Enemy } from '../../entities/enemy.entity';
import type { Tower } from '../../entities/tower.entity';
import type { Projectile } from '../../entities/projectile.entity';
import type { WormGroup } from '../../managers/worm/worm-group';
import type { EnemyView, ProjectileView, WormGroupView } from './views';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** T with every entity the simulation owns replaced by its view. */
export type ToView<T> =
  T extends Primitive ? T
  : T extends Tower ? Tower
  : T extends Enemy ? EnemyView
  : T extends Projectile ? ProjectileView
  : T extends WormGroup ? WormGroupView
  : T extends Vector3 ? { x: number; y: number; z: number }
  : T extends (...args: never[]) => unknown ? T
  : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> | ArrayBufferView ? T
  : T extends readonly (infer U)[] ? readonly ToView<U>[]
  : T extends object ? { [K in keyof T]: ToView<T[K]> }
  : T;

export type ViewEvent = ToView<GameEvent>;

/** The main thread's bus: the simulation's events as views, and every command the UI gives. */
export type MainEventBus = GameEventBus<ViewEvent>;

export function createMainEventBus(): MainEventBus {
  return new GameEventBus<ViewEvent>();
}
