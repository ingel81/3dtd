import { Injectable, inject } from '@angular/core';
import { PathAndRouteService } from './world/path-route.service';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { RouteGraph } from '../utils/route-graph';
import { routeSweepToward, type RouteSweep } from '../utils/route-sweep';
import { ABILITIES, abilityBeamReachM, type AbilityId } from '../configs/abilities.config';
import { HERO } from '../configs/hero.config';
import type { GeoPosition } from '../models/game.types';

/**
 * Where an order would land, asked while the pointer moves (docs/SIM_WORKER.md):
 * the same rules the simulation applies to the command (AbilityManager
 * resolveTarget and previewSweep, HeroManager.resolveMoveTarget), run on the
 * main thread's routes (PathAndRouteService) and grid. The simulation
 * snaps the command again and has the last word; this only previews it.
 */
@Injectable({ providedIn: 'root' })
export class RouteQueriesService {
  private readonly paths = inject(PathAndRouteService);
  private readonly grid = inject(GlobalRouteGridService);

  private graph: RouteGraph | null = null;
  private graphRoutes: readonly (readonly GeoPosition[])[] = [];

  /**
   * Where a strike of `id` aimed at `target` would land, or null when
   * nothing is in reach: the nearest route cell, for a beam the point of the
   * route its sweep starts on.
   */
  resolveAbilityTarget(id: AbilityId, target: GeoPosition): GeoPosition | null {
    const config = ABILITIES[id];
    if (!config) return null;
    if (config.effect.kind === 'beam') return this.previewSweep(id, target)?.points[0] ?? null;
    return this.grid.snapToRouteCell(target, config.snapRadiusM);
  }

  /**
   * The route stretch a beam of `id` aimed at `target` would burn along;
   * null for an ability that is no beam and where no route is in reach.
   * `lengthM` asks for more than the beam's reach (the bot).
   */
  previewSweep(id: AbilityId, target: GeoPosition, lengthM?: number): RouteSweep | null {
    const config = ABILITIES[id];
    if (config?.effect.kind !== 'beam') return null;
    return routeSweepToward(
      this.paths.getCachedPaths().values(),
      target,
      config.snapRadiusM,
      lengthM ?? abilityBeamReachM(config.effect),
    );
  }

  /** Where a move order aimed at `target` would send the hero, or null when no route is within reach. */
  resolveHeroMoveTarget(target: GeoPosition): GeoPosition | null {
    const graph = this.ensureGraph();
    const point = graph?.nearestPoint(target.lat, target.lon, HERO.orderSnapM);
    return graph && point ? graph.pointGeo(point) : null;
  }

  /** The route graph of the routes now, rebuilt when they changed */
  private ensureGraph(): RouteGraph | null {
    const routes = [...this.paths.getCachedPaths().values()];
    const same = routes.length === this.graphRoutes.length && routes.every((r, i) => r === this.graphRoutes[i]);
    if (!this.graph || !same) {
      this.graph = RouteGraph.fromRoutes(this.paths.getCachedPaths());
      this.graphRoutes = routes;
    }
    return this.graph.isEmpty ? null : this.graph;
  }
}
