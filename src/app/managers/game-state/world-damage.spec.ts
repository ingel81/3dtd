import { describe, expect, it, vi } from 'vitest';
import { WorldDamage, type WorldDamageHost } from './world-damage';
import { MAP_METERS_PER_DEGREE as K } from '../../world/custom-map/map-document';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';
import { ABILITY_DESTRUCTION, CRATERS, IMPACT_REACH_M, WEAR } from '../../configs/destruction.config';
import { runRulesOf, type RunStructure } from '../../sim/protocol/run-rules';
import type { StampField } from '../../utils/stamp-field';
import type { Tower } from '../../entities/tower.entity';
import type { Enemy } from '../../entities/enemy.entity';

/** A map point as map degrees */
const geo = (x: number, y: number) => ({ lat: y / K, lon: x / K });

function setup(structures: RunStructure[], destruction = { craters: true, wear: true }) {
  const ops: [string, ...unknown[]][] = [];
  const record = (path: string) => (...args: unknown[]) => ops.push([path, ...args]);
  const sink = {
    structures: { setStages: record('structures.setStages'), stage: record('structures.stage'), hp: record('structures.hp'), holes: record('structures.holes') },
    craters: { setAll: record('craters.setAll'), dig: record('craters.dig') },
    main: { structureFell: record('main.structureFell') },
  };
  const towers: Tower[] = [];
  const enemies: Enemy[] = [];
  let field: StampField | null = null;
  const host: WorldDamageHost = {
    sink: sink as never,
    toLocal: (lat, lon, out) => {
      out.x = -lon * K;
      out.z = lat * K;
    },
    routeSpan: () => ({ minIx: -100, minIz: -100, maxIx: 100, maxIz: 100 }),
    setField: (f) => (field = f),
    towers: () => towers,
    enemies: () => enemies,
    seeAround: vi.fn(),
  };
  const damage = new WorldDamage(host);
  damage.load(runRulesOf({ structures, destruction }));
  return { damage, ops, host, towers, enemies, field: () => field };
}

const house = (id: string, x: number, y: number, extra: Partial<RunStructure> = {}): RunStructure =>
  ({ id, ...geo(x, y), radius: 5, height: 8, hp: 300, ...extra });

