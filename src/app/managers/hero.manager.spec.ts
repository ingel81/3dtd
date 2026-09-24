import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HeroManager, type HeroShot, type HeroWorld } from './hero.manager';
import { RouteGraph } from '../utils/route-graph';
import { GameEventBus, type GameEvent } from '../game-engine/game-event-bus';
import { HERO, HERO_AMMO } from '../configs/hero.config';
import { ROUTE_BODY_AIM_HEIGHT_M } from '../utils/route-body';
import { at, local, line } from '../../test/geo-test-points';
import type { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;

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
  /** A body along the x = 0 street from tailZ to its tip at tipZ (the ooze) */
  body?: { tailZ: number; tipZ: number };
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

/** An ooze on the x = 0 street, its position at the tip as in the game. */
function oozeAt(id: string, tailZ: number, tipZ: number): FakeEnemy {
  return { ...enemyAt(id, 0, tipZ, 0.7), body: { tailZ, tipZ } };
}

function distanceM(a: GeoPosition, b: GeoPosition): number {
  const p = local(a);
  const q = local(b);
  return Math.hypot(p.x - q.x, p.z - q.z);
}

/** The point of a fake body nearest to `from`, and how far it is. */
function nearestOnBody(body: { tailZ: number; tipZ: number }, from: GeoPosition): { z: number; distance: number } {
  const p = local(from);
  const z = Math.min(Math.max(p.z, body.tailZ), body.tipZ);
  return { z, distance: Math.hypot(p.x, p.z - z) };
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
          // Like the route grid: a body is in the circle once any of it is
          const d = e.body ? nearestOnBody(e.body, center).distance : distanceM(center, e.position);
          if (e.alive && d <= radiusM) out.push(e as unknown as Enemy);
        }
        return out;
      },
      bodyContact: (enemy, from, out) => {
        const body = (enemy as unknown as FakeEnemy).body;
        if (!body) return null;
        const nearest = nearestOnBody(body, from);
        const point = at(0, nearest.z);
        out.lat = point.lat;
        out.lon = point.lon;
        out.height = 100;
        out.distanceM = nearest.distance;
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
        expect(shot.originHeight).toBe(100 + HERO.muzzle.upM);
      }
      // Facing south at the HQ: the muzzle ahead of him and to his right, west
      expect(local(shots.at(-1)!.origin)).toEqual({ x: -0.4, z: 297.6 });
      expect(manager.getTarget()).toBe(ahead as unknown as Enemy);
    });

    it('shoots the ooze where its body passes him, though its tip is out of range, at its nearest point', () => {
      sendTo(0, 200);
      shots.length = 0;
      const ooze = oozeAt('ooze', 150, 260); // tip 60 m ahead, the body under his feet
      enemies.push(ooze);
      tick(60); // 1 s
      expect(shots.length).toBeGreaterThan(0);
      for (const shot of shots) {
        expect(shot.target).toBe(ooze);
        expect(local(shot.aimPoint!)).toEqual({ x: 0, z: 200 });
        expect(shot.aimPoint!.height).toBe(100 + ROUTE_BODY_AIM_HEIGHT_M);
      }
    });

    it('chases the nearest point of the body as far as his leash, then shoots at it', () => {
      sendTo(0, 200);
      shots.length = 0;
      enemies.push(oozeAt('ooze', 225, 260)); // 25 m to the tail: out of range, within leash plus range
      tick(120); // 2 s
      expect(heroAt().z).toBeGreaterThan(200);
      expect(heroAt().z).toBeLessThanOrEqual(220);
      expect(shots.length).toBeGreaterThan(0);
      expect(local(shots.at(-1)!.aimPoint!)).toEqual({ x: 0, z: 225 });
    });

    it('leaves an ooze out of reach alone, and shots at other enemies carry no aim point', () => {
      sendTo(0, 200);
      shots.length = 0;
      enemies.push(oozeAt('ooze', 245, 260)); // 45 m to the tail, past leash plus range
      tick(60);
      expect(shots).toHaveLength(0);
      expect(heroAt()).toEqual({ x: 0, z: 200 });

      enemies.push(enemyAt('zombie', 0, 190));
      tick(60);
      expect(shots.length).toBeGreaterThan(0);
      expect(shots.every((shot) => shot.aimPoint === null)).toBe(true);
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

    it('looks the route up once while he stands at his post, and again only after he moved', () => {
      const lookups = vi.spyOn(RouteGraph.prototype, 'nearestPoint');
      tick(600); // 10 s at the junction: forty re-plans
      expect(lookups).toHaveBeenCalledTimes(1);
      expect(heroAt()).toEqual({ x: 0, z: 150 });

      // A chase moves him: he looks again, comes back and stands again
      const runner = enemyAt('runner', 30, 130, 0.5);
      enemies.push(runner);
      tick(600);
      expect(heroAt()).toEqual({ x: 0, z: 130 });
      runner.alive = false;
      tick(600);
      expect(heroAt()).toEqual({ x: 0, z: 150 });
      const settled = lookups.mock.calls.length;
      expect(settled).toBeGreaterThan(1);
      tick(600);
      expect(lookups).toHaveBeenCalledTimes(settled);
      lookups.mockRestore();
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

  describe('ammo', () => {
    beforeEach(hired);

    it('switches his damage type, projectile and rate with the ammo', () => {
      enemies.push(enemyAt('target', 0, 290));
      expect(manager.setAmmo('explosive')).toBe(true);
      expect(manager.getStatus().ammo).toBe('explosive');
      expect(events.at(-1)).toMatchObject({ type: 'hero:state-changed', hero: { ammo: 'explosive' } });

      tick(120); // 2 s at 1.5 shots a second
      expect(shots).toHaveLength(3);
      expect(shots[0].ammo).toBe(HERO_AMMO.explosive);
      expect(shots[0].ammo.damageType).toBe('siege');
      expect(shots[0].ammo.projectileType).toBe('hero-shell');
      expect(shots[0].damage).toBe(HERO_AMMO.explosive.damage);

      manager.setAmmo('rune');
      shots.length = 0;
      tick(120); // 2 s at 2 shots a second, the explosive cooldown runs out first
      expect(shots.every((s) => s.ammo.damageType === 'magic')).toBe(true);
      expect(shots.length).toBeGreaterThanOrEqual(3);
    });

    it('keeps his level bonus across ammo', () => {
      for (let i = 0; i < 30; i++) bus.emit({ type: 'hero:kill', enemy: {} as Enemy });
      manager.setAmmo('rune');
      enemies.push(enemyAt('target', 0, 290));
      tick(1);
      expect(shots[0].damage).toBeCloseTo(HERO_AMMO.rune.damage * 1.15, 6);
    });

    it('refuses an unknown ammo and a switch before the hire', () => {
      expect(manager.setAmmo('laser' as never)).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'hero:rejected', reason: 'unknown-ammo' });
      manager.reset();
      expect(manager.setAmmo('rune')).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'hero:rejected', reason: 'no-hero' });
    });

    it('starts the next run with standard rounds', () => {
      manager.setAmmo('explosive');
      manager.reset();
      expect(manager.getStatus().ammo).toBe('standard');
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

  describe('rendering', () => {
    it('hands the renderer where he stands, where he looks, what he does and his post', () => {
      const shown: { pose: string; x: number; z: number; post: { x: number; z: number } }[] = [];
      let cleared = 0;
      manager.setView({
        present: (h) => shown.push({ pose: h.pose, ...local(h), post: local(h.anchor) }),
        clear: () => cleared++,
      });
      manager.presentFrame();
      expect(shown).toHaveLength(0); // not hired

      hired();
      manager.presentFrame();
      expect(shown.at(-1)).toEqual({ pose: 'idle', x: 0, z: 300, post: { x: 0, z: 300 } });

      manager.moveTo(at(0, 200));
      tick(10);
      manager.presentFrame();
      expect(shown.at(-1)).toMatchObject({ pose: 'run', post: { x: 0, z: 200 } });

      enemies.push(enemyAt('close', 0, 285));
      tick(1);
      manager.presentFrame();
      expect(shown.at(-1)!.pose).toBe('run-shoot'); // fires on his way

      enemies.length = 0;
      tick(800); // at his post
      enemies.push(enemyAt('at-post', 0, 195));
      tick(1);
      manager.presentFrame();
      expect(shown.at(-1)).toMatchObject({ pose: 'shoot', x: 0, z: 200 });

      manager.reset();
      expect(cleared).toBe(1);
    });

    it('shows him with the hire and his new post with a move order, before any sub-step (a pause)', () => {
      const shown: { x: number; z: number; post: { x: number; z: number } }[] = [];
      manager.setView({ present: (h) => shown.push({ ...local(h), post: local(h.anchor) }), clear: () => undefined });

      hired();
      expect(shown).toEqual([{ x: 0, z: 300, post: { x: 0, z: 300 } }]);

      expect(manager.moveTo(at(0, 200))).toBe(true);
      expect(shown).toHaveLength(2);
      expect(shown.at(-1)).toEqual({ x: 0, z: 300, post: { x: 0, z: 200 } });

      expect(manager.moveTo(at(40, 100))).toBe(false); // refused: nothing to show
      expect(shown).toHaveLength(2);
    });

    it('presents the frame when the routes shift under him without a sub-step, a pause too', () => {
      const shown: { x: number; z: number }[] = [];
      manager.setView({ present: (h) => shown.push(local(h)), clear: () => undefined });
      hired();
      sendTo(0, 200);
      shown.length = 0;

      const shifted = new Map([['spawn-south', line([10, 0], [10, 150], [10, 300])]]);
      (manager as unknown as { world: HeroWorld }).world.routes = () => shifted;
      // A query only, no update()/tick(): a corridor rebuild replacing the
      // routes while paused must still show him on the new graph at once,
      // since no sub-step follows to present it.
      manager.resolveMoveTarget(at(10, 100));

      expect(shown).toEqual([{ x: 10, z: 200 }]);
    });

    it('gives the same presentation without a renderer (the wave replay records it), none before the hire', () => {
      expect(manager.getPresentation()).toBeNull();
      hired();
      const p = manager.getPresentation()!;
      expect({ pose: p.pose, ...local(p) }).toEqual({ pose: 'idle', x: 0, z: 300 });
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
  describe('snapshot', () => {
    /** A second manager on the same world, as a re-simulation gets it */
    const twin = () => new HeroManager(new GameEventBus(), (manager as unknown as { world: HeroWorld }).world);
    const trail = (m: HeroManager, steps: number) => {
      const out: string[] = [];
      for (let i = 0; i < steps; i++) {
        m.update(STEP_MS);
        const p = m.getHero()!.position;
        out.push(`${p.lat},${p.lon},${m.getHero()!.transform.rotation}`);
      }
      return out;
    };

    it('goes on bit for bit the same from a restored state, also on his way somewhere', () => {
      hired();
      sendTo(-100, 150);
      expect(manager.moveTo(at(0, 250))).toBe(true);
      tick(90);
      expect(manager.isWalking()).toBe(true);

      const state = manager.captureState();
      const copy = twin();
      copy.restoreState(JSON.parse(JSON.stringify(state)));

      expect(copy.getStatus()).toEqual(manager.getStatus());
      expect(trail(copy, 900)).toEqual(trail(manager, 900));
      expect(copy.captureState()).toEqual(manager.captureState());
    });

    it('restores a hero not hired yet as none', () => {
      unlock();
      const copy = twin();
      copy.restoreState(manager.captureState());
      expect(copy.getHero()).toBeNull();
      expect(copy.getStatus()).toEqual(manager.getStatus());
    });
  });
});
