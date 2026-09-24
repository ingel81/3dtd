import type { Enemy } from '../entities/enemy.entity';
import type { Tower } from '../entities/tower.entity';
import type { Projectile } from '../entities/projectile.entity';
import type { Hero } from '../entities/hero.entity';
import type { GameRngState } from '../utils/game-rng';
import { RNG_STREAMS } from '../utils/game-rng';

/**
 * What the state hash reads. The GameStateManager provides it
 * (GameStateManager.hashSource); a spec can hand in plain objects.
 */
export interface StateHashSource {
  subStep(): number;
  credits(): number;
  baseHealth(): number;
  waveNumber(): number;
  idCounter(): number;
  rngState(): GameRngState;
  enemies(): readonly Enemy[];
  towers(): readonly Tower[];
  projectiles(): readonly Projectile[];
  hero(): Hero | null;
}

/**
 * A hash over the simulation state, for telling whether two runs are still
 * the same (docs/SIMULATOR_PLAN.md, P5). Numbers go in bit for bit, not
 * rounded: on one machine a re-simulation has to match exactly, and any
 * difference, however small, is the first sign of a divergence that grows.
 *
 * Cost: a handful of numbers per entity through one FNV-1a round each, no
 * allocation. Taken while recording and checking, every
 * STATE_HASH_INTERVAL sub-steps and at the wave end, never in normal play.
 */
export class StateHasher {
  private readonly f64 = new Float64Array(1);
  private readonly u32 = new Uint32Array(this.f64.buffer);
  private h = 0;

  hash(source: StateHashSource): number {
    this.h = 0x811c9dc5;
    this.num(source.subStep());
    this.num(source.credits());
    this.num(source.baseHealth());
    this.num(source.waveNumber());
    this.num(source.idCounter());
    const rng = source.rngState();
    this.num(rng.seed);
    for (const name of RNG_STREAMS) this.num(rng.streams[name] ?? -1);

    const enemies = source.enemies();
    this.num(enemies.length);
    for (const enemy of enemies) {
      this.str(enemy.id);
      this.num(enemy.position.lat);
      this.num(enemy.position.lon);
      this.num(enemy.transform.terrainHeight);
      this.num(enemy.health.hp);
      this.num(enemy.movement.getPathProgress());
    }

    const towers = source.towers();
    this.num(towers.length);
    for (const tower of towers) {
      this.str(tower.id);
      this.num(tower.combat.cooldownRemaining);
      this.num(tower.combat.kills);
      this.num(tower.combat.damageDealt);
      this.str(tower.currentTarget?.id ?? '');
    }

    const projectiles = source.projectiles();
    this.num(projectiles.length);
    for (const projectile of projectiles) {
      this.num(projectile.position.lat);
      this.num(projectile.position.lon);
    }

    const hero = source.hero();
    if (hero) {
      this.num(hero.position.lat);
      this.num(hero.position.lon);
      this.num(hero.combat.cooldownRemaining);
    } else {
      this.num(-1);
    }
    return this.h >>> 0;
  }

  private num(value: number): void {
    this.f64[0] = value;
    this.mix(this.u32[0]);
    this.mix(this.u32[1]);
  }

  private str(value: string): void {
    this.mix(value.length);
    for (let i = 0; i < value.length; i++) this.mix(value.charCodeAt(i));
  }

  private mix(word: number): void {
    let h = this.h;
    h ^= word & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (word >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (word >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= word >>> 24;
    this.h = Math.imul(h, 0x01000193);
  }
}

/** Sub-steps between two hashes while recording or checking a wave: one game second. */
export const STATE_HASH_INTERVAL = 60;
