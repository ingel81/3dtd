import { GameClock } from '../managers/game-state/game-clock';
import type { Enemy } from '../entities/enemy.entity';
import type { Tower } from '../entities/tower.entity';
import type { Projectile } from '../entities/projectile.entity';
import type { Hero } from '../entities/hero.entity';
import type { GameRngState } from '../utils/game-rng';
import { RNG_STREAMS } from '../utils/game-rng';
import { LOCAL_PLAYER_ID } from '../managers/game-state/command-log';
import { HASH_PARTS, type HashedEntities, type HashPart } from '../coop/hash-check';

/**
 * The version of what the state hash reads. A replay file carries it; one of
 * another version plays without its hashes checked (replay-file.ts).
 * 1: up to 0.5.1. 2: status effects, tower settings and upgrades, research,
 * abilities, the hero's level and ammo, the perfect streak (TODO E63 i).
 * 3: the simulation computes with DetMath instead of the native Math (E28),
 * so the same run gives other bits. 4: a tower's build end (Tower.builtAtMs) and path.
 * 5: the wave's spawner, the kill gold left and paid, an enemy's walk and
 * run phase (TODO E94) and its camouflage.
 */
export const STATE_HASH_VERSION = 5;

/** Takes what a manager hands to the hash (Hashable). */
export interface HashSink {
  num(value: number): void;
  str(value: string): void;
}

/**
 * State that hands itself to the hash: research, abilities, a hero's
 * manager. It goes in as one number per player, the breakdown row stays short.
 */
export interface Hashable {
  hashInto(sink: HashSink): void;
}

/** A player's hero seat: the manager with its state, the hero when hired. */
export interface HashedHeroSeat extends Hashable {
  getHero(): Hero | null;
}

/**
 * What the state hash reads. The GameStateManager provides it
 * (GameStateManager.hashSource); a spec can hand in plain objects.
 */
export interface StateHashSource {
  subStep(): number;
  /** Every player's credits in roster order; one in the single player game */
  credits(): readonly number[];
  /** Perfect waves in a row: the combo of the next wave's bonus */
  perfectStreak(): number;
  /** The wave's kill gold not yet paid and the reward weight paid so far (EnemyManager); null between waves */
  killRewards(): { remainingKillBudget: number; paidRewardWeight: number } | null;
  baseHealth(): number;
  waveNumber(): number;
  /** The running wave's spawner, null while none runs (WaveManager) */
  spawner(): { accumulatedMs: number; nextDelayMs: number; spawnIndex: number } | null;
  idCounter(): number;
  rngState(): GameRngState;
  enemies(): readonly Enemy[];
  towers(): readonly Tower[];
  projectiles(): readonly Projectile[];
  /** Every player's hero seat in roster order; one in the single player game */
  heroes(): readonly HashedHeroSeat[];
  /** Every player's research in roster order */
  research(): readonly Hashable[];
  /** Every player's abilities in roster order */
  abilities(): readonly Hashable[];
}

/** The state hash with the hash of each part (HASH_PARTS order) and, per entity part, what each entity put in. */
export interface HashBreakdown {
  total: number;
  /** One per HASH_PARTS entry, in that order */
  parts: number[];
  /** Per entity: its id (projectiles and heroes: the index), then its values */
  entities: HashedEntities;
}

const FNV_OFFSET = 0x811c9dc5;

/**
 * A hash over the simulation state, for telling whether two runs are still
 * the same (docs/SIMULATOR_PLAN.md, P5). Numbers go in bit for bit, not
 * rounded: on one machine a re-simulation has to match exactly, and any
 * difference, however small, is the first sign of a divergence that grows.
 *
 * breakdown() gives the same total plus a hash per part and the values of
 * every entity, for finding where a coop room ran apart (TODO E32).
 *
 * Cost: a handful of numbers per entity through one FNV-1a round each, no
 * allocation in hash() beyond what the source's lists are. Taken while recording and checking, every
 * STATE_HASH_INTERVAL sub-steps and at the wave end, in coop every
 * HASH_EVERY_TICKS ticks, never in normal play.
 */
