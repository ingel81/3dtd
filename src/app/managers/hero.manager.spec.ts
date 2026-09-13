import { describe, it, expect, beforeEach } from 'vitest';
import { HeroManager, type HeroShot, type HeroWorld } from './hero.manager';
import { GameEventBus, type GameEvent } from '../game-engine/game-event-bus';
import { HERO, HERO_AMMO } from '../configs/hero.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;
const LAT0 = 48.7758;
const LON0 = 9.1829;
const COS = Math.cos(LAT0 * DEG_TO_RAD);

/** Geo position `x` metres east and `z` metres north of the origin. */
const at = (x: number, z: number): GeoPosition => ({
  lat: LAT0 + z / METERS_PER_DEGREE_LAT,
  lon: LON0 + x / (METERS_PER_DEGREE_LAT * COS),
});
/** Metres east and north of the origin, rounded to decimetres. */
const local = (p: GeoPosition) => ({
  x: Math.round((p.lon - LON0) * METERS_PER_DEGREE_LAT * COS * 10) / 10,
  z: Math.round((p.lat - LAT0) * METERS_PER_DEGREE_LAT * 10) / 10,
});
const line = (...points: [number, number][]): GeoPosition[] => points.map(([x, z]) => at(x, z));

/**
 * Two spawns: south at (0, 0), west at (-150, 150). They join at (0, 150)
 * and run north to the HQ at (0, 300).
 */
const ROUTES = new Map([
  ['spawn-south', line([0, 0], [0, 50], [0, 100], [0, 150], [0, 200], [0, 250], [0, 300])],
  ['spawn-west', line([-150, 150], [-100, 150], [-50, 150], [0, 150], [0, 200], [0, 250], [0, 300])],
]);
const HQ = at(0, 300);

interface FakeEnemy {
  id: string;
  alive: boolean;
  position: GeoPosition;
  progress: number;
  movement: { getPathProgress(): number };
}

function enemyAt(id: string, x: number, z: number, progress = 0.5): FakeEnemy {
  const enemy: FakeEnemy = {
    id,
    alive: true,
    position: at(x, z),
    progress,
    movement: { getPathProgress: () => enemy.progress },
  };
  return enemy;
}

function distanceM(a: GeoPosition, b: GeoPosition): number {
  const p = local(a);
  const q = local(b);
  return Math.hypot(p.x - q.x, p.z - q.z);
}

