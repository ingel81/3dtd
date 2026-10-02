/**
 * The renderer calls of the simulation (docs/SIM_WORKER.md), typed by the
 * engine member path they had on ThreeTilesEngine. The simulation calls its
 * SimSink like it called the engine; every call is recorded as an op
 * (sim/protocol/ops.ts) and the main thread's OpPlayer (presentation/) calls
 * the engine member at the same path with the same arguments.
 *
 * Fire and forget: nothing returns, nothing is read back. Arguments are plain
 * data, a vector as `{ x, y, z }` (the player makes a THREE.Vector3 of it).
 *
 * Where the op is not a plain engine call, its doc says what the player does:
 * the main thread fills in what only it has (a renderer's object, the tile
 * ground, the listener, the wall clock). Every op under `main` and `show` is such a
 * composite; there is no engine member of that name.
 *
 * Ops that only show a moment (texts, flashes, strikes, sounds) are
 * `transient` (TRANSIENT_OP_PREFIXES): while the simulation's bus mutes the
 * show (a replay's seek) they are dropped, like the onShow events. Ops that
 * build or take down what stands (renderers of enemies, towers, projectiles,
 * oozes) always go.
 */
import { createOpRecorder, type PresentationOp } from '../protocol/ops';
import type { RouteWaypoint } from '../../models/game.types';

/** A local position, metres (the scene frame of EllipsoidSync.geoToLocalSimple) */
export interface OpVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A waypoint of a route as the simulation walks it: RouteWaypoint is plain data */
export type OpWaypoint = RouteWaypoint;

/** ThreeEffectsRenderer's FloatingTextConfig */
export interface OpFloatingText {
  readonly color?: string;
  readonly fontSize?: number;
  readonly duration?: number;
  readonly floatSpeed?: number;
  readonly scale?: number;
  readonly outlineColor?: string;
  readonly outlineWidth?: number;
  readonly lateralOffset?: number;
  readonly lateralDrift?: number;
}

