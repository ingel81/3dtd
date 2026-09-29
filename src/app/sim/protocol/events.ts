/**
 * Simulation events across the boundary (docs/SIM_WORKER.md). In the
 * simulation an event carries live entities (Enemy, Tower, Projectile,
 * WormGroup); across the boundary each becomes a reference with the numbers
 * of that moment. The main thread's importer puts its view objects in their
 * place (EnemyView, the shadow Tower, ProjectileView, WormGroupView) and emits
 * the event on the main bus, so its listeners keep reading `event.enemy.position`.
 *
 * Other values: a THREE.Vector3 goes as `{x, y, z}`; Map, Set, typed arrays
 * and plain data go as they are (structured clone); functions are dropped.
 */

/** An enemy at the moment of the event. `type` only the first time the main thread hears of it (spawn). */
export interface EnemyRef {
  $e: number;
  lat: number;
  lon: number;
  /** transform.terrainHeight */
  th: number;
  /** heightOffset */
  ho: number;
  hp: number;
  alive: boolean;
  /** EnemyTypeId; on every ref, it is small */
  type: string;
  /** Route index (packet E_ROUTE) */
  route: number;
  /** Worm group and slot, when a segment */
  worm?: { g: number; slot: number; head: boolean };
  /** movement.getPathProgress(), 0..1: where it was on its route (the wave source's leak share reads it at death) */
  pr?: number;
  /** Has a body (ooze) */
  body?: boolean;
}

/** A tower: the shadow tower of that id (its state came in the same packet, before the events). */
export interface TowerRef {
  $t: string;
}

export interface ProjectileRef {
  $p: number;
  type: string;
  sourceTowerId: string | null;
  lat: number;
  lon: number;
  height: number;
}

export interface WormGroupRef {
  $w: number;
  size: number;
  remaining: number;
  /** EnemyTypeId of the chained type (WormGroup.type.id) */
  type: string;
}

/** An event as it crossed: `type` plus the payload with references; `live`/`show` false when the bus had them muted. */
export interface ExportedEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  /** false while a replay re-simulates (onLive listeners skip it) */
  readonly live: boolean;
  /** false while a replay seeks (onShow listeners skip it) */
  readonly show: boolean;
  /** Game time of the emit, ms (GameClock.gameTimeMs): a packet of many sub-steps carries events of different times */
  readonly t?: number;
  /** Sub-step of the emit (GameClock.subStep) */
  readonly step?: number;
}

export function isEnemyRef(v: unknown): v is EnemyRef {
  return typeof v === 'object' && v !== null && '$e' in v;
}
export function isTowerRef(v: unknown): v is TowerRef {
  return typeof v === 'object' && v !== null && '$t' in v;
}
export function isProjectileRef(v: unknown): v is ProjectileRef {
  return typeof v === 'object' && v !== null && '$p' in v;
}
export function isWormGroupRef(v: unknown): v is WormGroupRef {
  return typeof v === 'object' && v !== null && '$w' in v;
}
