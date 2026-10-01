import type { Enemy } from '../entities/enemy.entity';
import { OozeBody } from '../entities/ooze-body';
import { leakDamageOf, type EnemyTypeId, type OozeConfig } from '../configs/enemy-types.config';
import { waveRules } from '../director/wave-rules';
import { OOZE_SOUNDS } from '../configs/audio.config';
import { routeBodyStations } from '../utils/route-body';
import type { GameEventBus } from '../game-engine/game-event-bus';
import type { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { assignPlainFields, decodeNumber, encodeNumber, plainFields, type PlainRecord } from '../simulator/plain-fields';
import type { SimCoords } from '../sim/core/sim-coords';
import type { SimSink } from '../sim/core/sim-sink';

/** An ooze of the wave snapshot: its enemy, its body's fields and its slurp counter */
export interface SavedOoze {
  enemyId: string;
  body: PlainRecord;
  hit: PlainRecord;
  slurpM: number | string;
}

/** An ooze on the map with its body */
export interface OozeEntry {
  readonly enemy: Enemy;
  readonly body: OozeBody;
  readonly config: OozeConfig;
  slurpM: number;
}

/**
 * The oozes on the map, for EnemyManager: their bodies along the route
 * (OozeBody), created at the spawn, grown and flowed into the HQ in the
 * enemy sub-step. The packet's ooze table hands each body's stretch to the
 * main thread's ooze renderer once per frame (sim/core/packet-writer.ts).
 * Kept out of the manager so its per-enemy loop only pays a field check
 * (`enemy.body`) for everyone else.
 *
 * A body is in no route cell; the route grid keeps it in its body list
 * instead (GlobalRouteGrid.getBodyEnemies), where towers and radius queries
 * find it.
 *
 * Its bubbling loop and the splat of a kill are the main thread's (they
 * follow the listener); the slurp at the HQ goes out as audio:play.
 */
export class OozeBodies {
  private readonly oozes: OozeEntry[] = [];

  constructor(
    private readonly grid: GlobalRouteGridService,
    private readonly eventBus: GameEventBus,
    private readonly waveNumber: () => number,
    private readonly coords: SimCoords,
    private readonly sink: SimSink,
  ) {}

  /** Every ooze on the map in list order */
  get entries(): readonly OozeEntry[] {
    return this.oozes;
  }

  /** Gives a freshly spawned ooze its body, starting where it joins its path. */
  attach(enemy: Enemy): void {
    const config = enemy.typeConfig.ooze;
    if (!config) return;
    const sync = this.coords.sync;
    const path = enemy.movement.path;
    const stations = routeBodyStations(path, sync, sync.getOrigin().height);
    const body = new OozeBody(stations, config.maxLengthM, enemy.movement.getDistanceAlongPath());
    enemy.body = body;
    // The first metre that flows in slurps at once
    this.oozes.push({ enemy, body, config, slurpM: OOZE_SOUNDS.slurp.everyM });
    this.grid.addBodyEnemy(enemy);
    this.sink.oozes.add(enemy.id, path);
  }

  /**
   * One sub-step (`deltaMs` of game time), after the tips moved. Every body
   * follows its tip. A body whose tip reached the HQ flows in at the tip's
   * speed, slow included, nothing while it is paused: each metre that enters
   * costs its share of the ooze's leak damage (leakDamageOf), charged in
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
        const type = enemy.typeConfig.id as EnemyTypeId;
        const perMetre = (waveRules().leakScale(this.waveNumber(), type) * leakDamageOf(type)) / config.maxLengthM;
        const damage = body.owe(entered * perMetre);
        if (damage > 0) this.eventBus.emit({ type: 'enemy:leaking', enemy, damage });
        // The mass that went in takes its share of the one HP pool with it
        if (!body.flowedIn) enemy.health.setHp(enemy.health.hp * (body.lengthM / lengthBefore));
        entry.slurpM += entered;
        if (entry.slurpM >= OOZE_SOUNDS.slurp.everyM) {
          entry.slurpM -= OOZE_SOUNDS.slurp.everyM;
          this.eventBus.emitDeferred({
            type: 'audio:play', sound: OOZE_SOUNDS.slurp.id,
            lat: enemy.position.lat, lon: enemy.position.lon, height: enemy.transform.terrainHeight,
          });
        }
      }
      if (body.flowedIn) {
        this.eventBus.emit({ type: 'enemy:reached-base', enemy, damage: body.settle() });
        leaked.push(enemy);
      }
    }
  }

  /** Every ooze in list order, for the wave snapshot (wave-snapshot.ts) */
  captureWaveState(): SavedOoze[] {
    return this.oozes.map(({ enemy, body, slurpM }) => ({
      enemyId: enemy.id,
      body: plainFields(body),
      hit: plainFields(body.hit),
      slurpM: encodeNumber(slurpM),
    }));
  }

  /**
   * Give the oozes of captureWaveState() their bodies again, in the same
   * order (the route grid's body list keeps it too), after clear().
   */
  restoreWaveState(saved: readonly SavedOoze[], byId: (id: string) => Enemy | null): void {
    for (const s of saved) {
      const enemy = byId(s.enemyId);
      if (!enemy) continue;
      this.attach(enemy);
      const entry = this.oozes[this.oozes.length - 1];
      assignPlainFields(entry.body, s.body);
      assignPlainFields(entry.body.hit, s.hit);
      entry.slurpM = decodeNumber(s.slurpM);
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

  /** A killed ooze breaks up: its band collapses where the body is (SimSink.oozes.collapse). */
  died(enemy: Enemy): void {
    const body = enemy.body;
    if (body === null) return;
    this.sink.oozes.collapse(enemy.id, body.tailM, body.tipM);
  }

  /** The ooze left the map; its band sinks away and its loop ends. */
  detach(enemy: Enemy): void {
    const i = this.oozes.findIndex((o) => o.enemy === enemy);
    if (i < 0) return;
    this.oozes.splice(i, 1);
    this.grid.removeBodyEnemy(enemy);
    this.sink.oozes.remove(enemy.id);
  }

  /**
   * Every ooze gone at once (wave end, game over, reset): every body still
   * tracked here, its band at once like the other enemies' meshes. What
   * the renderer still shows of an ooze already off this list (a killed
   * one's collapsing band and debris, a leaked one's sinking band) runs
   * out on its own after a wave end; a restart or a location change clears
   * it (GameStateManager.reset).
   */
  clear(): void {
    for (const { enemy } of this.oozes) {
      this.grid.removeBodyEnemy(enemy);
      this.sink.oozes.discard(enemy.id);
    }
    this.oozes.length = 0;
  }
}