export class StateHasher {
  private readonly f64 = new Float64Array(1);
  private readonly u32 = new Uint32Array(this.f64.buffer);
  private h = 0;
  /** The hash of the current part */
  private p = 0;
  private out: HashBreakdown | null = null;
  /** The entity being read, while a breakdown collects them */
  private row: (string | number)[] | null = null;
  /** The digest being collected, see digest() */
  private d = 0;
  private readonly sink: HashSink = {
    num: (value) => {
      this.f64[0] = value;
      this.d = fnv(fnv(this.d, this.u32[0]), this.u32[1]);
    },
    str: (value) => {
      this.d = fnv(this.d, value.length);
      for (let i = 0; i < value.length; i++) this.d = fnv(this.d, value.charCodeAt(i));
    },
  };

  hash(source: StateHashSource): number {
    this.out = null;
    return this.run(source);
  }

  breakdown(source: StateHashSource): HashBreakdown {
    const out: HashBreakdown = { total: 0, parts: [], entities: {} };
    this.out = out;
    out.total = this.run(source);
    this.out = null;
    return out;
  }

  private run(source: StateHashSource): number {
    this.h = FNV_OFFSET;
    this.part('clock');
    this.num(source.subStep());
    this.part('credits');
    for (const credits of source.credits()) this.num(credits);
    this.num(source.perfectStreak());
    // The gold of the kills to come: a difference shows in the credits only at the next kill
    const rewards = source.killRewards();
    if (rewards) {
      this.num(rewards.remainingKillBudget);
      this.num(rewards.paidRewardWeight);
    } else {
      this.num(-1);
    }
    this.part('health');
    this.num(source.baseHealth());
    this.part('wave');
    this.num(source.waveNumber());
    // The spawner: a difference shows only once the next enemy comes out, or does not
    const spawner = source.spawner();
    if (spawner) {
      this.num(spawner.accumulatedMs);
      this.num(spawner.nextDelayMs);
      this.num(spawner.spawnIndex);
    } else {
      this.num(-1);
    }
    this.part('ids');
    this.num(source.idCounter());
    this.part('rng');
    const rng = source.rngState();
    this.num(rng.seed);
    // Not the director's stream: only the client that starts a wave plans it, and its plan enters
    // the simulation as the start command. In coop the other clients draw from it later or never,
    // which the hash took for a divergence (TODO E32, found by the hash parts on 2026-09-26).
    for (const name of RNG_STREAMS) if (name !== 'director') this.num(rng.streams[name] ?? -1);

    this.part('enemies');
    const enemies = source.enemies();
    this.num(enemies.length);
    for (const enemy of enemies) {
      this.entity('enemies');
      this.str(enemy.id);
      this.num(enemy.position.lat);
      this.num(enemy.position.lon);
      this.num(enemy.transform.terrainHeight);
      this.num(enemy.health.hp);
      this.num(enemy.movement.getPathProgress());
      // Status effects: a slow that lasts longer shows only once it ends
      const effects = enemy.movement.statusEffects;
      this.d = FNV_OFFSET;
      this.sink.num(effects.length);
      for (const effect of effects) {
        this.sink.str(effect.type);
        this.sink.num(effect.value);
        this.sink.num(effect.startTime);
        this.sink.num(effect.duration);
      }
      this.num(this.d >>> 0);
      // Walk or run: the speed differs only once the phase turns
      if (enemy.rush) this.digest(enemy.rush);
      // Camouflaged: shows otherwise only in whom the towers pick. Only then, a plain enemy's row stays short;
      // `revealed` follows from the positions every sub-step
      if (enemy.camo) this.str('camo');
    }

    this.part('towers');
    const towers = source.towers();
    this.num(towers.length);
    for (const tower of towers) {
      this.entity('towers');
      this.str(tower.id);
      this.num(tower.combat.cooldownRemaining);
      this.num(tower.combat.kills);
      this.num(tower.combat.damageDealt);
      this.str(tower.currentTarget?.id ?? '');
      // Settings and upgrades act on the game long before a hash of the fight shows them
      this.d = FNV_OFFSET;
      for (const upgrade of tower.typeConfig.upgrades) this.sink.num(tower.getUpgradeLevel(upgrade.id));
      this.num(this.d >>> 0);
      this.str(tower.targetingStrategy);
      this.str(tower.airSubStrategy);
      this.num((tower.holdFire ? 1 : 0) + (tower.manned ? 2 : 0));
      this.num(tower.builtAtMs);
      this.str(tower.pathId ?? '');
      // The owner only when it is not the single player: a single player's row stays short
      if (tower.ownerId !== LOCAL_PLAYER_ID) this.str(tower.ownerId);
    }

    this.part('projectiles');
    const projectiles = source.projectiles();
    this.num(projectiles.length);
    projectiles.forEach((projectile, i) => {
      this.entity('projectiles', i);
      this.num(projectile.position.lat);
      this.num(projectile.position.lon);
    });

    this.part('heroes');
    const heroes = source.heroes();
    for (let i = 0; i < heroes.length; i++) {
      this.entity('heroes', i);
      const hero = heroes[i].getHero();
      if (hero) {
        this.num(hero.position.lat);
        this.num(hero.position.lon);
        this.num(hero.combat.cooldownRemaining);
      } else {
        this.num(-1);
      }
      this.digest(heroes[i]);
    }

    this.part('research');
    this.seats('research', source.research());
    this.part('abilities');
    this.seats('abilities', source.abilities());
    this.part(null);
    return this.h >>> 0;
  }

