import type { Enemy } from '../entities/enemy.entity';
import type { EnemyGun } from '../entities/enemy-gun';
import type { EnemySiegeConfig } from '../configs/enemy-types.config';
import type { SimSink } from '../sim/core/sim-sink';
import type { WorldDamage } from './game-state/world-damage';
import { IMPACT_REACH_M } from '../configs/destruction.config';
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';
import { geoHeading } from '../utils/geo-utils';
import { DetMath } from '../utils/det-math';

/** Game ms between two looks for a structure while a gun has none in reach */
export const SIEGE_SEARCH_MS = 500;

/** Up the structure a gun aims at: this share of its height, at most SIEGE_AIM_MAX_M */
export const SIEGE_AIM_SHARE = 0.45;
export const SIEGE_AIM_MAX_M = 12;

/**
 * A shell lands on the structure's face towards the gun, this share of its
 * ground radius before its middle: the hit pushes it away from the gun
 * (structureHeading), and the ruin gives way to that side
 */
export const SIEGE_FACE_SHARE = 0.7;

const TAU = Math.PI * 2;

/** Off the body's forward by more than this a structure lies to one side of the way (EnemyGun.side), rad */
export const SIEGE_SIDE_FROM_RAD = 0.35;

/** A turn into -π..π */
function wrap(angle: number): number {
  return angle - TAU * Math.round(angle / TAU);
}

/** `value` stepped towards `target` by at most `step` */
function toward(value: number, target: number, step: number): number {
  const diff = target - value;
  return Math.abs(diff) <= step ? target : value + Math.sign(diff) * step;
}

/**
 * Enemies that fire at structures (EnemyTypeConfig.siege, the jumper), in
 * the simulation: per sub-step in game time, deterministic, in the order the
 * enemy manager holds them.
 *
 * A gun with no structure looks for the nearest one in reach that a shell
 * can damage (StructureLedger.nearestTarget), every SIEGE_SEARCH_MS, on the
 * side of its way it keeps to (EnemyGun.side, sideHoldMs): the other side's
 * only when well nearer or with none left here, and the side turns over
 * only after a while on it (the turret swings across meanwhile). Its
 * turret turns from the body's forward towards it at the type's turn rate,
 * the body turning under it as the enemy walks its route; the guns tilt to
 * a point SIEGE_AIM_SHARE up the structure. Loaded and on target within its
 * tolerance, it fires: the shell flies the distance at the type's speed
 * and lands on the structure's face towards the gun (WorldDamage.shell:
 * the structure damage in its splash, a crater). A structure that falls,
 * leaves the reach or gets a tower on its roof is let go. A stunned or
 * frozen gun holds; a dying enemy's shell still lands.
 *
 * Only on a world with structures (a destructible custom map or OSM world):
 * elsewhere nothing runs, the turret looks ahead (yaw 0) and costs nothing.
 *
 * What the main thread hears: the gun table of the packet (turn and tilt per
 * frame), `main.siegeShot` as a shot leaves and `main.siegeImpact` where it
 * lands; the falls and craters as the world damage says them.
 */
export class EnemySiege {
  constructor(
    private readonly world: WorldDamage,
    private readonly sink: SimSink,
  ) {}

  /** One sub-step of `stepMs` at game time `now` for every gun among `enemies` */
  tick(stepMs: number, now: number, enemies: readonly Enemy[]): void {
    if (this.world.structures.size === 0) return;
    for (const enemy of enemies) {
      const gun = enemy.gun;
      if (gun === null) continue;
      const siege = enemy.typeConfig.siege!;
      if (gun.shellMs >= 0) {
        gun.shellMs -= stepMs;
        if (gun.shellMs <= 0) this.land(enemy, gun, siege);
      }
      if (!enemy.alive) continue;
      if (gun.side !== 0) gun.sideMs += stepMs;
      const m = enemy.movement;
      if (m.hasStatusEffects && (m.isStunned(now) || m.isFrozen(now))) continue;
      if (gun.cooldownMs > 0) gun.cooldownMs -= stepMs;
      if (this.aim(enemy, gun, siege, stepMs) && gun.cooldownMs <= 0 && gun.shellMs < 0) this.fire(enemy, gun, siege);
    }
  }

  /** Keep or find the gun's structure and turn towards it; whether it is on it */
  private aim(enemy: Enemy, gun: EnemyGun, siege: EnemySiegeConfig, stepMs: number): boolean {
    const structures = this.world.structures;
    const ex = enemy.position.lon * MAP_METERS_PER_DEGREE;
    const ey = enemy.position.lat * MAP_METERS_PER_DEGREE;
    if (gun.target >= 0 && !this.inReach(gun.target, ex, ey, siege)) {
      gun.target = -1;
      gun.searchMs = 0;
    }
    if (gun.target < 0) {
      gun.searchMs -= stepMs;
      if (gun.searchMs <= 0) {
        gun.target = this.pick(enemy, gun, siege, ex, ey);
        gun.searchMs = SIEGE_SEARCH_MS;
      }
    }

    let yaw = 0;
    let pitch = 0;
    if (gun.target >= 0) {
      const s = structures.list()[gun.target];
      yaw = wrap(-geoHeading(enemy.position, s) - enemy.transform.rotation);
      const dx = structures.xOf(gun.target) - ex;
      const dy = structures.yOf(gun.target) - ey;
      const range = enemy.typeConfig.turret?.pitchRange ?? { min: 0, max: 0 };
      const rise = aimHeight(s.height) - muzzleHeight(enemy);
      pitch = Math.min(range.max, Math.max(range.min, DetMath.atan2(rise, Math.sqrt(dx * dx + dy * dy))));
    }
    const turn = (siege.turnRate * stepMs) / 1000;
    gun.yaw = wrap(gun.yaw + Math.sign(wrap(yaw - gun.yaw)) * Math.min(Math.abs(wrap(yaw - gun.yaw)), turn));
    gun.pitch = toward(gun.pitch, pitch, (siege.pitchRate * stepMs) / 1000);
    return gun.target >= 0 && Math.abs(wrap(yaw - gun.yaw)) <= siege.alignTolerance;
  }

