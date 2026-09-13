import type { Enemy } from '../entities/enemy.entity';
import { OozeBody } from '../entities/ooze-body';
import type { OozeConfig } from '../configs/enemy-types.config';
import { enemyBaseDamageForWave } from '../configs/wave-curriculum.config';
import { routeBodyStations } from '../utils/route-body';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameEventBus } from '../game-engine';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';

/**
 * The oozes on the map, for EnemyManager: their bodies along the route
 * (OozeBody), created at the spawn, grown and flowed into the HQ in the
 * enemy sub-step and handed to the engine's ooze renderer once per frame.
 * Kept out of the manager so its per-enemy loop only pays a field check
 * (`enemy.body`) for everyone else.
 *
 * A body is in no route cell; the route grid keeps it in its body list
 * instead (GlobalRouteGrid.getBodyEnemies), where towers and radius queries
 * find it.
 */
export class OozeBodies {
  private readonly oozes: { enemy: Enemy; body: OozeBody; config: OozeConfig }[] = [];

  /** The route grid's ground for the renderer's band */
  private readonly groundAt = (x: number, z: number): number | null => this.grid.getGroundLocalYAt(x, z);

  constructor(
    private readonly grid: GlobalRouteGridService,
    private readonly eventBus: GameEventBus,
    private readonly waveNumber: () => number,
  ) {}

  /** Gives a freshly spawned ooze its body, starting where it joins its path. */
  attach(enemy: Enemy, engine: ThreeTilesEngine): void {
    const config = enemy.typeConfig.ooze;
    if (!config) return;
    const stations = routeBodyStations(enemy.movement.path, engine.sync, engine.sync.getOrigin().height);
    const body = new OozeBody(stations, config.maxLengthM, enemy.movement.getDistanceAlongPath());
    enemy.body = body;
    this.oozes.push({ enemy, body, config });
    this.grid.addBodyEnemy(enemy);
    engine.oozes.add(enemy.id, stations, this.groundAt);
  }

  /**
   * One sub-step (`deltaMs` of game time), after the tips moved. Every body
   * follows its tip. A body whose tip reached the HQ flows in at the tip's
   * speed, slow included, nothing while it is paused: each metre that enters
   * costs its share of the leak (OozeConfig.leakDamageFactor), charged in
   * whole points as enemy:leaking, and takes its share of the ooze's HP
   * with it. Once the whole body is in, the ooze reaches the base with the
   * rest of what it owes (enemy:reached-base) and goes into `leaked` for
   * removal.
   */
  update(deltaMs: number, gameTimeMs: number, leaked: Enemy[]): void {
    for (const { enemy, body, config } of this.oozes) {
      if (!enemy.alive) continue;
      const movement = enemy.movement;
      body.grow(movement.getDistanceAlongPath());
      if (!body.arrived) {
        if (body.tipM < body.stations.length) continue;
        body.arrived = true;
      }
      if (movement.paused) continue;

      const lengthBefore = body.lengthM;
      const speed = movement.speedMps * movement.speedMultiplier * movement.getSlowMultiplier(gameTimeMs);
      const entered = body.flowIn((speed * Math.min(deltaMs, 100)) / 1000);
      if (entered > 0) {
        const perMetre = (enemyBaseDamageForWave(this.waveNumber()) * config.leakDamageFactor) / config.maxLengthM;
        const damage = body.owe(entered * perMetre);
        if (damage > 0) this.eventBus.emit({ type: 'enemy:leaking', enemy, damage });
        // The mass that went in takes its share of the one HP pool with it
        if (!body.flowedIn) enemy.health.setHp(enemy.health.hp * (body.lengthM / lengthBefore));
      }
      if (body.flowedIn) {
        this.eventBus.emit({ type: 'enemy:reached-base', enemy, damage: body.settle() });
        leaked.push(enemy);
      }
    }
  }

  /**
   * How many of `count` split children a killed ooze breaks into: one per
   * maxLengthM / count metres of body it still has, at least one. A body
   * killed young near the portal or half into the HQ breaks into fewer
   * clumps; the kill-gold slots of the others stay unpaid, as for a leak.
   */
  splitCount(enemy: Enemy, count: number): number {
    const entry = this.oozes.find((o) => o.enemy === enemy);
    if (!entry) return count;
    const share = entry.body.lengthM / entry.config.maxLengthM;
    return Math.max(1, Math.min(count, Math.round(count * share)));
  }

  /**
   * Where split child `i` of `n` of a killed ooze starts: at the middle of
   * its share of the body, on the path there and on the route grid's ground
   * (the tip's ground where the grid has none). Writes segment, progress
   * and ground into `start`; lane and altitude are the caller's.
   */
  placeSplitChild(
    enemy: Enemy,
    i: number,
    n: number,
    start: { segmentIndex: number; segmentProgress: number; groundHeight: number },
  ): void {
    const body = enemy.body;
    if (!body) return;
    const s = body.tailM + ((i + 0.5) / n) * body.lengthM;
    const st = body.stations;
    st.locate(s, start);
    const k = st.nearestIndex(s);
    const groundY = this.grid.getGroundLocalYAt(st.x[k], st.z[k]);
    start.groundHeight = groundY !== null ? groundY + st.originHeight : enemy.transform.terrainHeight;
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
