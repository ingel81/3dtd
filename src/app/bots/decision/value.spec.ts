import { describe, expect, it } from 'vitest';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import type { WavePeekFacts } from '../../director/wave-source';
import {
  chordMetres, difference, emptySides, expectedMetres, killTimeSaved, lingerAdded, slowAdded, threatFromMix, threatFromWaves, towerCapacity,
} from './value';

function wave(enemies: [string, number][], hpByArmor: [string, number][]): WavePeekFacts {
  return {
    wave: 1, name: '', known: true, boss: false, air: false, armors: [], count: null, note: '', description: '',
    enemies, hpByArmor: hpByArmor as WavePeekFacts['hpByArmor'],
  };
}

describe('threatFromWaves', () => {
  it('splits the HP of an armor into air and ground by the types that wear it', () => {
    // bat and spider wear light, bat flies
    const threat = threatFromWaves([wave([['bat', 0.25], ['spider', 0.75]], [['light', 1000]])]);
    expect(threat.air.light).toBeCloseTo(250);
    expect(threat.ground.light).toBeCloseTo(750);
  });

  it('counts the wave after the next at half', () => {
    const threat = threatFromWaves([
      wave([['zombie', 1]], [['unarmored', 1000]]),
      wave([['tank', 1]], [['heavy', 1000]]),
    ]);
    expect(threat.ground.unarmored).toBe(1000);
    expect(threat.ground.heavy).toBe(500);
  });

  it('reads nothing into a wave it cannot read: the mix, on the ground', () => {
    const threat = threatFromMix({ ethereal: 1 });
    expect(threat.ground.ethereal).toBeGreaterThan(0);
    expect(threat.ground.light).toBe(0);
    expect(Object.values(threat.air).every((hp) => hp === 0)).toBe(true);
  });
});

describe('the value of capacity', () => {
  const threat = threatFromWaves([wave([['zombie', 1]], [['unarmored', 5000]])]);
  const archer = TOWER_TYPES.archer;
  const archerOn = (metres: number) => towerCapacity(archer, {}, false, { ground: metres, air: metres });

  it('falls with what stands: the second archer is worth less than the first', () => {
    const first = killTimeSaved(threat, emptySides(), archerOn(40));
    const second = killTimeSaved(threat, archerOn(40), archerOn(40));
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(0);
  });

  it('is worth nothing against a threat the tower cannot hurt', () => {
    const air = threatFromWaves([wave([['bat', 1]], [['light', 5000]])]);
    // The cannon does not hit air
    const cannon = towerCapacity(TOWER_TYPES.cannon, {}, false, { ground: 40, air: 40 });
    expect(killTimeSaved(air, emptySides(), cannon)).toBe(0);
  });

  it('closes a gap first: against an air wave a tower that hits air beats more guns on the ground', () => {
    const mixed = threatFromWaves([wave([['bat', 0.5], ['zombie', 0.5]], [['light', 2500], ['unarmored', 2500]])]);
    const ground = towerCapacity(TOWER_TYPES.cannon, {}, false, { ground: 200, air: 200 });
    const moreGround = killTimeSaved(mixed, ground, towerCapacity(TOWER_TYPES.cannon, {}, false, { ground: 60, air: 60 }));
    const someAir = killTimeSaved(mixed, ground, archerOn(40));
    expect(someAir).toBeGreaterThan(moreGround);
  });

  it('weighs the route a tower covers: a short reach covers less', () => {
    expect(chordMetres(TOWER_TYPES.archer.range)).toBeLessThan(chordMetres(TOWER_TYPES.magic.range));
    // Two routes share the metres, as metersUnderFire averages over them
    expect(expectedMetres('archer', 2)).toBeCloseTo(expectedMetres('archer', 1) / 2);
    // A very short reach keeps some route
    expect(chordMetres(10)).toBeGreaterThan(0);
  });

  it('measures an upgrade by what it adds', () => {
    const before = towerCapacity(archer, {}, false, { ground: 40, air: 40 });
    const after = towerCapacity(archer, { damage: 1 }, false, { ground: 40, air: 40 });
    const added = difference(after, before);
    expect(added.ground.unarmored).toBeGreaterThan(0);
    expect(killTimeSaved(threat, before, added)).toBeGreaterThan(0);
  });
});

describe('slowAdded', () => {
  const others = towerCapacity(TOWER_TYPES.archer, {}, false, { ground: 400, air: 400 });
  const ice = TOWER_TYPES.ice;
  const metres = { ground: 100, air: 100 };

  it('adds to the others on the stretch it covers, nothing without others', () => {
    const added = slowAdded(ice, {}, metres, others, 700);
    expect(added.ground.unarmored).toBeGreaterThan(0);
    expect(added.ground.unarmored).toBeLessThan(others.ground.unarmored * 100 / 700 + 1e-9);
    expect(slowAdded(ice, {}, metres, emptySides(), 700).ground.unarmored).toBe(0);
  });

  it('belongs to the ice tower alone, and grows with its fire rate', () => {
    expect(slowAdded(TOWER_TYPES.archer, {}, metres, others, 700).ground.unarmored).toBe(0);
    const rate = ice.upgrades.find((u) => u.effect.stat === 'fireRate')!;
    expect(slowAdded(ice, { [rate.id]: 5 }, metres, others, 700).ground.unarmored)
      .toBeGreaterThanOrEqual(slowAdded(ice, {}, metres, others, 700).ground.unarmored);
  });
});

describe('lingerAdded', () => {
  it('counts the poison and the burn that tick on after the reach, nothing for a plain tower', () => {
    expect(lingerAdded(TOWER_TYPES.poison, {}, false).ground.unarmored).toBeGreaterThan(0);
    expect(lingerAdded(TOWER_TYPES.fire, {}, false).ground.unarmored).toBeGreaterThan(0);
    expect(lingerAdded(TOWER_TYPES.archer, {}, false).ground.unarmored).toBe(0);
  });
});
