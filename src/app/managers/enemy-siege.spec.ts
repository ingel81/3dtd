import { describe, expect, it, vi } from 'vitest';
import { EnemySiege, SIEGE_SEARCH_MS, SIEGE_SIDE_FROM_RAD, aimHeight } from './enemy-siege';
import { WorldDamage, type WorldDamageHost } from './game-state/world-damage';
import { Enemy } from '../entities/enemy.entity';
import { EnemyGun } from '../entities/enemy-gun';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { MAP_METERS_PER_DEGREE as K } from '../world/custom-map/map-document';
import { runRulesOf, type RunStructure } from '../sim/protocol/run-rules';
import { assignPlainFields, plainFields } from '../simulator/plain-fields';
import type { Tower } from '../entities/tower.entity';
import type { HashSink } from '../simulator/state-hash';

/**
 * The jumper's gun against the structures of a destructible world
 * (managers/enemy-siege.ts, EnemyTypeConfig.siege): what it picks, how fast
 * it turns and fires, what a shell does, and that it does nothing where
 * nothing can fall.
 */

const SIEGE = ENEMY_TYPES['jumper'].siege!;
const STEP = 1000 / 60;

/** A map point (metres east, north) as map degrees */
const geo = (x: number, y: number) => ({ lat: y / K, lon: x / K });

const house = (id: string, x: number, y: number, extra: Partial<RunStructure> = {}): RunStructure =>
  ({ id, ...geo(x, y), radius: 5, height: 10, hp: 900, ...extra });

function setup(structures: RunStructure[]) {
  const ops: [string, ...unknown[]][] = [];
  const record = (path: string) => (...args: unknown[]) => ops.push([path, ...args]);
  const sink = {
    structures: { setStages: record('structures.setStages'), stage: record('structures.stage'), holes: record('structures.holes') },
    craters: { setAll: record('craters.setAll'), dig: record('craters.dig') },
    main: { structureFell: record('main.structureFell'), siegeShot: record('main.siegeShot'), siegeImpact: record('main.siegeImpact') },
  };
  const towers: Tower[] = [];
  const host: WorldDamageHost = {
    sink: sink as never,
    toLocal: (lat, lon, out) => {
      out.x = -lon * K;
      out.z = lat * K;
    },
    routeSpan: () => ({ minIx: -100, minIz: -100, maxIx: 100, maxIz: 100 }),
    setField: () => undefined,
    towers: () => towers,
    enemies: () => [],
    seeAround: vi.fn(),
  };
  const world = new WorldDamage(host);
  world.load(runRulesOf({ structures, destruction: { craters: true, wear: false } }));
  const siege = new EnemySiege(world, sink as never);
  // The jumper at the map's origin, facing north
  const jumper = new Enemy('jumper', [geo(0, 0), geo(0, 400)]);
  jumper.transform.setPosition(geo(0, 0).lat, geo(0, 0).lon, 0);
  jumper.transform.setHeading(0);
  let now = 0;
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += STEP) {
      now += STEP;
      siege.tick(STEP, now, [jumper]);
    }
  };
  ops.length = 0;
  return { world, siege, jumper, gun: jumper.gun!, ops, towers, run, now: () => now };
}

const shots = (ops: [string, ...unknown[]][]) => ops.filter(([p]) => p === 'main.siegeShot');

