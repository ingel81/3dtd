import type { Enemy } from '../entities/enemy.entity';
import { OozeBody } from '../entities/ooze-body';
import { routeBodyStations } from '../utils/route-body';
import type { ThreeTilesEngine } from '../three-engine';

/**
 * The oozes on the map, for EnemyManager: their bodies along the route
 * (OozeBody), created at the spawn and grown in the enemy sub-step. Kept
 * out of the manager so its per-enemy loop only pays a field check
 * (`enemy.body`) for everyone else.
 */
export class OozeBodies {
  private readonly oozes: { enemy: Enemy; body: OozeBody }[] = [];

  /** Gives a freshly spawned ooze its body, starting where it joins its path. */
  attach(enemy: Enemy, engine: ThreeTilesEngine): void {
    const config = enemy.typeConfig.ooze;
    if (!config) return;
    const stations = routeBodyStations(enemy.movement.path, engine.sync, engine.sync.getOrigin().height);
    const body = new OozeBody(stations, config.maxLengthM, enemy.movement.getDistanceAlongPath());
    enemy.body = body;
    this.oozes.push({ enemy, body });
  }

  /** One sub-step, after the tips moved: every body follows its tip. */
  update(): void {
    for (const { enemy, body } of this.oozes) {
      if (!enemy.alive) continue;
      body.grow(enemy.movement.getDistanceAlongPath());
    }
  }

  detach(enemy: Enemy): void {
    const i = this.oozes.findIndex((o) => o.enemy === enemy);
    if (i >= 0) this.oozes.splice(i, 1);
  }

  clear(): void {
    this.oozes.length = 0;
  }
}
