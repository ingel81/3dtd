/**
 * HeroManager: the mercenary (docs/HERO.md).
 *
 * Unlocked by the research's global perk, hired once for HERO.cost, then
 * sent along the enemy routes by command. Every sub-step he walks his path,
 * keeps or picks the enemy furthest along its route within his range and
 * fires at it. At the spot he was sent to he holds: he stands while he has a
 * target, otherwise chases the enemy furthest along within reach, but never
 * more than HERO.leashM along the route from the spot, and walks back once
 * nothing is left. On his way to a new spot he shoots but does not stop.
 *
 * All of it in game time, one sub-step at a time, without a random number:
 * the same commands at the same sub-steps give the same hero at every
 * timescale. The route graph (utils/route-graph.ts) is a pure function of
 * the routes, the path of an order is computed inside the command.
 *
 * Framework-agnostic like the other managers. Routes, the enemy query, the
 * shot and the credits come in through `HeroWorld`.
 *
 * Emits `hero:state-changed` after every change the UI shows, `hero:rejected`
 * for a refused command and `hero:level-up`. His kills arrive as `hero:kill`
 * from the damage path.
 */

import { GameEventBus, IGameManager, SubscriptionBag } from '../game-engine';
import {
  HERO,
  HERO_AMMO,
  HeroAmmoConfig,
  HeroAmmoId,
  HeroDefenseProfile,
  HeroRejectReason,
  HeroStatus,
  heroDefenseProfile,
  heroLevelFor,
  heroMuzzleOffset,
  heroStatus,
} from '../configs/hero.config';
import type { ResearchEffect } from '../configs/research/research.types';
import type { GeoPosition } from '../models/game.types';
import type { Enemy } from '../entities/enemy.entity';
import { Hero } from '../entities/hero.entity';
import type { TransformRotationState } from '../game-components';
import { GraphPoint, RouteGraph } from '../utils/route-graph';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, geoDistanceFastSq } from '../utils/geo-utils';
import { ROUTE_BODY_AIM_HEIGHT_M } from '../utils/route-body';
import type { HeroBodyContact } from '../utils/hero-body-contact';

/** One shot of the hero, for HeroWorld.fire. */
export interface HeroShot {
  /** The muzzle: his position plus HERO.muzzle turned by his heading */
  origin: GeoPosition;
  /** Geo height of the muzzle */
  originHeight: number;
  target: Enemy;
  ammo: HeroAmmoConfig;
  /** Damage of this shot, his level included, before the damage matrix */
  damage: number;
  /**
   * Where the shot flies instead of the target's position: the nearest point
   * of a body along the route (the ooze), at the height shots at bodies aim;
   * null for any other target
   */
  aimPoint: GeoPosition | null;
}

/** What the manager needs from the world. */
export interface HeroWorld {
  /** Enemy routes by spawn id; the graph is rebuilt when the arrays change */
  routes(): ReadonlyMap<string, readonly GeoPosition[]>;
  /** The HQ; he is hired at the route point nearest to it */
  base(): GeoPosition | null;
  /** Living enemies within `radiusM` (2D) of `center`, ground and air, written into `out` */
  enemiesInRadius(center: GeoPosition, radiusM: number, out: Enemy[]): Enemy[];
  /**
   * The point of `enemy`'s body along the route (the ooze) nearest to `from`,
   * written into `out`; null for an enemy without a body or without a map to
   * measure on. Range, target, chase and aim use it instead of the enemy's
   * position, which is the body's tip.
   */
  bodyContact(enemy: Enemy, from: GeoPosition, out: HeroBodyContact): HeroBodyContact | null;
  /** Geo height of the ground under a position; places the muzzle, visual only */
  groundHeight(lat: number, lon: number): number;
  /** Launch a shot */
  fire(shot: HeroShot): void;
  /** Take credits; false when they are short */
  spend(cost: number): boolean;
}

/** The hero as the renderer shows him, once per rendered frame. */
export interface HeroPresentation {
  lat: number;
  lon: number;
  /** Heading in radians, TransformComponent's convention (scene rotation.y: 0 north, PI/2 west) */
  heading: number;
  /** 'run-shoot' while he fires on his way to a new spot */
  pose: 'idle' | 'run' | 'shoot' | 'run-shoot';
  /** The spot he holds */
  anchor: GeoPosition;
}

