import { describe, it, expect } from 'vitest';
import { StateHasher, type Hashable, type HashSink, type StateHashSource } from './state-hash';
import { HASH_PARTS } from '../coop/hash-check';
import type { Enemy } from '../entities/enemy.entity';
import type { Tower } from '../entities/tower.entity';

function enemy(id: string, lat: number, hp: number): Enemy {
  return {
    id,
    position: { lat, lon: 9.1 },
    transform: { terrainHeight: 3 },
    health: { hp },
    movement: { getPathProgress: () => 0.25, statusEffects: [] },
  } as unknown as Enemy;
}

function tower(id: string, cooldown: number, damageLevel = 0): Tower {
  return {
    id,
    combat: { cooldownRemaining: cooldown, kills: 2, damageDealt: 40 },
    currentTarget: null,
    ownerId: 'local',
    typeConfig: { upgrades: [{ id: 'damage' }, { id: 'speed' }] },
    getUpgradeLevel: (upgradeId: string) => (upgradeId === 'damage' ? damageLevel : 0),
    targetingStrategy: 'closest',
    airSubStrategy: 'closest',
    holdFire: false,
    manned: false,
    builtAtMs: 0,
  } as unknown as Tower;
}

/** A player's research, abilities or hero manager that hands in `values` */
function seat(...values: number[]): Hashable & { getHero: () => null } {
  return { getHero: () => null, hashInto: (sink: HashSink) => values.forEach((v) => sink.num(v)) };
}

function source(
  enemies: Enemy[],
  towers: Tower[] = [tower('tower-1', 10)],
  players: { research?: Hashable; abilities?: Hashable } = {},
): StateHashSource {
  return {
    subStep: () => 600,
    credits: () => [250],
    perfectStreak: () => 0,
    baseHealth: () => 480,
    waveNumber: () => 3,
    idCounter: () => 42,
    rngState: () => ({ seed: 7, streams: { director: 1, spawn: 2, enemy: 3, bot: 4 } }),
    enemies: () => enemies,
    towers: () => towers,
    projectiles: () => [],
    heroes: () => [seat(1)],
    research: () => [players.research ?? seat(1)],
    abilities: () => [players.abilities ?? seat(1)],
  };
}

describe('StateHasher', () => {
  const hasher = new StateHasher();

  it('gives the same hash for the same state', () => {
    expect(hasher.hash(source([enemy('enemy-1', 48.1, 90)])))
      .toBe(hasher.hash(source([enemy('enemy-1', 48.1, 90)])));
  });

  it('notices a difference in the last bit of a position', () => {
    const lat = 48.1;
    const next = lat + Number.EPSILON * 64;
    expect(next).not.toBe(lat);
    expect(hasher.hash(source([enemy('enemy-1', lat, 90)])))
      .not.toBe(hasher.hash(source([enemy('enemy-1', next, 90)])));
  });

  it('notices another order of the same enemies', () => {
    const a = enemy('enemy-1', 48.1, 90);
    const b = enemy('enemy-2', 48.2, 90);
    expect(hasher.hash(source([a, b]))).not.toBe(hasher.hash(source([b, a])));
  });

  it('notices a tower cooldown', () => {
    expect(hasher.hash(source([], [tower('tower-1', 10)])))
      .not.toBe(hasher.hash(source([], [tower('tower-1', 11)])));
  });

  it('notices a status effect, an upgrade level, a tower setting and a build', () => {
    const plain = hasher.hash(source([enemy('enemy-1', 48.1, 90)]));
    const slowed = enemy('enemy-1', 48.1, 90);
    slowed.movement.statusEffects.push({ type: 'slow', value: 0.5, duration: 2000, startTime: 100, sourceId: 's' });
    expect(hasher.hash(source([slowed]))).not.toBe(plain);
    expect(hasher.hash(source([], [tower('tower-1', 10, 1)]))).not.toBe(hasher.hash(source([], [tower('tower-1', 10, 0)])));
    const holding = tower('tower-1', 10);
    holding.holdFire = true;
    expect(hasher.hash(source([], [holding]))).not.toBe(hasher.hash(source([], [tower('tower-1', 10)])));
    const building = tower('tower-1', 10);
    building.builtAtMs = 5000;
    expect(hasher.hash(source([], [building]))).not.toBe(hasher.hash(source([], [tower('tower-1', 10)])));
  });

  describe('breakdown', () => {
    it('gives the same total as hash() and a hash per part', () => {
      const state = source([enemy('enemy-1', 48.1, 90)]);
      const breakdown = hasher.breakdown(state);
      expect(breakdown.total).toBe(hasher.hash(state));
      expect(breakdown.parts).toHaveLength(HASH_PARTS.length);
    });

    it('names the one part that differs', () => {
      const a = hasher.breakdown(source([enemy('enemy-1', 48.1, 90)]));
      const b = hasher.breakdown(source([enemy('enemy-1', 48.1, 89)]));
      const differ = HASH_PARTS.filter((_, i) => a.parts[i] !== b.parts[i]);
      expect(differ).toEqual(['enemies']);
    });

    it('names research and abilities apart', () => {
      const base = hasher.breakdown(source([]));
      const research = hasher.breakdown(source([], undefined, { research: seat(2) }));
      const abilities = hasher.breakdown(source([], undefined, { abilities: seat(0, 3) }));
      expect(HASH_PARTS.filter((_, i) => base.parts[i] !== research.parts[i])).toEqual(['research']);
      expect(HASH_PARTS.filter((_, i) => base.parts[i] !== abilities.parts[i])).toEqual(['abilities']);
    });

    it('keeps what each entity put in, id first', () => {
      const breakdown = hasher.breakdown(source([enemy('enemy-1', 48.1, 90)]));
      const [enemyRow] = breakdown.entities.enemies!;
      expect(enemyRow.slice(0, 6)).toEqual(['enemy-1', 48.1, 9.1, 3, 90, 0.25]);
      expect(enemyRow).toHaveLength(7); // the status effects as one digest
      const [towerRow] = breakdown.entities.towers!;
      expect(towerRow.slice(0, 5)).toEqual(['tower-1', 10, 2, 40, '']);
      expect(towerRow.slice(6)).toEqual(['closest', 'closest', 0, 0]);
      expect(breakdown.entities.heroes).toEqual([[0, -1, expect.any(Number)]]);
      expect(breakdown.entities.research).toEqual([[0, expect.any(Number)]]);
      expect(breakdown.entities.projectiles).toBeUndefined();
    });
  });
});