  /** The structure to take next, -1 for none; a new side from it */
  private pick(enemy: Enemy, gun: EnemyGun, siege: EnemySiegeConfig, ex: number, ey: number): number {
    const structures = this.world.structures;
    const hold = siege.sideHoldMs;
    const factor = siege.otherSideFactor ?? 1;
    const target = hold === undefined || gun.side === 0 || factor === 1
      ? structures.nearestTarget(ex, ey, siege.rangeM)
      : structures.nearestTarget(ex, ey, siege.rangeM, (index, sq) => (this.sideOf(enemy, index) === -gun.side ? sq / (factor * factor) : sq));
    const side = target >= 0 ? this.sideOf(enemy, target) : 0;
    if (side !== 0 && side !== gun.side && (gun.side === 0 || gun.sideMs >= (hold ?? 0))) {
      gun.side = side;
      gun.sideMs = 0;
    }
    return target;
  }

  /** Which side of the enemy's way structure `index` lies on, as the sign of the turret's turn to it; 0 within SIEGE_SIDE_FROM_RAD ahead */
  private sideOf(enemy: Enemy, index: number): number {
    const yaw = wrap(-geoHeading(enemy.position, this.world.structures.list()[index]) - enemy.transform.rotation);
    return yaw > SIEGE_SIDE_FROM_RAD ? 1 : yaw < -SIEGE_SIDE_FROM_RAD ? -1 : 0;
  }

  /** Structure `index` still takes damage and its ground is in the gun's reach */
  private inReach(index: number, ex: number, ey: number, siege: EnemySiegeConfig): boolean {
    const structures = this.world.structures;
    if (!structures.takesDamage(index)) return false;
    const dx = structures.xOf(index) - ex;
    const dy = structures.yOf(index) - ey;
    const reach = siege.rangeM + structures.radiusOf(index);
    return dx * dx + dy * dy <= reach * reach;
  }

  private fire(enemy: Enemy, gun: EnemyGun, siege: EnemySiegeConfig): void {
    const structures = this.world.structures;
    const target = gun.target;
    const s = structures.list()[target];
    const ex = enemy.position.lon * MAP_METERS_PER_DEGREE;
    const ey = enemy.position.lat * MAP_METERS_PER_DEGREE;
    const sx = structures.xOf(target);
    const sy = structures.yOf(target);
    const dx = sx - ex;
    const dy = sy - ey;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // On its face towards the gun; on its middle if the gun stands in it
    const face = dist > 0 ? Math.min(structures.radiusOf(target) * SIEGE_FACE_SHARE, dist / 2) / dist : 0;
    gun.shellX = sx - dx * face;
    gun.shellY = sy - dy * face;
    gun.shellHeight = aimHeight(s.height);
    gun.shellTarget = target;
    const run = dist * (1 - face);
    const rise = gun.shellHeight - muzzleHeight(enemy);
    gun.shellMs = Math.max(1, (Math.sqrt(run * run + rise * rise) / siege.shellSpeedMps) * 1000);
    gun.cooldownMs = siege.reloadMs;
    gun.shots++;
    this.sink.main.siegeShot(
      enemy.id,
      gun.shellY / MAP_METERS_PER_DEGREE,
      gun.shellX / MAP_METERS_PER_DEGREE,
      enemy.transform.terrainHeight + gun.shellHeight,
      gun.shellMs,
    );
  }

  private land(enemy: Enemy, gun: EnemyGun, siege: EnemySiegeConfig): void {
    gun.shellMs = -1;
    this.sink.main.siegeImpact(
      enemy.id,
      enemy.typeConfig.id,
      gun.shellTarget,
      gun.shellY / MAP_METERS_PER_DEGREE,
      gun.shellX / MAP_METERS_PER_DEGREE,
      enemy.transform.terrainHeight + gun.shellHeight,
    );
    this.world.shell(gun.shellX, gun.shellY, siege.structureDamage, siege.splashRadiusM + IMPACT_REACH_M, siege.craterRadiusM);
  }
}

/** Where up a structure of `height` m a gun aims and its shell bursts, m over the ground */
export function aimHeight(height: number): number {
  return Math.min(height * SIEGE_AIM_SHARE, SIEGE_AIM_MAX_M);
}

/** Height of the gun's trunnion over the enemy's ground, m (EnemyTurret.pivotHeight at the size it is drawn) */
function muzzleHeight(enemy: Enemy): number {
  return enemy.heightOffset + (enemy.typeConfig.turret?.pivotHeight ?? 0) * enemy.sizeScale;
}
