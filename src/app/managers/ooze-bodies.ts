import type { Enemy } from '../entities/enemy.entity';
import { OozeBody } from '../entities/ooze-body';
import { routeBodyStations } from '../utils/route-body';
import type { ThreeTilesEngine } from '../three-engine';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';

/**
 * The oozes on the map, for EnemyManager: their bodies along the route
 * (OozeBody), created at the spawn, grown in the enemy sub-step and handed
 * to the engine's ooze renderer once per frame. Kept out of the manager so
 * its per-enemy loop only pays a field check (`enemy.body`) for everyone
 * else.
 *
 * A body is in no route cell; the route grid keeps it in its body list
 * instead (GlobalRouteGrid.getBodyEnemies), where towers and radius queries
 * find it.
 */
export class OozeBodies {
  private readonly oozes: { enemy: Enemy; body: OozeBody }[] = [];

  /** The route grid's ground for the renderer's band */
  private readonly groundAt = (x: number, z: number): number | null => this.grid.getGroundLocalYAt(x, z);

  constructor(private readonly grid: GlobalRouteGridService) {}

  /** Gives a freshly spawned ooze its body, starting where it joins its path. */
  attach(enemy: Enemy, engine: ThreeTilesEngine): void {
    const config = enemy.typeConfig.ooze;
    if (!config) return;
    const stations = routeBodyStations(enemy.movement.path, engine.sync, engine.sync.getOrigin().height);
    const body = new OozeBody(stations, config.maxLengthM, enemy.movement.getDistanceAlongPath());
    enemy.body = body;
    this.oozes.push({ enemy, body });
    this.grid.addBodyEnemy(enemy);
    engine.oozes.add(enemy.id, stations, this.groundAt);
  }

  /** One sub-step, after the tips moved: every body follows its tip. */
  update(): void {
    for (const { enemy, body } of this.oozes) {
      if (!enemy.alive) continue;
      body.grow(enemy.movement.getDistanceAlongPath());
    }
  }

  /** Once per render frame: each body's stretch, HP and status effects to its band. */
  present(engine: ThreeTilesEngine, gameTimeMs: number): void {
    for (const { enemy, body } of this.oozes) {
      if (!enemy.alive) continue;
      const movement = enemy.movement;
      const effects = movement.statusEffects.length !== 0;
      engine.oozes.setFrame(
        enemy.id,
        body.tailM,
        body.tipM,
        enemy.health.healthPercent,
        effects && movement.isSlowed(gameTimeMs),
        effects && movement.isPoisoned(gameTimeMs),
        effects && movement.isBurning(gameTimeMs),
      );
    }
  }

  /** The ooze left the map; its band sinks away. */
  detach(enemy: Enemy, engine: ThreeTilesEngine | null): void {
    const i = this.oozes.findIndex((o) => o.enemy === enemy);
    if (i < 0) return;
    this.oozes.splice(i, 1);
    this.grid.removeBodyEnemy(enemy);
    engine?.oozes.remove(enemy.id);
  }

  /** Every ooze gone at once (reset, game over); a band still sinking after a removal finishes on its own. */
  clear(engine: ThreeTilesEngine | null): void {
    if (this.oozes.length === 0) return;
    for (const { enemy } of this.oozes) this.grid.removeBodyEnemy(enemy);
    this.oozes.length = 0;
    engine?.oozes.clear();
  }
}