describe('WorldDamage (docs/DESTRUCTION_PLAN.md)', () => {
  it("takes a projectile's structure damage in its splash reach and digs its crater, on the ground only", () => {
    const { damage, ops, field } = setup([house('a', 10, 0), house('b', 40, 0)]);
    const rocket = PROJECTILE_TYPES.rocket;
    damage.impact(geo(0, 0).lat, geo(0, 0).lon, rocket, true);
    expect(damage.structures.hpList()).toEqual([300, 300]);
    expect(damage.craters.size).toBe(0);
    expect(field()).toBeNull();
    damage.impact(geo(0, 0).lat, geo(0, 0).lon, rocket, false);
    // 10 m off: within its splash, its reach and the radius; 40 m off not
    expect(10).toBeLessThanOrEqual((rocket.splashRadius ?? 0) + IMPACT_REACH_M + 5);
    expect(damage.structures.hpList()).toEqual([300 - rocket.structureDamage, 300]);
    expect(Array.from(damage.craters.list())).toEqual([0, 0, 25, 35]);
    expect(field()!.heightAt(0.5, 0.5)).toBeLessThan(0);
    expect(ops.filter(([p]) => p === 'craters.dig')).toEqual([['craters.dig', 0, 0, 0, 25, 35]]);
    // An arrow takes nothing and digs nothing
    damage.impact(0, 0, PROJECTILE_TYPES.arrow, false);
    expect(damage.structures.hpList()[0]).toBe(300 - rocket.structureDamage);
  });

  it("sets off the destruction tool's blasts as the real ones and sets stages: worse by damage, mended without its rubble (E261)", () => {
    // The tool's rocket and nuke against the real impact and strike, on two worlds alike
    const a = setup([house('a', 10, 0), house('b', 40, 0)]);
    const b = setup([house('a', 10, 0), house('b', 40, 0)]);
    a.damage.debugBlast(geo(0, 0).lat, geo(0, 0).lon, 'rocket');
    b.damage.impact(geo(0, 0).lat, geo(0, 0).lon, PROJECTILE_TYPES.rocket, false);
    a.damage.debugBlast(geo(30, 0).lat, geo(30, 0).lon, 'nuclear-strike');
    b.damage.ability('nuclear-strike', geo(30, 0), 0, 0);
    expect(a.damage.structures.hpList()).toEqual(b.damage.structures.hpList());
    expect(Array.from(a.damage.craters.list())).toEqual(Array.from(b.damage.craters.list()));
    expect(a.ops).toEqual(b.ops);
    expect(a.damage.structures.hpList()).toEqual([0, 0]);

    // A house felled by the tool: its fall and rubble as by a hit; mended: no rubble, every stage out anew
    const { damage, ops, field, host } = setup([house('a', 0, 0), house('b', 40, 0)]);
    damage.debugSetStage(0, 3, geo(-3, 0).lat, geo(-3, 0).lon);
    expect(ops.filter(([p]) => p === 'structures.stage' || p === 'main.structureFell').map(([p]) => p)).toEqual(['structures.stage', 'main.structureFell']);
    expect(field()!.heightAt(0, 0)).toBeGreaterThan(0);
    const published = ops.filter(([p]) => p === 'structures.setStages').length;
    damage.debugSetStage(0, 0, geo(-3, 0).lat, geo(-3, 0).lon);
    expect(damage.structures.hpList()).toEqual([300, 300]);
    expect(field()).toBeNull();
    expect(ops.filter(([p]) => p === 'structures.setStages')).toHaveLength(published + 1);
    expect(host.seeAround).toHaveBeenCalledTimes(2);
    // To heavy damage; the HP go out with the flush
    damage.debugSetStage(1, 2, geo(40, 0).lat, geo(40, 0).lon);
    damage.flushHp();
    expect(ops.at(-1)).toEqual(['structures.hp', new Int32Array([1, 60])]);
    // The hit that took it there left a hole, on the side it came from (E259)
    expect(ops.at(-2)?.[0]).toBe('structures.holes');
  });

  it('fells everything in the nuke radius but a house with a tower on its roof, and digs its crater', () => {
    const { damage, towers, host } = setup([
      house('near', 10, 0),
      house('roofed', -12, 6, { roof: true, box: [-12, 6, 4, 4, 0] }),
      house('far', 80, 0),
    ]);
    towers.push({ position: { ...geo(-11, 7), height: 8 } } as Tower);
    damage.ability('nuclear-strike', { ...geo(0, 0), height: 0 }, 0, 0);
    expect(damage.structures.hpList()).toEqual([0, 300, 300]);
    expect(Array.from(damage.craters.entry(0))).toEqual([0, 0, 250, ABILITY_DESTRUCTION['nuclear-strike'].crater!.depthCm]);
    // The fall and the crater under the routes open the sight round them
    expect(host.seeAround).toHaveBeenCalledTimes(2);
    // Sold, the tower leaves the house to the next one
    towers.length = 0;
    damage.ability('nuclear-strike', { ...geo(0, 0), height: 0 }, 0, 0);
    expect(damage.structures.hpList()).toEqual([0, 0, 300]);
  });

  it('takes whole HP along a beam, as much over its sub-steps as over its whole burn', () => {
    const { damage } = setup([house('a', 0, 0, { hp: 3000 })]);
    const perSecond = ABILITY_DESTRUCTION['orbital-laser'].structureHpPerSecond!;
    const step = 1000 / 60;
    for (let k = 0; k < 60; k++) damage.ability('orbital-laser', { ...geo(0, 0), height: 0 }, k * step, (k + 1) * step);
    expect(damage.structures.hpList()).toEqual([3000 - perSecond]);
    // Frost and EMP leave the world as it was
    damage.ability('frost-bomb', { ...geo(0, 0), height: 0 }, 0, 0);
    damage.ability('emp', { ...geo(0, 0), height: 0 }, 0, 0);
    expect(damage.structures.hpList()).toEqual([3000 - perSecond]);
    expect(damage.craters.size).toBe(0);
  });

  it('wears what the enemies on the ground pass, once per interval, a boss more, where the map says so', () => {
    const { damage, enemies } = setup([house('a', 8, 0)]);
    const walker = (boss: boolean, air = false) => ({ alive: true, position: geo(0, 0), typeConfig: { isBoss: boss, isAirUnit: air } }) as unknown as Enemy;
    enemies.push(walker(false), walker(true), walker(false, true));
    damage.tick(16, 500);
    expect(damage.structures.hpList()).toEqual([300]);
    damage.tick(16, WEAR.intervalMs + 5);
    expect(damage.structures.hpList()).toEqual([300 - WEAR.hp - WEAR.bossHp]);
    // Off on a map without wear
    const plain = setup([house('a', 8, 0)], { craters: true, wear: false });
    plain.enemies.push(walker(true));
    plain.damage.tick(16, WEAR.intervalMs + 5);
    expect(plain.damage.structures.hpList()).toEqual([300]);
  });

  it('keeps a world without destruction empty: no field, no op, no crater', () => {
    const { damage, ops, field } = setup([], { craters: false, wear: false });
    damage.impact(0, 0, PROJECTILE_TYPES.rocket, false);
    damage.ability('nuclear-strike', { lat: 0, lon: 0, height: 0 }, 0, 0);
    damage.tick(16, WEAR.intervalMs + 5);
    damage.reset();
    damage.publish();
    expect([ops, field(), damage.craters.size, damage.captureCraters()]).toEqual([[], null, 0, undefined]);
  });

  it('with its list full of shell craters still digs a strike anywhere, in the place of the smallest, its ground and op with it', () => {
    const { damage, ops, field, host } = setup([]);
    // Shells along a route fill the list (one crater every 3 m)
    for (let i = 0; i < CRATERS.max; i++) damage.impact(geo(-90 + (i % 60) * 3, -90 + Math.floor(i / 60) * 3).lat, geo(-90 + (i % 60) * 3, 0).lon, PROJECTILE_TYPES.cannonball, false);
    expect(damage.craters.size).toBe(CRATERS.max);
    const before = field()!.heightAt(0.5, 60.5);
    const seen = vi.mocked(host.seeAround).mock.calls.length;
    // A strike far from all of them: it digs, in the place of crater 0, whose stamp leaves the field
    damage.ability('nuclear-strike', { ...geo(0, 60), height: 0 }, 0, 0);
    expect(Array.from(damage.craters.entry(0))).toEqual([0, 600, 250, ABILITY_DESTRUCTION['nuclear-strike'].crater!.depthCm]);
    expect(ops.at(-1)).toEqual(['craters.dig', 0, 0, 600, 250, ABILITY_DESTRUCTION['nuclear-strike'].crater!.depthCm]);
    expect(field()!.heightAt(0.5, 60.5)).toBeLessThan(before - 3);
    expect(field()!.heightAt(-89.5, -89.5)).toBe(0);
    expect(vi.mocked(host.seeAround).mock.calls.length).toBe(seen + 1);
    // From a snapshot: the same list and the same ground
    const list = damage.captureCraters();
    const heights = [field()!.heightAt(0.5, 60.5), field()!.heightAt(-86.5, -89.5)];
    damage.reset();
    damage.restore([], list);
    expect([field()!.heightAt(0.5, 60.5), field()!.heightAt(-86.5, -89.5)]).toEqual(heights);
  });

  it('lays the rubble of a fall and the craters into the field, and the same anew from a snapshot', () => {
    const { damage, field } = setup([house('a', 0, 20, { hp: 50 })]);
    expect(field()).toBeNull();
    damage.structures.hit(0, 20, 0, 50);
    expect(field()!.heightAt(0.5, 20.5)).toBeGreaterThan(1);
    damage.impact(geo(0, 0).lat, geo(0, 0).lon, PROJECTILE_TYPES.cannonball, false);
    const before = [field()!.heightAt(0.5, 20.5), field()!.heightAt(0.5, 0.5)];
    const hp = damage.structures.hpList();
    const craters = damage.captureCraters();
    damage.reset();
    expect(field()).toBeNull();
    damage.restore(hp, craters);
    expect([field()!.heightAt(0.5, 20.5), field()!.heightAt(0.5, 0.5)]).toEqual(before);
  });
});