  /** One row per player: their index, then the digest of what they hand in. */
  private seats(part: HashPart, seats: readonly Hashable[]): void {
    for (let i = 0; i < seats.length; i++) {
      this.entity(part, i);
      this.digest(seats[i]);
    }
  }

  /** What `state` hands in, folded into one number. */
  private digest(state: Hashable): void {
    this.d = FNV_OFFSET;
    state.hashInto(this.sink);
    this.num(this.d >>> 0);
  }

  /** Close the part before, open `name`; null closes the last. */
  private part(name: HashPart | null): void {
    this.row = null;
    const out = this.out;
    if (!out) return;
    if (name !== HASH_PARTS[0]) out.parts.push(this.p >>> 0);
    this.p = FNV_OFFSET;
  }

  /** A new entity of `part`; its id comes with the first str(), or is `index`. */
  private entity(part: HashPart, index?: number): void {
    const out = this.out;
    if (!out) return;
    this.row = index === undefined ? [] : [index];
    (out.entities[part] ??= []).push(this.row);
  }

  private num(value: number): void {
    this.row?.push(value);
    this.f64[0] = value;
    this.mix(this.u32[0]);
    this.mix(this.u32[1]);
  }

  private str(value: string): void {
    this.row?.push(value);
    this.mix(value.length);
    for (let i = 0; i < value.length; i++) this.mix(value.charCodeAt(i));
  }

  private mix(word: number): void {
    this.h = fnv(this.h, word);
    if (this.out) this.p = fnv(this.p, word);
  }
}

/** One FNV-1a round over the four bytes of `word`. */
function fnv(hash: number, word: number): number {
  let h = hash;
  h ^= word & 0xff;
  h = Math.imul(h, 0x01000193);
  h ^= (word >>> 8) & 0xff;
  h = Math.imul(h, 0x01000193);
  h ^= (word >>> 16) & 0xff;
  h = Math.imul(h, 0x01000193);
  h ^= word >>> 24;
  return Math.imul(h, 0x01000193);
}

/** Sub-steps between two hashes while recording or checking a wave: one game second. */
export const STATE_HASH_INTERVAL = GameClock.stepsIn(1000);
