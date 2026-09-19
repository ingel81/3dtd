import { Vector3 } from 'three';
import type { Enemy } from '../entities/enemy.entity';
import { OozeBody } from '../entities/ooze-body';
import type { OozeConfig } from '../configs/enemy-types.config';
import { enemyBaseDamageForWave } from '../configs/wave-curriculum.config';
import { OOZE_SOUNDS } from '../configs/audio.config';
import { routeBodyStations, type RouteBody, type RouteBodyContact } from '../utils/route-body';
import { OozeSounds } from './ooze-sounds';
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
 *
 * Each ooze is heard where its body is nearest the listener (OozeSounds):
 * the bubbling loop moves there once per frame, the splat of a kill plays
 * there.
 */
export class OozeBodies {
  private readonly oozes: { enemy: Enemy; body: OozeBody; config: OozeConfig; slurpM: number }[] = [];
  private readonly sounds: OozeSounds;

  /** The route grid's ground for the renderer's band */
  private readonly groundAt = (x: number, z: number): number | null => this.grid.getGroundLocalYAt(x, z);

  /** The listener, local; the body point nearest it (hear) */
  private readonly listener = new Vector3();
  private readonly contact: RouteBodyContact = { station: 0, offset: 0, distance: 0 };
  private readonly heard = new Vector3();

  constructor(
    private readonly grid: GlobalRouteGridService,
    private readonly eventBus: GameEventBus,
    private readonly waveNumber: () => number,
  ) {
    this.sounds = new OozeSounds(eventBus);
  }

  /** Gives a freshly spawned ooze its body, starting where it joins its path. */
  attach(enemy: Enemy, engine: ThreeTilesEngine): void {
    const config = enemy.typeConfig.ooze;
    if (!config) return;
    const stations = routeBodyStations(enemy.movement.path, engine.sync, engine.sync.getOrigin().height);
    const body = new OozeBody(stations, config.maxLengthM, enemy.movement.getDistanceAlongPath());
    enemy.body = body;
    // The first metre that flows in slurps at once
    this.oozes.push({ enemy, body, config, slurpM: OOZE_SOUNDS.slurp.everyM });
    this.grid.addBodyEnemy(enemy);
    engine.oozes.add(enemy.id, stations, this.groundAt);
    if (engine.spatialAudio) this.sounds.register(engine.spatialAudio);
  }

  /**
   * One sub-step (`deltaMs` of game time), after the tips moved. Every body
   * follows its tip. A body whose tip reached the HQ flows in at the tip's
   * speed, slow included, nothing while it is paused: each metre that enters
   * costs its share of the leak (OozeConfig.leakDamageFactor), charged in
   * whole points as enemy:leaking, and takes its share of the ooze's HP
   * with it. Every OOZE_SOUNDS.slurp.everyM metres it slurps at the HQ.
   * Once the whole body is in, the ooze reaches the base with the rest of
   * what it owes (enemy:reached-base) and goes into `leaked` for removal.
   */
  update(deltaMs: number, gameTimeMs: number, leaked: Enemy[]): void {
    for (const entry of this.oozes) {
      const { enemy, body, config } = entry;
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
        entry.slurpM += entered;
        if (entry.slurpM >= OOZE_SOUNDS.slurp.everyM) {
          entry.slurpM -= OOZE_SOUNDS.slurp.everyM;
          this.sounds.slurp(enemy.position.lat, enemy.position.lon, enemy.transform.terrainHeight);
        }
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

  /**
   * Once per render frame: each body's stretch, HP and status effects to its
   * band, and its bubbling loop to the body point nearest the listener.
   */
  present(engine: ThreeTilesEngine, gameTimeMs: number): void {
    const audio = engine.spatialAudio ?? null;
    let listening = false;
    for (const { enemy, body } of this.oozes) {
      if (!enemy.alive) continue;
      const movement = enemy.movement;
      const effects = movement.hasStatusEffects;
      engine.oozes.setFrame(
        enemy.id,
        body.tailM,
        body.tipM,
        enemy.health.healthPercent,
        effects && movement.isSlowed(gameTimeMs),
        effects && movement.isPoisoned(gameTimeMs),
        effects && movement.isBurning(gameTimeMs),
        effects && movement.isFrozen(gameTimeMs),
        effects && movement.isStunned(gameTimeMs),
      );
      if (audio === null) continue;
      if (!listening) {
        audio.getListener().getWorldPosition(this.listener);
        listening = true;
      }
      this.hear(enemy, body);
      this.sounds.follow(enemy.id, audio, this.heard.x, this.heard.y, this.heard.z);
    }
  }

  /**
   * A killed ooze breaks up: its band collapses (OozeBandRenderer.collapse)
   * and its loop ends in a splat at the body point nearest the listener.
   */
  died(enemy: Enemy, engine: ThreeTilesEngine | null): void {
    const body = enemy.body;
    if (body === null || engine === null) return;
    // The stretch of this sub-step, with nothing left: a kill between two
    // frames, or before the first, collapses where the body is
    engine.oozes.setFrame(enemy.id, body.tailM, body.tipM, 0, false, false, false);
    engine.oozes.collapse(enemy.id);
    const audio = engine.spatialAudio ?? null;
    if (audio === null) return;
    this.sounds.stop(enemy.id, audio);
    audio.getListener().getWorldPosition(this.listener);
    const k = this.hear(enemy, body);
    const st = body.stations;
    const offset = this.contact.offset;
    this.sounds.splat(
      st.lat[k] + st.latPerRight[k] * offset,
      st.lon[k] + st.lonPerRight[k] * offset,
      this.heard.y + st.originHeight,
    );
  }

  /** The ooze left the map; its band sinks away and its loop ends. */
  detach(enemy: Enemy, engine: ThreeTilesEngine | null): void {
    const i = this.oozes.findIndex((o) => o.enemy === enemy);
    if (i < 0) return;
    this.oozes.splice(i, 1);
    this.grid.removeBodyEnemy(enemy);
    engine?.oozes.remove(enemy.id);
    this.sounds.stop(enemy.id, engine?.spatialAudio ?? null);
  }

  /**
   * Every ooze gone at once (wave end, game over, reset): every body still
   * tracked here, its band at once like the other enemies' meshes. What
   * the renderer still shows of an ooze already off this list (a killed
   * one's collapsing band and debris, a leaked one's sinking band) runs
   * out on its own after a wave end; a restart or a location change clears
   * it (GameStateManager.reset).
   */
  clear(engine: ThreeTilesEngine | null): void {
    for (const { enemy } of this.oozes) {
      this.grid.removeBodyEnemy(enemy);
      engine?.oozes.discard(enemy.id);
    }
    this.oozes.length = 0;
    this.sounds.clear(engine?.spatialAudio ?? null);
  }

  /**
   * The body point nearest the listener (`listener`, local, read by the
   * caller): its station, returned, the contact in `contact` and the local
   * position on the ground in `heard`.
   */
  private hear(enemy: Enemy, body: RouteBody): number {
    const c = body.nearest(this.listener.x, this.listener.z, this.contact);
    const st = body.stations;
    const k = c.station;
    const x = st.x[k] + st.rightX[k] * c.offset;
    const z = st.z[k] + st.rightZ[k] * c.offset;
    const groundY = this.grid.getGroundLocalYAt(x, z);
    this.heard.set(x, groundY ?? enemy.transform.terrainHeight - st.originHeight, z);
    return k;
  }
}