/** Where the manager shows the hero: HeroRenderer. */
export interface HeroView {
  present(hero: HeroPresentation): void;
  /** No hero any more (restart) */
  clear(): void;
}

/**
 * The hero for the wave-start snapshot (docs/SIMULATOR_PLAN.md, P4). Plain
 * data; `hired` is null until he is hired.
 */
export interface HeroSaveState {
  unlocked: boolean;
  ammo: HeroAmmoId;
  kills: number;
  level: number;
  hired: {
    lat: number;
    lon: number;
    height: number;
    rotation: TransformRotationState;
    cooldownMs: number;
    mode: 'travel' | 'hold';
    anchor: GraphPoint;
    goal: GraphPoint | null;
    replanMs: number;
    clockMs: number;
  } | null;
}

/** Closer than this to where he is going, he is there, metres. */
const ARRIVED_M = 0.5;

export class HeroManager implements IGameManager {
  private unlocked = false;
  private hero: Hero | null = null;
  private ammo: HeroAmmoId = 'standard';
  private kills = 0;
  private level = 1;
  private mode: 'travel' | 'hold' = 'hold';

  private graph: RouteGraph | null = null;
  /** The route arrays the graph was built from, to notice new ones */
  private readonly graphRoutes: (readonly GeoPosition[])[] = [];
  /** The spot he was sent to and holds */
  private anchor: GraphPoint | null = null;
  /** Where the path he follows ends, null while he stands */
  private goal: GraphPoint | null = null;
  /**
   * The last walkTo, when it found him standing on its goal: the graph, his
   * position and the goal it was asked with. walkTo reads nothing else, so
   * the same question has the same answer and is not asked again; holding
   * his post he re-plans every HERO.pursuitReplanMs, 300 times a real second
   * at 75x. Any other walkTo drops it.
   */
  private standing: { graph: RouteGraph; lat: number; lon: number; edge: number; t: number } | null = null;
  /** Game time until he next picks what to chase, while he holds without a target */
  private replanMs = 0;
  private target: Enemy | null = null;
  /** Game time since the hire, for the movement component's status lookups */
  private clockMs = 0;

  // Reused per query, see acquireTarget() and pickChase()
  private readonly scratch: Enemy[] = [];
  /** Shared scratch of HeroWorld.bodyContact: read right after it is written */
  private readonly contact: HeroBodyContact = { lat: 0, lon: 0, height: 0, distanceM: 0 };
  /** Squared metres from `from` to `enemy`: to the nearest point of a body along the route, else to its position */
  private readonly distanceSq = (enemy: Enemy, from: GeoPosition): number => {
    if (enemy.body) {
      const contact = this.world.bodyContact(enemy, from, this.contact);
      if (contact) return contact.distanceM * contact.distanceM;
    }
    return geoDistanceFastSq(from, enemy.position);
  };

  private view: HeroView | null = null;
  private readonly presentation: HeroPresentation = {
    lat: 0, lon: 0, heading: 0, pose: 'idle', anchor: { lat: 0, lon: 0 },
  };