export interface SimSink {
  readonly enemies: {
    /**
     * `enemies.create(id, renderType, lat, lon, height)`; once it resolved
     * with render data and `walking`, `enemies.startWalkAnimation(id)`.
     */
    create(id: string, renderType: string, lat: number, lon: number, height: number, walking: boolean): void;
    /** A worm segment becomes a head or the tail (WormChains) */
    setRenderType(id: string, renderType: string): void;
    playDeathAnimation(id: string): void;
    triggerHitFlash(id: string): void;
    remove(id: string): void;
    clear(): void;
  };
  readonly oozes: {
    /**
     * An ooze got its body along `path`, starting where it joins it. The
     * player builds the stations (routeBodyStations(path, its sync, the
     * origin height)) and passes its own route grid's ground to
     * `oozes.add(id, stations, groundAt)`; the bubbling loop starts with it.
     */
    add(id: string, path: readonly OpWaypoint[]): void;
    /**
     * A killed ooze breaks up: `oozes.setFrame(id, tailM, tipM, 0, false x5)`,
     * then `oozes.collapse(id)`; its loop ends in a splat at the body point
     * nearest the listener.
     */
    collapse(id: string, tailM: number, tipM: number): void;
    /** The ooze left the map: `oozes.remove(id)`, its loop stops */
    remove(id: string): void;
    /** Gone at once (wave end, clear): `oozes.discard(id)`, its loop stops */
    discard(id: string): void;
    clear(): void;
  };
  readonly projectiles: {
    create(id: string, typeId: string, lat: number, lon: number, height: number, direction: { dx: number; dy: number; dz: number }): void;
    /** It hit (or a free shot ended) here: shown flying there with the next state, then gone with its trail streak */
    finish(id: string, lat: number, lon: number, height: number): void;
    remove(id: string): void;
    clear(): void;
  };
  readonly trailStreaks: {
    create(projectileId: string, visualType: string): void;
    remove(projectileId: string): void;
    clear(): void;
  };
  readonly towers: {
    /** The player passes the shadow tower's `aim` (mirror) as the 7th argument, which the renderer reads each frame */
    create(id: string, typeId: string, lat: number, lon: number, height: number, customRotation: number): void;
    updateRangeIndicator(id: string, range: number): void;
    setHoldFire(id: string, holdFire: boolean): void;
    /**
     * The tower grows in its scaffold for `remainingMs` more of game time out of `totalMs` (Tower.builtAtMs);
     * 0 ends the build at once
     */
    setBuild(id: string, remainingMs: number, totalMs: number): void;
    remove(id: string): void;
    clear(): void;
  };
  readonly towerBadges: {
    setHoldFire(id: string, holdFire: boolean): void;
    remove(id: string): void;
    clear(): void;
  };
  readonly plinths: {
    create(id: string, lat: number, lon: number, footHeight: number, height: number, footprintRadius: number, overhang: readonly number[]): void;
    remove(id: string): void;
    clear(): void;
  };
  readonly searchlights: {
    /** The player passes TOWER_TYPES[typeId] as the config */
    add(id: string, lat: number, lon: number, footHeight: number, typeId: string): void;
    remove(id: string): void;
    clear(): void;
  };
  readonly tentacles: {
    create(towerId: string, basePosition: OpVec3): void;
    startStrike(towerId: string, target: OpVec3): void;
    resetAllToIdle(): void;
    remove(towerId: string): void;
    clear(): void;
  };
  readonly lightningBolts: {
    /** The player passes `performance.now() / 1000` as `now` */
    registerIdleCrackle(towerId: string, tip: OpVec3): void;
    deregisterIdleCrackle(towerId: string): void;
  };
  readonly flameBeams: {
    /**
     * The beam of the frame, once per frame for every burning tower (the
     * simulation keeps the last of its sub-steps). The flame loop sound
     * follows the beams: it starts with a tower's first startBeam, moves
     * with the source and stops with stopBeam or clear.
     */
    startBeam(towerId: string, source: OpVec3, target: OpVec3, length: number, width: number): void;
    stopBeam(towerId: string): void;
    clear(): void;
  };
  readonly effects: {
    spawnFloatingText(text: string, lat: number, lon: number, height: number, config: OpFloatingText): void;
    spawnTowerInnerFire(towerId: string, position: OpVec3, fireHeight: number, intensity: number): void;
    stopTowerInnerFire(towerId: string): void;
    stopAllTowerFires(): void;
    clear(): void;
  };
  readonly spatialAudio: {
    /** A one-shot at a local position (the sound registered on the main thread) */
    playAt(soundId: string, position: OpVec3): void;
  };
  readonly show: {
    /**
     * Take the show off the field before a snapshot restore or after a
     * replay's seek: the player calls PresentationHost.clearShow()
     * (particles, marks, damage numbers, ability strikes and their sounds,
     * the one-shot sounds). What the restored state shows comes with
     * `sim:presented` (GameStateManager.resyncPresentation).
     */
    clear(): void;
  };
  readonly main: {
    /**
     * A chain lightning bolt of tower `towerId` through `hits` (local, the
     * hit points in order). The player puts the tower renderer's tip in front
     * (the tower's x and z, `towers.get(id).tipY`), emits
     * `vfx:chain-lightning` with those points on the main bus and plays
     * 'lightning-chain' at the tip.
     */
    chainLightning(towerId: string, hits: readonly OpVec3[]): void;
    /**
     * An ice shard burst: `effects.spawnIceExplosionAtGeo(lat, lon,
     * explosionHeight, 35)`; for a ground unit and ground marks on, a
     * frost decal under it and three smaller ones scattered around, each on
     * the tile ground (raycast), `groundHeight` + 0.15 where none is hit.
     */
    iceExplosion(lat: number, lon: number, explosionHeight: number, groundHeight: number, air: boolean): void;
    /** One frost decal under a splash target of the ice shard, as iceExplosion's small ones */
    iceDecal(lat: number, lon: number, groundHeight: number): void;
  };
}

/**
 * Path prefixes of the ops that show a moment (see the file doc): dropped
 * while the show is muted.
 */
export const TRANSIENT_OP_PREFIXES: readonly string[] = [
  'effects.spawnFloatingText',
  'enemies.triggerHitFlash',
  'tentacles.startStrike',
  'spatialAudio.',
  'main.',
];

/** A plain copy of a vector for an op: a scratch Vector3 of the caller would change under the recorded op. */
export function opVec(v: OpVec3): OpVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function isTransientOp(path: string): boolean {
  for (const prefix of TRANSIENT_OP_PREFIXES) if (path.startsWith(prefix)) return true;
  return false;
}

/**
 * The simulation's sink and the ops it recorded since the last take(). One
 * per simulation; the managers and services reach it through SimOps.
 */
export class SimOps {
  private ops: PresentationOp[] = [];
  private showMuted = false;
  readonly sink: SimSink;

  constructor() {
    // The recorder pushes into this object; the mute drops transient ops at the door
    const door = { push: (op: PresentationOp) => this.record(op) } as unknown as PresentationOp[];
    this.sink = createOpRecorder(door) as unknown as SimSink;
  }

  private record(op: PresentationOp): number {
    if (this.showMuted && isTransientOp(op[0])) return this.ops.length;
    return this.ops.push(op);
  }

  /** Follow the bus's show mute (GameEventBus.setShowMuted). */
  setShowMuted(muted: boolean): void {
    this.showMuted = muted;
  }

  /** The ops since the last take, in call order; the list starts empty again. */
  take(): PresentationOp[] {
    const ops = this.ops;
    this.ops = [];
    return ops;
  }

  /** Ops waiting for the next take */
  get pending(): number {
    return this.ops.length;
  }
}