describe('EnemySiege', () => {
  it('gives the jumper a gun and no one else', () => {
    expect(new Enemy('jumper', [geo(0, 0), geo(0, 1)]).gun).toBeInstanceOf(EnemyGun);
    expect(new Enemy('golem-king', [geo(0, 0), geo(0, 1)]).gun).toBeNull();
  });

  it('does nothing on a world where nothing falls: the turret looks ahead, no shot, no op', () => {
    const { gun, ops, run } = setup([]);
    run(20_000);
    expect([gun.yaw, gun.pitch, gun.target, gun.shots, gun.cooldownMs]).toEqual([0, 0, -1, 0, SIEGE.firstShotMs]);
    expect(ops).toEqual([]);
  });

  it('picks the nearest structure in reach that a shell can damage, the first of two alike', () => {
    const { gun, run, towers } = setup([
      house('far', 0, SIEGE.rangeM + 30),
      house('roofed', 12, 0, { roof: true, box: [12, 0, 4, 4, 0] }),
      house('east', 30, 0),
      house('west', -30, 0),
    ]);
    // A tower on the roof of the nearest: it takes no damage, the gun leaves it
    towers.push({ position: { ...geo(12, 0), height: 10 } } as Tower);
    run(STEP);
    expect(gun.target).toBe(2);
    // The tower gone, the nearest is a target again on the next look
    towers.length = 0;
    gun.target = -1;
    gun.searchMs = 0;
    run(STEP);
    expect(gun.target).toBe(1);
  });

  it('leaves small structures be: rails, a fence and a shed nearer than the house are not taken', () => {
    const { gun, run } = setup([
      house('rail', 6, 0, { radius: 4.5, height: 0.6 }),
      house('fence', -6, 0, { radius: 2, height: 1.3 }),
      house('shed', 8, 2, { radius: 1.4, height: 2.9 }),
      house('kiosk', -8, 2, { radius: 2.1, height: 3 }),
      house('cottage', 25, 0, { radius: 3.2, height: 6 }),
    ]);
    run(STEP);
    expect(gun.target).toBe(4);
  });

  it('takes nothing where only small structures stand', () => {
    const { gun, ops, run } = setup([house('rail', 6, 0, { radius: 4.5, height: 0.6 }), house('hedge', -6, 0, { radius: 3, height: 1.8 })]);
    run(20_000);
    expect(gun.target).toBe(-1);
    expect(shots(ops)).toEqual([]);
  });

  it('keeps to its side of the way: a house across only when well nearer, the side itself only after a while', () => {
    const { gun, run, world } = setup([house('east', 30, 0), house('west', -20, 5), house('east-far', 60, 0)]);
    // The west house is nearer, but not by enough: the gun keeps to its side, east (a negative turn)
    gun.side = -1;
    run(STEP);
    expect(gun.target).toBe(0);
    // East falls: across to the west house, much nearer than the next east one, the turret alone while the side is held
    world.shell(30, 0, 5000, 1, 0);
    gun.target = -1;
    gun.searchMs = 0;
    gun.sideMs = 0;
    run(STEP);
    expect(gun.target).toBe(1);
    expect(gun.side).toBe(-1);
    // Held long enough: the next pick across turns the side over
    gun.target = -1;
    gun.searchMs = 0;
    gun.sideMs = SIEGE.sideHoldMs!;
    run(STEP);
    expect(gun.target).toBe(1);
    expect([gun.side, gun.sideMs]).toEqual([1, 0]);
  });

  it('takes a side with its first structure', () => {
    const { gun, run } = setup([house('west', -25, 0)]);
    run(STEP);
    expect(gun.target).toBe(0);
    expect(gun.side).toBe(1);
  });

  it('turns its front over less often in a street with houses on both sides (side switches as the crab shows them)', () => {
    // Houses every 15 m on both sides of a street running north, 14 m off its middle; one shell fells each
    const street: RunStructure[] = [];
    for (let y = 20; y <= 600; y += 15) street.push(house(`e${y}`, 14, y), house(`w${y}`, -14, y + 7));
    const switches = (sides: boolean): { switches: number; shots: number } => {
      const config = ENEMY_TYPES['jumper'].siege!;
      const kept = { hold: config.sideHoldMs, factor: config.otherSideFactor };
      if (!sides) {
        config.sideHoldMs = undefined;
        config.otherSideFactor = undefined;
      }
      try {
        const { jumper, gun, siege, now } = setup(street);
        let side = 0;
        let count = 0;
        let t = now();
        // Three minutes along the street at 3 m/s
        for (let step = 0; step < (180_000 / STEP); step++) {
          t += STEP;
          const y = (3 * t) / 1000;
          jumper.transform.setPosition(geo(0, y).lat, geo(0, y).lon, 0);
          siege.tick(STEP, t, [jumper]);
          // A crab's front faces the gun's side (EnemyInstanceManager.setTurret); before these rules it followed
          // the turret past SIEGE_SIDE_FROM_RAD
          const next = sides ? gun.side || side : gun.yaw > SIEGE_SIDE_FROM_RAD ? 1 : gun.yaw < -SIEGE_SIDE_FROM_RAD ? -1 : side;
          if (side !== 0 && next !== side) count++;
          side = next;
        }
        return { switches: count, shots: gun.shots };
      } finally {
        config.sideHoldMs = kept.hold;
        config.otherSideFactor = kept.factor;
      }
    };
    const before = switches(false);
    const after = switches(true);
    // As many houses fall either way; nearest first turned the front over 9 times, keeping to a side never here
    // (the houses across are never well nearer than the next on its own side)
    expect(after.shots).toBe(before.shots);
    expect(before.switches).toBeGreaterThanOrEqual(6);
    expect(after.switches).toBeLessThanOrEqual(1);
  });

  it('turns the turret at its turn rate, east as a heading turns (negative), and tilts up to the aim', () => {
    const { gun, run } = setup([house('east', 40, 0)]);
    run(500);
    const turned = -gun.yaw;
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeCloseTo(SIEGE.turnRate * 0.5, 1);
    run(3000);
    expect(gun.yaw).toBeCloseTo(-Math.PI / 2, 6);
    // Aim at 45 % of 10 m from a trunnion 6.3 m up: a little up
    const rise = aimHeight(10) - ENEMY_TYPES['jumper'].turret!.pivotHeight * ENEMY_TYPES['jumper'].scale;
    expect(gun.pitch).toBeCloseTo(Math.atan2(rise, 40), 3);
  });

  it('fires once loaded and on target, then every reload; the shell lands after its flight and fells the house', () => {
    const { world, gun, ops, run } = setup([house('east', 40, 0, { hp: SIEGE.structureDamage })]);
    run(SIEGE.firstShotMs - 50);
    expect(shots(ops)).toEqual([]);
    run(200);
    expect(gun.shots).toBe(1);
    const [, enemyId, lat, lon, height, flightMs] = shots(ops)[0] as [string, string, number, number, number, number];
    expect(enemyId).toBe('enemy-' + enemyId.split('-')[1]);
    // On the house's face towards the gun, 0.7 of its radius before its middle
    expect(lon * K).toBeCloseTo(40 - 5 * 0.7, 6);
    expect(lat * K).toBeCloseTo(0, 6);
    expect(height).toBeCloseTo(aimHeight(10), 6);
    expect(flightMs).toBeGreaterThan(100);
    expect(world.structures.hpList()).toEqual([SIEGE.structureDamage]);
    run(flightMs + STEP);
    // Blast first, then what it did
    const after = ops.map(([p]) => p);
    expect(after.indexOf('main.siegeImpact')).toBeLessThan(after.indexOf('main.structureFell'));
    expect(ops.find(([p]) => p === 'main.siegeImpact')!.slice(1, 4)).toEqual([enemyId, 'jumper', 0]);
    expect(world.structures.hpList()).toEqual([0]);
    expect(world.craters.size).toBe(1);
    // Nothing left in reach: the gun looks again and turns ahead
    run(SIEGE_SEARCH_MS + 4000);
    expect(gun.target).toBe(-1);
    expect(gun.yaw).toBeCloseTo(0, 6);
    expect(gun.shots).toBe(1);
  });

  it('keeps its cadence on a structure that holds out', () => {
    const { gun, run } = setup([house('tower block', 40, 0, { hp: 100_000 })]);
    run(SIEGE.firstShotMs + 3 * SIEGE.reloadMs + 1000);
    // The first shot waits for the turret's quarter turn (about 2.2 s), well inside the first-shot delay
    expect(gun.shots).toBe(4);
  });

  it('holds while stunned, and a dying gun still lands its shell', () => {
    const { world, gun, jumper, run, now } = setup([house('east', 40, 0, { hp: 100_000 })]);
    jumper.movement.applyStatusEffect({ type: 'stun', value: 1, startTime: now(), duration: 3000 } as never);
    run(1000);
    expect(gun.yaw).toBe(0);
    run(SIEGE.firstShotMs + 2000);
    expect(gun.shots).toBe(1);
    expect(gun.shellMs).toBeGreaterThan(0);
    jumper.deadFlag = true;
    run(1000);
    expect(world.structures.hpList()).toEqual([100_000 - SIEGE.structureDamage]);
    expect(gun.shots).toBe(1);
  });

  it('comes to the same bits from a snapshot of its fields as on the run (wave snapshot, state hash)', () => {
    const digest = (gun: EnemyGun) => {
      const out: (number | string)[] = [];
      const sink: HashSink = { num: (v) => out.push(v), str: (v) => out.push(v) };
      gun.hashInto(sink);
      return out;
    };
    const a = setup([house('a', 40, 0, { hp: 100_000 }), house('b', -25, 20, { hp: 100_000 })]);
    a.run(SIEGE.firstShotMs + 1234);
    const saved = plainFields(a.gun);
    const b = setup([house('a', 40, 0, { hp: 100_000 }), house('b', -25, 20, { hp: 100_000 })]);
    b.run(SIEGE.firstShotMs + 1234);
    assignPlainFields(b.gun, saved);
    a.run(9000);
    b.run(9000);
    expect(digest(b.gun)).toEqual(digest(a.gun));
    expect(b.world.structures.hpList()).toEqual(a.world.structures.hpList());
  });
});