  private readonly subs = new SubscriptionBag();

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly world: HeroWorld,
  ) {
    this.subs.add(this.eventBus.on('research:completed', (event) => {
      this.onResearchCompleted(event.effects);
    }));
    this.subs.add(this.eventBus.on('hero:kill', () => this.onKill()));
  }

  // ==================== Queries ====================

  getStatus(): HeroStatus {
    return heroStatus(this.unlocked, this.hero !== null, this.kills, this.ammo, this.mode);
  }

  /** The hero entity, null until hired. */
  getHero(): Hero | null {
    return this.hero;
  }

  /** The spot he was sent to and holds, null until hired. */
  getAnchor(): GeoPosition | null {
    return this.hero && this.anchor && this.graph ? this.graph.pointGeo(this.anchor) : null;
  }

  /** The enemy he is shooting at, null while none is in range. */
  getTarget(): Enemy | null {
    return this.target;
  }

  /** He follows a path (to an ordered spot, after an enemy or back). */
  isWalking(): boolean {
    return this.goal !== null;
  }

  /** The hero for the fairness gate (analyzeDefense), null until hired. */
  getDefenseProfile(): HeroDefenseProfile | null {
    return this.hero ? heroDefenseProfile(this.kills) : null;
  }

  /** Why a hire would be refused now, null when it would go through. hire() checks the credits on top. */
  checkHire(): HeroRejectReason | null {
    if (!this.unlocked) return 'locked';
    if (this.hero) return 'hired';
    return null;
  }

  /** Where a move order aimed at `target` would send him, or null when no route is within reach. */
  resolveMoveTarget(target: GeoPosition): GeoPosition | null {
    const graph = this.ensureGraph();
    const point = graph?.nearestPoint(target.lat, target.lon, HERO.orderSnapM);
    return graph && point ? graph.pointGeo(point) : null;
  }

  // ==================== Commands ====================

  /**
   * Hire him: the research is done, he is not hired yet, a route exists to
   * stand on, the credits are there. He appears on the route point nearest
   * to the HQ and holds there.
   *
   * @param price what the hire costs; the dev cheat (debug:ready-hero) passes 0
   */
  hire(price: number = HERO.cost): boolean {
    const refused = this.checkHire();
    if (refused) return this.reject(refused);
    const graph = this.ensureGraph();
    const base = this.world.base();
    const start = graph && base ? graph.nearestPoint(base.lat, base.lon) : null;
    if (!graph || !start) return this.reject('no-route');
    if (!this.world.spend(price)) return this.reject('credits');

    this.hero = new Hero(graph.pointGeo(start));
    this.anchor = { edge: start.edge, t: start.t };
    this.mode = 'hold';
    this.goal = null;
    this.replanMs = 0;
    this.target = null;
    this.clockMs = 0;
    this.applyStats();
    this.emitState();
    // Shown at once, like a placed tower: in a pause no sub-step runs, and
    // the frame's present only follows a sub-step
    this.presentFrame();
    return true;
  }

  /**
   * Send him to the route point nearest to `target` (within HERO.orderSnapM),
   * along the shortest way over the routes. That point becomes the spot he
   * holds.
   */
  moveTo(target: GeoPosition): boolean {
    if (!this.hero) return this.reject('no-hero');
    const graph = this.ensureGraph();
    const goal = graph?.nearestPoint(target.lat, target.lon, HERO.orderSnapM);
    if (!graph || !goal || !this.walkTo(graph, goal)) return this.reject('no-route');

    this.anchor = { edge: goal.edge, t: goal.t };
    this.mode = this.goal ? 'travel' : 'hold';
    this.replanMs = 0;
    this.emitState();
    // The post ring moves at once, in a pause too (see hire)
    this.presentFrame();
    return true;
  }

  /** Load `ammo`: his damage type, tracer and shot sound change with the next shot. */
  setAmmo(ammo: HeroAmmoId): boolean {
    if (!Object.prototype.hasOwnProperty.call(HERO_AMMO, ammo)) return this.reject('unknown-ammo');
    if (!this.hero) return this.reject('no-hero');
    if (ammo === this.ammo) return true;
    this.ammo = ammo;
    this.applyStats();
    this.emitState();
    return true;
  }

  // ==================== Rendering ====================

  /** Where he is shown (the engine's HeroRenderer), null headless. */
  setView(view: HeroView | null): void {
    this.view = view;
  }

  /**
   * He as the renderer shows him: position, heading, pose, the spot he
   * holds; null until hired. Filled into one object on every call, read it
   * before the next. presentFrame hands it on, the wave replay records it.
   */
  getPresentation(): Readonly<HeroPresentation> | null {
    const hero = this.hero;
    if (!hero) return null;
    const p = this.presentation;
    p.lat = hero.position.lat;
    p.lon = hero.position.lon;
    p.heading = hero.transform.rotation;
    if (this.target) p.pose = this.goal ? 'run-shoot' : 'shoot';
    else p.pose = this.goal ? 'run' : 'idle';
    p.anchor = this.getAnchor() ?? p.anchor;
    return p;
  }

  /**
   * Hand him to the renderer. Once per rendered frame after the sub-steps,
   * like EnemyManager.presentFrame, and right after a hire or a move order;
   * reads the simulation, changes nothing.
   */
  presentFrame(): void {
    if (!this.view) return;
    const p = this.getPresentation();
    if (p) this.view.present(p);
  }

  // ==================== Update Loop ====================

  /**
   * One sub-step: walk, pick a target, fire. Called once per gameplay
   * sub-step after the enemies moved (GameStateManager.runSubStep).
   */
  update(stepMs: number): void {
    const hero = this.hero;
    if (!hero) return;
    this.clockMs += stepMs;
    const graph = this.ensureGraph();
    // Heading smoothing and the fire cooldown
    hero.update(stepMs);

    const target = this.acquireTarget(hero);
    if (graph) {
      if (this.mode === 'travel') {
        this.step(graph, stepMs);
      } else if (target) {
        // Holding, he stands to shoot, and looks for the next chase once it is gone
        this.goal = null;
        this.replanMs = 0;
      } else {
        this.replanMs -= stepMs;
        if (this.replanMs <= 0) {
          this.replanMs = HERO.pursuitReplanMs;
          this.planLeash(graph);
        }
        this.step(graph, stepMs);
      }
    }

    if (target) {
      // A body along the route: he turns to and shoots at its nearest point
      const body = target.body ? this.world.bodyContact(target, hero.position, this.contact) : null;
      hero.transform.lookAt(body ?? target.position);
      if (hero.combat.canFire()) {
        this.fire(hero, target, body);
        hero.combat.fire();
      }
    }
  }

  /**
   * Holding without a target: after the enemy furthest along within reach
   * of the spot, as far as the leash goes, or back to the spot.
   */
  private planLeash(graph: RouteGraph): void {
    if (!this.anchor) return;
    const spot = graph.pointGeo(this.anchor);
    const chase = this.pickChase(spot);
    // After a body along the route: toward its point nearest to the spot
    const at = chase && ((chase.body && this.world.bodyContact(chase, spot, this.contact)) || chase.position);
    const goal = at
      ? graph.closestWithinReach(this.anchor, HERO.leashM, at.lat, at.lon)
      : this.anchor;
    this.walkTo(graph, goal);
  }

  /** Put him on the way to `goal`; false when no way leads there. Standing on it already is a way. */
  private walkTo(graph: RouteGraph, goal: GraphPoint): boolean {
    const hero = this.hero!;
    const { lat, lon } = hero.position;
    const s = this.standing;
    if (s && s.graph === graph && s.lat === lat && s.lon === lon && s.edge === goal.edge && s.t === goal.t) {
      this.goal = null;
      return true;
    }
    this.standing = null;
    const here = graph.nearestPoint(lat, lon);
    if (!here) return false;
    if (graph.straightDistance(here, goal) < ARRIVED_M) {
      this.goal = null;
      this.standing = { graph, lat, lon, edge: goal.edge, t: goal.t };
      return true;
    }
    const path = graph.shortestPath(here, goal);
    if (!path) return false;
    hero.movement.setPath(path.points);
    this.goal = path.points.length >= 2 ? { edge: goal.edge, t: goal.t } : null;
    return true;
  }

  /** One sub-step along the path; at its end he stands, and an order is carried out. */
  private step(graph: RouteGraph, stepMs: number): void {
    const hero = this.hero!;
    if (!this.goal) return;
    if (hero.movement.move(stepMs, this.clockMs, 1) !== 'reached_end') return;

    // The last step stops short of the end; put him on it
    const end = graph.pointGeo(this.goal);
    hero.transform.setPosition(end.lat, end.lon);
    this.goal = null;
    if (this.mode === 'travel') {
      this.mode = 'hold';
      this.replanMs = 0;
      this.emitState();
    }
  }

  /** Keep the current target while it lives and stays in range, else take the one furthest along. */
  private acquireTarget(hero: Hero): Enemy | null {
    const rangeSq = HERO.rangeM * HERO.rangeM;
    const current = this.target;
    if (current && current.alive && this.distanceSq(current, hero.position) <= rangeSq) {
      return current;
    }
    const candidates = this.world.enemiesInRadius(hero.position, HERO.rangeM, this.scratch);
    this.target = furthestAlong(candidates, hero.position, rangeSq, this.distanceSq);
    candidates.length = 0;
    return this.target;
  }

  /** The enemy to chase: the one furthest along within leash plus range of the spot. */
  private pickChase(spot: GeoPosition): Enemy | null {
    const reach = HERO.leashM + HERO.rangeM;
    const candidates = this.world.enemiesInRadius(spot, reach, this.scratch);
    const chase = furthestAlong(candidates, spot, reach * reach, this.distanceSq);
    candidates.length = 0;
    return chase;
  }

  /** @param body the nearest point of the target's body along the route, null for any other target */
  private fire(hero: Hero, target: Enemy, body: HeroBodyContact | null): void {
    const { lat, lon } = hero.position;
    const muzzle = heroMuzzleOffset(hero.transform.rotation);
    this.world.fire({
      origin: {
        lat: lat + muzzle.northM / METERS_PER_DEGREE_LAT,
        lon: lon + muzzle.eastM / (METERS_PER_DEGREE_LAT * Math.cos(lat * DEG_TO_RAD)),
      },
      originHeight: this.world.groundHeight(lat, lon) + HERO.muzzle.upM,
      target,
      ammo: HERO_AMMO[this.ammo],
      damage: hero.combat.damage,
      aimPoint: body ? { lat: body.lat, lon: body.lon, height: body.height + ROUTE_BODY_AIM_HEIGHT_M } : null,
    });
  }

  // ==================== Events ====================

  private onResearchCompleted(effects: readonly ResearchEffect[]): void {
    if (this.unlocked) return;
    if (!effects.some((e) => e.kind === 'global-perk' && e.perkId === HERO.perkId)) return;
    this.unlocked = true;
    this.emitState();
  }

  private onKill(): void {
    const hero = this.hero;
    if (!hero) return;
    this.kills++;
    hero.combat.kills = this.kills;
    const level = heroLevelFor(this.kills).level;
    if (level > this.level) {
      this.level = level;
      this.applyStats();
      this.eventBus.emit({ type: 'hero:level-up', level, position: { ...hero.position } });
    }
    this.emitState();
  }

  // ==================== Internals ====================

  /** The entity's combat stats follow ammo and level: fire rate for the cooldown, damage per shot. */
  private applyStats(): void {
    if (!this.hero) return;
    const ammo = HERO_AMMO[this.ammo];
    const combat = this.hero.combat;
    combat.fireRate = ammo.fireRate;
    combat.damage = ammo.damage * heroLevelFor(this.kills).damageMultiplier;
    combat.range = HERO.rangeM;
  }

  /**
   * The graph of the current routes, rebuilt when they changed, null while
   * there are none. A hero standing on an old graph is put on the new one.
   */
  private ensureGraph(): RouteGraph | null {
    const routes = this.world.routes();
    if (this.graph && this.sameRoutes(routes)) return this.graph.isEmpty ? null : this.graph;

    const anchorGeo = this.getAnchor();
    this.graph = RouteGraph.fromRoutes(routes);
    this.graphRoutes.length = 0;
    for (const route of routes.values()) this.graphRoutes.push(route);
    if (this.graph.isEmpty) return null;

    if (this.hero) {
      const graph = this.graph;
      const here = graph.nearestPoint(this.hero.position.lat, this.hero.position.lon)!;
      const at = graph.pointGeo(here);
      this.hero.transform.setPosition(at.lat, at.lon);
      this.anchor = (anchorGeo && graph.nearestPoint(anchorGeo.lat, anchorGeo.lon)) || here;
      this.goal = null;
      this.mode = 'hold';
      this.replanMs = 0;
      // Shown at once, like a hire or a move order: this can run from a query
      // (resolveMoveTarget) while the game is paused, where no sub-step
      // follows to present the new position.
      this.presentFrame();
    }
    return this.graph;
  }

  private sameRoutes(routes: ReadonlyMap<string, readonly GeoPosition[]>): boolean {
    if (routes.size !== this.graphRoutes.length) return false;
    let i = 0;
    for (const route of routes.values()) {
      if (route !== this.graphRoutes[i++]) return false;
    }
    return true;
  }

  private reject(reason: HeroRejectReason): false {
    this.eventBus.emit({ type: 'hero:rejected', reason });
    return false;
  }

  private emitState(restored = false): void {
    this.eventBus.emit({
      type: 'hero:state-changed',
      hero: this.getStatus(),
      ...(restored ? { restored: true as const } : {}),
    });
  }

  // ==================== Snapshot ====================

  /**
   * The hero for the wave-start snapshot. Taken between waves, where he has
   * no target. A hero on his way is put on a freshly planned path from where
   * he stands, the same one restoreState() plans: the path he walked is not
   * part of the snapshot, so the live game and the re-simulation both go on
   * from the new one.
   */
  captureState(): HeroSaveState {
    const hero = this.hero;
    const graph = hero ? this.ensureGraph() : null;
    if (hero && graph) this.replanToGoal(graph);
    return {
      unlocked: this.unlocked,
      ammo: this.ammo,
      kills: this.kills,
      level: this.level,
      hired: hero && this.anchor ? {
        lat: hero.position.lat,
        lon: hero.position.lon,
        height: hero.position.height ?? 0,
        rotation: hero.transform.getRotationState(),
        cooldownMs: hero.combat.cooldownRemaining,
        mode: this.mode,
        anchor: { edge: this.anchor.edge, t: this.anchor.t },
        goal: this.goal ? { edge: this.goal.edge, t: this.goal.t } : null,
        replanMs: this.replanMs,
        clockMs: this.clockMs,
      } : null,
    };
  }

  /** Put the hero back as captureState() found him, on the current routes. */
  restoreState(state: HeroSaveState): void {
    this.hero?.destroy();
    this.hero = null;
    this.standing = null;
    this.target = null;
    this.unlocked = state.unlocked;
    this.ammo = state.ammo;
    this.kills = state.kills;
    this.level = state.level;
    this.mode = 'hold';
    this.anchor = null;
    this.goal = null;
    this.replanMs = 0;
    this.clockMs = 0;

    const saved = state.hired;
    const graph = saved ? this.ensureGraph() : null;
    if (saved && graph) {
      const hero = new Hero({ lat: saved.lat, lon: saved.lon, height: saved.height });
      this.hero = hero;
      hero.transform.setRotationState(saved.rotation);
      hero.combat.kills = this.kills;
      hero.combat.restoreCooldown(saved.cooldownMs);
      this.anchor = { ...saved.anchor };
      this.goal = saved.goal ? { ...saved.goal } : null;
      this.mode = saved.mode;
      this.replanMs = saved.replanMs;
      this.clockMs = saved.clockMs;
      this.applyStats();
      this.replanToGoal(graph);
    } else {
      this.view?.clear();
    }
    // A baseline: no hire or ammo sound for a hero put back
    this.emitState(true);
    this.presentFrame();
  }

  /** On his way: a new path to the same goal from where he stands. See captureState. */
  private replanToGoal(graph: RouteGraph): void {
    this.standing = null;
    if (!this.goal) return;
    if (!this.walkTo(graph, this.goal)) this.goal = null;
    if (!this.goal && this.mode === 'travel') {
      this.mode = 'hold';
      this.replanMs = 0;
    }
  }

  // ==================== Lifecycle (IGameManager) ====================

  /** No-op: the world comes in through the constructor. */
  initialize(): void { /* nothing to do */ }

  reset(): void {
    this.hero?.destroy();
    this.hero = null;
    this.view?.clear();
    this.unlocked = false;
    this.ammo = 'standard';
    this.kills = 0;
    this.level = 1;
    this.mode = 'hold';
    this.graph = null;
    this.graphRoutes.length = 0;
    this.anchor = null;
    this.goal = null;
    this.standing = null;
    this.replanMs = 0;
    this.target = null;
    this.clockMs = 0;
  }

  destroy(): void {
    this.subs.disposeAll();
    this.reset();
  }
}

/**
 * The living enemy furthest along its route within `rangeSq` of `from`, the
 * first found on a tie. The same rule as a tower's 'first' targeting.
 */
function furthestAlong(
  candidates: readonly Enemy[],
  from: GeoPosition,
  rangeSq: number,
  distanceSq: (enemy: Enemy, from: GeoPosition) => number,
): Enemy | null {
  let best: Enemy | null = null;
  let bestProgress = -Infinity;
  for (const enemy of candidates) {
    if (!enemy.alive || distanceSq(enemy, from) > rangeSq) continue;
    const progress = enemy.movement.getPathProgress();
    if (progress > bestProgress) {
      best = enemy;
      bestProgress = progress;
    }
  }
  return best;
}
