import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { MainEventBus } from '../sim/client/view-events';
import type { EnemyView } from '../sim/client/views';
import { SIEGE_LOOKS } from '../configs/siege-look.config';
import { ENEMY_TYPES, type EnemyTypeId } from '../configs/enemy-types.config';
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';

type SiegeEngine = Pick<ThreeTilesEngine, 'enemies' | 'effects' | 'shotLights' | 'siegeShells' | 'sync' | 'world'>;

/** What the effects read of the mirror: the enemy that fired */
export interface SiegeSource {
  enemy(id: string): EnemyView | null;
}

/**
 * The shots of the siege guns as the simulation fires them (ops
 * `main.siegeShot` and `main.siegeImpact`, managers/enemy-siege.ts), shown
 * by their type's SiegeLook (configs/siege-look.config.ts).
 *
 * A shot: the guns kick back (EnemyInstanceManager.fireTurret), each muzzle
 * flashes and throws a fireball of smoke ahead of its barrel, the blast
 * lights the land round it and raises dust round the walker's feet, and the
 * shell flies to where the simulation lands it (SiegeShellRenderer).
 * The landing: a fireball as big as a house, grit and sparks, dust over the
 * ground, its light, and pieces of what it hit thrown out (the world's
 * flying debris, in the structure's material). Sound and shake go out on
 * the main bus as vfx:siege-shot and vfx:siege-impact (GameSoundsService,
 * ScreenShakeService). The falls and craters that follow are the world
 * damage's (WorldDamagePresenter).
 *
 * Moments of the show: dropped while a replay seeks, like every `main.` op.
 */
export class SiegeEffects {
  private readonly muzzles: Vector3[] = [];
  private readonly target = new Vector3();
  private readonly ahead = new Vector3();
  private readonly mean = new Vector3();

  constructor(
    private readonly engine: SiegeEngine,
    private readonly bus: MainEventBus,
    private readonly source: SiegeSource,
  ) {}

  /** Enemy `enemyId` fired a shell landing at (`lat`, `lon`, geo `height`) in `flightMs` of game time */
  shot(enemyId: string, lat: number, lon: number, height: number, flightMs: number): void {
    const enemy = this.source.enemy(enemyId);
    const look = enemy ? SIEGE_LOOKS[enemy.typeConfig.id as EnemyTypeId] : undefined;
    if (!enemy || !look) return;
    const { effects, shotLights, sync } = this.engine;
    this.engine.enemies.fireTurret(enemyId);
    const to = sync.geoToLocalSimpleInto(lat, lon, height, this.target);
    let count = this.engine.enemies.turretMuzzles(enemyId, this.muzzles);
    if (count === 0) {
      // No instance to read the muzzles from (not drawn yet): the shot leaves from its turret's height
      const p = enemy.position;
      const turret = enemy.typeConfig.turret;
      sync.geoToLocalSimpleInto(p.lat, p.lon, (p.height ?? 0) + enemy.heightOffset + (turret?.pivotHeight ?? 0) * enemy.typeConfig.scale, (this.muzzles[0] ??= new Vector3()));
      count = 1;
    }
    this.mean.set(0, 0, 0);
    for (let i = 0; i < count; i++) {
      const m = this.muzzles[i];
      this.mean.add(m);
      if (effects.muzzleFlashesEnabled) {
        effects.spawnMuzzleFlash(m.x, m.y, m.z, look.shot.flash);
        if (shotLights.active) shotLights.pulse(m.x, m.y, m.z, look.shot.light);
      }
      // The muzzle blast rolls out a few metres ahead of the barrel, its smoke hangs on
      const out = this.ahead.copy(to).sub(m).setLength(look.shot.blast.radius * 0.8).add(m);
      const { particles, radius, smokePuffs } = look.shot.blast;
      effects.spawnExplosion(out.x, out.y, out.z, particles, radius, smokePuffs);
    }
    this.mean.multiplyScalar(1 / count);
    // The blast's push on the ground round its feet
    const p = enemy.position;
    const foot = sync.geoToLocalSimpleInto(p.lat, p.lon, p.height ?? 0, this.ahead);
    effects.spawnGroundDust(foot.x, foot.y + 0.3, foot.z, look.shot.dust.puffs, look.shot.dust.radius, look.shot.dust.speed);
    this.engine.siegeShells.fire(enemyId, this.mean, to, flightMs, look.shell);
    const at = sync.localToGeo(this.mean);
    this.bus.emit({ type: 'vfx:siege-shot', enemyTypeId: enemy.typeConfig.id, lat: at.lat, lon: at.lon, height: at.height });
  }

  /** The shell of enemy `enemyId` (of type `typeId`) fired at structure `structure` landed at (`lat`, `lon`, geo `height`) */
  impact(enemyId: string, typeId: string, structure: number, lat: number, lon: number, height: number): void {
    this.engine.siegeShells.land(enemyId);
    const look = SIEGE_LOOKS[typeId as EnemyTypeId];
    if (!look || !ENEMY_TYPES[typeId]) return;
    const { effects, shotLights, sync, world } = this.engine;
    const at = sync.geoToLocalSimpleInto(lat, lon, height, this.target);
    const { particles, radius, smokePuffs } = look.impact.blast;
    effects.spawnExplosion(at.x, at.y, at.z, particles, radius, smokePuffs);
    effects.spawnBurstAtGeo(lat, lon, height, look.impact.sparks.particles, look.impact.sparks.palette);
    if (effects.impactEffectsEnabled && shotLights.active) shotLights.pulse(at.x, at.y, at.z, look.impact.light);
    const ground = height - Math.min(height, look.impact.debris.height * 0.5);
    const dust = sync.geoToLocalSimpleInto(lat, lon, ground, this.ahead);
    effects.spawnGroundDust(dust.x, dust.y + 0.3, dust.z, look.impact.dust.puffs, look.impact.dust.radius, look.impact.dust.speed);
    // Pieces of what it hit, of its material
    const destruction = world.capabilities.destructible ? world.destruction : null;
    const material = structure >= 0 ? destruction?.structures()[structure]?.material : undefined;
    if (material) {
      destruction?.ground?.debris(
        lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE, look.impact.debris.radius, look.impact.debris.height, material, structure * 3.17 + 0.5,
      );
    }
    this.bus.emit({ type: 'vfx:siege-impact', enemyTypeId: typeId, lat, lon, height });
  }
}