describe('HeroManager', () => {
  let bus: GameEventBus;
  let manager: HeroManager;
  let credits: number;
  let enemies: FakeEnemy[];
  let shots: HeroShot[];
  let events: GameEvent[];

  const unlock = () =>
    bus.emit({
      type: 'research:completed',
      researchId: HERO.researchId,
      effects: [{ kind: 'global-perk', perkId: HERO.perkId, description: '' }],
    });
  const tick = (steps: number) => {
    for (let i = 0; i < steps; i++) manager.update(STEP_MS);
  };
  const heroAt = () => local(manager.getHero()!.position);
  const hired = () => {
    unlock();
    credits = HERO.cost;
    expect(manager.hire()).toBe(true);
  };
  /** Order him to (x, z) and walk until he holds there. */
  const sendTo = (x: number, z: number) => {
    expect(manager.moveTo(at(x, z))).toBe(true);
    for (let i = 0; i < 10_000 && manager.getStatus().mode === 'travel'; i++) tick(1);
  };

  beforeEach(() => {
    bus = new GameEventBus();
    credits = 0;
    enemies = [];
    shots = [];
    events = [];
    bus.onAny((event) => events.push(event));
    const world: HeroWorld = {
      routes: () => ROUTES,
      base: () => HQ,
      enemiesInRadius: (center, radiusM, out) => {
        out.length = 0;
        for (const e of enemies) {
          if (e.alive && distanceM(center, e.position) <= radiusM) out.push(e as unknown as Enemy);
        }
        return out;
      },
      groundHeight: () => 100,
      fire: (shot) => shots.push(shot),
      spend: (cost) => {
        if (credits < cost) return false;
        credits -= cost;
        return true;
      },
    };
    manager = new HeroManager(bus, world);
  });

  describe('hiring', () => {
    it('is locked until the research completes, then unlocked', () => {
      expect(manager.getStatus()).toMatchObject({ unlocked: false, hired: false });
      credits = HERO.cost;
      expect(manager.hire()).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'hero:rejected', reason: 'locked' });
      expect(credits).toBe(HERO.cost);

      unlock();
      expect(manager.getStatus().unlocked).toBe(true);
      expect(events.at(-1)).toMatchObject({ type: 'hero:state-changed', hero: { unlocked: true, hired: false } });
    });

    it('costs the price once and puts him on the route next to the HQ', () => {
      unlock();
      credits = HERO.cost - 1;
      expect(manager.hire()).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'hero:rejected', reason: 'credits' });
      expect(manager.getHero()).toBeNull();

      credits = HERO.cost + 50;
      expect(manager.hire()).toBe(true);
      expect(credits).toBe(50);
      expect(heroAt()).toEqual({ x: 0, z: 300 });
      expect(manager.getStatus()).toMatchObject({ hired: true, level: 1, kills: 0, mode: 'hold' });

      expect(manager.hire()).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'hero:rejected', reason: 'hired' });
      expect(credits).toBe(50);
    });

    it('refuses a move order before the hire', () => {
      expect(manager.moveTo(at(0, 100))).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'hero:rejected', reason: 'no-hero' });
    });
  });

  describe('moving', () => {
    beforeEach(hired);

    it('walks along the routes, round the junction, at his speed', () => {
      expect(manager.moveTo(at(-100, 152))).toBe(true); // 2 m off the west street
      expect(manager.getStatus().mode).toBe('travel');
      expect(local(manager.getAnchor()!)).toEqual({ x: -100, z: 150 });

      // 150 m south to the junction, 100 m west: 250 m at 8 m/s, about 1875
      // sub-steps. The movement measures on the sphere, the graph on the flat
      // projection, 0.1% apart: a few steps of slack either way
      const steps = Math.ceil(250 / HERO.speedMps / (STEP_MS / 1000));
      const trace: { x: number; z: number }[] = [];
      for (let i = 0; i < steps - 10; i++) {
        tick(1);
        trace.push(heroAt());
      }
      expect(manager.getStatus().mode).toBe('travel');
      // Always on one of the two streets, never across the corner
      for (const p of trace) expect(Math.abs(p.x) < 0.2 || Math.abs(p.z - 150) < 0.2).toBe(true);

      tick(20);
      expect(manager.getStatus().mode).toBe('hold');
      expect(heroAt()).toEqual({ x: -100, z: 150 });
      expect(events.at(-1)).toMatchObject({ type: 'hero:state-changed', hero: { mode: 'hold' } });
    });

    it('refuses a spot farther than 30 m from any route and keeps his post', () => {
      expect(manager.moveTo(at(40, 100))).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'hero:rejected', reason: 'no-route' });
      expect(local(manager.getAnchor()!)).toEqual({ x: 0, z: 300 });
      expect(manager.resolveMoveTarget(at(40, 100))).toBeNull();
      expect(local(manager.resolveMoveTarget(at(25, 100))!)).toEqual({ x: 0, z: 100 });
    });

    it('takes a new order on the way', () => {
      manager.moveTo(at(0, 100));
      tick(300); // 40 m
      expect(heroAt()).toEqual({ x: 0, z: 260 });
      sendTo(0, 280);
      expect(heroAt()).toEqual({ x: 0, z: 280 });
    });

    it('walks the same way to the same point every time', () => {
      const run = () => {
        manager.reset();
        hired();
        manager.moveTo(at(-150, 150));
        const trace: { x: number; z: number }[] = [];
        for (let i = 0; i < 1000; i++) {
          tick(1);
          if (i % 50 === 0) trace.push(heroAt());
        }
        return trace;
      };
      expect(run()).toEqual(run());
    });
  });

  describe('fighting', () => {
    beforeEach(hired);

    it('fires at the enemy furthest along within 18 m, three shots a second', () => {
      const near = enemyAt('near', 0, 290, 0.3);
      const ahead = enemyAt('ahead', 0, 285, 0.6);
      const far = enemyAt('far', 0, 270, 0.9); // 30 m, out of range
      enemies.push(near, ahead, far);
      tick(120); // 2 s

      expect(shots).toHaveLength(6);
      for (const shot of shots) {
        expect(shot.target).toBe(ahead);
        expect(shot.ammo).toBe(HERO_AMMO.standard);
        expect(shot.damage).toBe(HERO_AMMO.standard.damage);
        expect(shot.originHeight).toBe(100 + HERO.shotHeightM);
      }
      expect(manager.getTarget()).toBe(ahead as unknown as Enemy);
    });

    it('keeps his target while it lives and stays in range', () => {
      const first = enemyAt('first', 0, 290, 0.3);
      enemies.push(first);
      tick(1);
      enemies.push(enemyAt('later', 0, 288, 0.8));
      tick(40);
      expect(shots.every((s) => s.target === (first as unknown as Enemy))).toBe(true);

      first.alive = false;
      tick(40);
      expect(shots.at(-1)!.target.id).toBe('later');
    });

    it('shoots on the way to an ordered spot without stopping', () => {
      manager.moveTo(at(0, 100));
      enemies.push(enemyAt('passing', 5, 280, 0.5));
      tick(60); // 1 s, 8 m
      expect(shots.length).toBeGreaterThan(0);
      expect(heroAt().z).toBeCloseTo(292, 0);
      expect(manager.getStatus().mode).toBe('travel');
    });

    it('stands still while he has a target at his post', () => {
      const target = enemyAt('close', 0, 290, 0.5);
      enemies.push(target);
      tick(100);
      expect(heroAt()).toEqual({ x: 0, z: 300 });
      expect(shots.length).toBeGreaterThan(0);
    });
  });

  describe('leash', () => {
    beforeEach(() => {
      hired();
      sendTo(0, 150); // the junction
      shots.length = 0;
    });

    it('chases an enemy out of range up to 20 m along the route, no farther', () => {
      // 36 m from his post, beside the route: in reach of a chase, never of a shot
      enemies.push(enemyAt('beside', 30, 130, 0.5));
      let farthest = 0;
      for (let i = 0; i < 600; i++) {
        tick(1);
        farthest = Math.max(farthest, distanceM(manager.getHero()!.position, at(0, 150)));
      }
      expect(heroAt()).toEqual({ x: 0, z: 130 });
      expect(farthest).toBeLessThanOrEqual(HERO.leashM + 0.1);
      expect(shots).toHaveLength(0);
    });

    it('walks back to his post once nothing is left to chase', () => {
      const runner = enemyAt('runner', 30, 130, 0.5);
      enemies.push(runner);
      tick(600);
      expect(heroAt()).toEqual({ x: 0, z: 130 });

      runner.alive = false;
      tick(600);
      expect(heroAt()).toEqual({ x: 0, z: 150 });
    });

    it('stops as soon as the chased enemy comes into range and fires', () => {
      // 35 m south of the post, on the route: in range once he is 17 m out
      enemies.push(enemyAt('coming', 0, 115, 0.5));
      tick(600);
      expect(heroAt().z).toBeGreaterThanOrEqual(115 + HERO.rangeM - 0.2);
      expect(heroAt().z).toBeLessThan(150);
      expect(shots.length).toBeGreaterThan(0);
    });

    it('ignores enemies beyond leash plus range', () => {
      enemies.push(enemyAt('distant', 0, 100, 0.5)); // 50 m
      tick(300);
      expect(heroAt()).toEqual({ x: 0, z: 150 });
      expect(shots).toHaveLength(0);
    });

    it('measures the leash along the route: round the corner, not across it', () => {
      // West of the junction and a little south: nearest route point in a
      // straight line would be on the south street, the chase stays on the
      // streets and never leaves 20 m of route from the post
      enemies.push(enemyAt('corner', -30, 140, 0.5));
      for (let i = 0; i < 600; i++) {
        tick(1);
        const p = heroAt();
        expect(Math.abs(p.x) < 0.2 || Math.abs(p.z - 150) < 0.2).toBe(true);
        expect(Math.abs(p.x) + Math.abs(p.z - 150)).toBeLessThanOrEqual(HERO.leashM + 0.2);
      }
    });
  });

  describe('levels', () => {
    beforeEach(hired);

    const kill = (n: number) => {
      for (let i = 0; i < n; i++) bus.emit({ type: 'hero:kill', enemy: {} as Enemy });
    };

    it('counts kills and levels up at the thresholds', () => {
      kill(29);
      expect(manager.getStatus()).toMatchObject({ level: 1, kills: 29, xp: 29, xpToNext: 30 });
      kill(1);
      expect(manager.getStatus()).toMatchObject({ level: 2, kills: 30, xp: 0, xpToNext: 70 });
      expect(events.filter((e) => e.type === 'hero:level-up')).toEqual([
        expect.objectContaining({ type: 'hero:level-up', level: 2 }),
      ]);
      kill(470);
      expect(manager.getStatus()).toMatchObject({ level: 5, kills: 500, xpToNext: null });
    });

    it('hits harder with every level', () => {
      kill(30);
      enemies.push(enemyAt('target', 0, 290));
      tick(1);
      expect(shots[0].damage).toBeCloseTo(HERO_AMMO.standard.damage * 1.15, 6);
    });

    it('counts no kills before the hire', () => {
      manager.reset();
      kill(5);
      expect(manager.getStatus().kills).toBe(0);
    });
  });

  it('starts over on reset: gone, locked, no kills', () => {
    hired();
    bus.emit({ type: 'hero:kill', enemy: {} as Enemy });
    manager.reset();
    expect(manager.getHero()).toBeNull();
    expect(manager.getStatus()).toMatchObject({ unlocked: false, hired: false, kills: 0, level: 1 });
  });

  it('puts him back on the route when the routes change under him', () => {
    hired();
    sendTo(0, 200);
    const shifted = new Map([['spawn-south', line([10, 0], [10, 150], [10, 300])]]);
    (manager as unknown as { world: HeroWorld }).world.routes = () => shifted;
    tick(1);
    expect(heroAt()).toEqual({ x: 10, z: 200 });
    expect(local(manager.getAnchor()!)).toEqual({ x: 10, z: 200 });
  });
});
