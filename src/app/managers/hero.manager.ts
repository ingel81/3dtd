/**
 * HeroManager: the mercenary (docs/HERO.md, PLAYER_AGENCY_CONCEPT.md 3.2).
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
  HeroRejectReason,
  HeroStatus,
  heroLevelFor,
  heroStatus,
} from '../configs/hero.config';
import type { ResearchEffect } from '../configs/research/research.types';
import type { GeoPosition } from '../models/game.types';
import type { Enemy } from '../entities/enemy.entity';
import { Hero } from '../entities/hero.entity';
import { GraphPoint, RouteGraph } from '../utils/route-graph';
import { geoDistanceFastSq } from '../utils/geo-utils';

/** One shot of the hero, for HeroWorld.fire. */
export interface HeroShot {
  /** Where he stands */
  origin: GeoPosition;
  /** Geo height of the muzzle */
  originHeight: number;
  target: Enemy;
  ammo: HeroAmmoConfig;
  /** Damage of this shot, his level included, before the damage matrix */
  damage: number;
}

/** What the manager needs from the world. */
export interface HeroWorld {
  /** Enemy routes by spawn id; the graph is rebuilt when the arrays change */
  routes(): ReadonlyMap<string, readonly GeoPosition[]>;
  /** The HQ; he is hired at the route point nearest to it */
  base(): GeoPosition | null;
  /** Living enemies within `radiusM` (2D) of `center`, ground and air, written into `out` */
  enemiesInRadius(center: GeoPosition, radiusM: number, out: Enemy[]): Enemy[];
  /** Geo height of the ground under a position; places the muzzle, visual only */
  groundHeight(lat: number, lon: number): number;
  /** Launch a shot */
  fire(shot: HeroShot): void;
  /** Take credits; false when they are short */
  spend(cost: number): boolean;
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
  /** Game time until he next picks what to chase, while he holds without a target */
  private replanMs = 0;
  private target: Enemy | null = null;
  /** Game time since the hire, for the movement component's status lookups */
  private clockMs = 0;

  // Reused per query, see acquireTarget() and pickChase()
  private readonly scratch: Enemy[] = [];

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
   */
  hire(): boolean {
    const refused = this.checkHire();
    if (refused) return this.reject(refused);
    const graph = this.ensureGraph();
    const base = this.world.base();
    const start = graph && base ? graph.nearestPoint(base.lat, base.lon) : null;
    if (!graph || !start) return this.reject('no-route');
    if (!this.world.spend(HERO.cost)) return this.reject('credits');

    this.hero = new Hero(graph.pointGeo(start));
    this.anchor = { edge: start.edge, t: start.t };
    this.mode = 'hold';
    this.goal = null;
    this.replanMs = 0;
    this.target = null;
    this.clockMs = 0;
    this.applyStats();
    this.emitState();
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
    return true;
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
      hero.transform.lookAt(target.position);
      if (hero.combat.canFire()) {
        this.fire(hero, target);
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
    const chase = this.pickChase(graph.pointGeo(this.anchor));
    const goal = chase
      ? graph.closestWithinReach(this.anchor, HERO.leashM, chase.position.lat, chase.position.lon)
      : this.anchor;
    this.walkTo(graph, goal);
  }

  /** Put him on the way to `goal`; false when no way leads there. Standing on it already is a way. */
  private walkTo(graph: RouteGraph, goal: GraphPoint): boolean {
    const hero = this.hero!;
    const here = graph.nearestPoint(hero.position.lat, hero.position.lon);
    if (!here) return false;
    if (graph.straightDistance(here, goal) < ARRIVED_M) {
      this.goal = null;
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
    if (current && current.alive && geoDistanceFastSq(hero.position, current.position) <= rangeSq) {
      return current;
    }
    const candidates = this.world.enemiesInRadius(hero.position, HERO.rangeM, this.scratch);
    this.target = furthestAlong(candidates, hero.position, rangeSq);
    candidates.length = 0;
    return this.target;
  }

  /** The enemy to chase: the one furthest along within leash plus range of the spot. */
  private pickChase(spot: GeoPosition): Enemy | null {
    const reach = HERO.leashM + HERO.rangeM;
    const candidates = this.world.enemiesInRadius(spot, reach, this.scratch);
    const chase = furthestAlong(candidates, spot, reach * reach);
    candidates.length = 0;
    return chase;
  }

  private fire(hero: Hero, target: Enemy): void {
    const { lat, lon } = hero.position;
    this.world.fire({
      origin: { lat, lon },
      originHeight: this.world.groundHeight(lat, lon) + HERO.shotHeightM,
      target,
      ammo: HERO_AMMO[this.ammo],
      damage: hero.combat.damage,
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

  private emitState(): void {
    this.eventBus.emit({ type: 'hero:state-changed', hero: this.getStatus() });
  }

  // ==================== Lifecycle (IGameManager) ====================

  /** No-op: the world comes in through the constructor. */
  initialize(): void { /* nothing to do */ }

  reset(): void {
    this.hero?.destroy();
    this.hero = null;
    this.unlocked = false;
    this.ammo = 'standard';
    this.kills = 0;
    this.level = 1;
    this.mode = 'hold';
    this.graph = null;
    this.graphRoutes.length = 0;
    this.anchor = null;
    this.goal = null;
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
function furthestAlong(candidates: readonly Enemy[], from: GeoPosition, rangeSq: number): Enemy | null {
  let best: Enemy | null = null;
  let bestProgress = -Infinity;
  for (const enemy of candidates) {
    if (!enemy.alive || geoDistanceFastSq(from, enemy.position) > rangeSq) continue;
    const progress = enemy.movement.getPathProgress();
    if (progress > bestProgress) {
      best = enemy;
      bestProgress = progress;
    }
  }
  return best;
}
