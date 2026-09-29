import { Injectable, inject } from '@angular/core';
import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { LosResolveContext, cubeCoverage } from '../utils/gpu-cube-resolve';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { losMaskFromJson, losMaskToJson } from '../utils/los-mask';
import type { LosResolveReason } from '../game-engine/game-event-bus';
import type { Tower } from '../entities/tower.entity';
import { SimClient } from '../sim/client/sim-client.service';
import type { LosNeededPayload } from '../sim/protocol/events';
import type { SimFramePacket } from '../sim/protocol/packet';

/**
 * Lines of sight on the main thread (docs/SIM_WORKER.md, docs/LOS_PIPELINE.md).
 * The simulation never renders: a tower that needs its line of sight (placed,
 * range upgraded, air retrofit researched) waits there and says so with
 * `tower:los-needed`. This service renders the cube from the tower's tip on
 * the GPU, resolves the cells in range on the main thread's grid and sends the
 * answer as `command:los-mask`; the simulation applies it at the boundary it
 * arrives at and logs it, so a replay needs no GPU.
 *
 * Who renders: the single player game and the coop host (role 'render'); a
 * coop guest waits for the host's masks (role 'wait'), which reach its
 * simulation through the relay.
 *
 * The main thread's grid follows the simulation's answers: every tower state
 * that carries a mask (sim/protocol/packet.ts TowerStateDto.losMask) is
 * written into it, so the grid's views and the wave source's coverage numbers
 * read what the towers see.
 */
@Injectable({ providedIn: 'root' })
export class TowerLosRegistry {
  private readonly grid = inject(GlobalRouteGridService);
  private readonly sim = inject(SimClient);
  private engine: ThreeTilesEngine | null = null;
  private role: 'render' | 'wait' = 'render';
  /** Requests in the order the simulation made them, the latest per tower */
  private readonly queue = new Map<string, LosNeededPayload>();
  private readonly unsubscribe: (() => void)[] = [];

  /**
   * Cube renders per frame. Each one is a forced cubemap render plus the face
   * readback; running many towers in one frame blocked the main thread for
   * 1-2 s.
   */
  private static readonly RESOLVES_PER_FRAME = 1;

  /**
   * A recompute that leaves a tower no more than this share of the cells it
   * saw before is logged (reportLosDrop). Finer tiles under a tower move a
   * few answers; three quarters gone at once is what a cube that reads
   * nearly everything as blocked looks like.
   */
  private static readonly LOS_DROP_LEFT_SHARE = 0.25;

  /** A tower that saw fewer cells before is not logged: too few to tell a drop from a few moved answers. */
  private static readonly LOS_DROP_MIN_CELLS = 8;

  /** Geometry closer than this to the tip counts as "at the tip" in the drop log, m. */
  private static readonly LOS_DROP_NEAR_M = 2;

  /** Towers whose drop is logged already, see reportLosDrop. */
  private readonly losDropLogged = new Set<string>();

  /** Work against the engine of a (new) location; the requests of the previous one are gone. */
  attach(engine: ThreeTilesEngine): void {
    this.detach();
    this.engine = engine;
    const bus = this.sim.bus;
    const needed = bus.on('tower:los-needed', (event) => {
      const { type: _type, ...payload } = event;
      this.queue.delete(payload.towerId);
      this.queue.set(payload.towerId, payload);
    });
    const reset = bus.on('game:reset', () => this.queue.clear());
    this.unsubscribe.push(() => needed.dispose(), () => reset.dispose());
    this.unsubscribe.push(this.sim.onFrame((packet) => this.afterFrame(packet)));
  }

  detach(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.queue.clear();
    this.losDropLogged.clear();
    this.engine = null;
  }

  /** 'render' in the single player game and for the coop host, 'wait' for a coop guest. */
  setRole(role: 'render' | 'wait'): void {
    this.role = role;
  }

  /** Towers waiting for this client's GPU, oldest first (debug). */
  pendingTowerIds(): string[] {
    return [...this.queue.keys()];
  }

  /** The simulation's answers into the main grid, then this frame's renders. */
  private afterFrame(packet: SimFramePacket): void {
    for (const id of packet.removedTowers) {
      this.queue.delete(id);
      this.losDropLogged.delete(id);
      this.grid.unregisterTower(id);
    }
    for (const state of packet.towerStates) {
      if (state.losMask === undefined) continue;
      const tower = this.sim.mirror.tower(state.id);
      if (!tower) continue;
      if (state.losMask === null) {
        this.grid.unregisterTower(state.id);
        tower.visibleCells = [];
        continue;
      }
      const local = this.localOf(tower);
      if (!local) continue;
      tower.visibleCells = this.grid.applyLosMask(state.id, local.x, local.z, losMaskFromJson(state.losMask));
    }
    if (this.role === 'render') this.resolveQueued();
  }

  private localOf(tower: Tower): { x: number; y: number; z: number } | null {
    if (!this.engine) return null;
    const p = tower.position;
    return this.engine.sync.geoToLocalSimple(p.lat, p.lon, p.height ?? 0);
  }

  private resolveQueued(): void {
    if (!this.engine || !this.grid.isInitialized()) return;
    let budget = TowerLosRegistry.RESOLVES_PER_FRAME;
    for (const [id, request] of this.queue) {
      if (budget === 0) return;
      const tower = this.sim.mirror.tower(id);
      if (!tower) {
        // Sold before its turn
        this.queue.delete(id);
        continue;
      }
      const mask = this.resolve(tower, request);
      if (!mask) return;
      this.queue.delete(id);
      budget--;
      this.sim.bus.emit({ type: 'command:los-mask', towerId: id, reason: request.reason, mask });
    }
  }

  /**
   * Render the cube from the tower's tip and resolve its cells in range on
   * the main grid: all of them for a place, incrementally for a recompute
   * (cells that keep a cached answer are not sampled again). The answers stay
   * in the main grid; the mask goes to the simulation.
   */
  private resolve(tower: Tower, request: LosNeededPayload): ReturnType<typeof losMaskToJson> | null {
    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    const terrainPos = this.localOf(tower);
    if (!config || !terrainPos) return null;
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;
    const ctx = this.buildLosResolveContext(new Vector3(terrainPos.x, tipY, terrainPos.z), request.range);
    if (!ctx) {
      console.warn('[TowerLosRegistry] no LOS blocker group');
      return null;
    }
    const before = tower.visibleCells.length;
    const incremental = request.reason !== 'place';
    tower.visibleCells = incremental
      ? this.grid.registerTowerIncremental(tower.id, terrainPos.x, terrainPos.z, request.range, ctx, request.canTargetGround, request.canTargetAir)
      : this.grid.registerTower(tower.id, terrainPos.x, terrainPos.z, request.range, ctx, request.canTargetGround, request.canTargetAir);
    if (incremental) this.reportLosDrop(tower, before, request.reason, ctx);
    return losMaskToJson(this.grid.encodeLosMask(
      tower.id, terrainPos.x, terrainPos.z, request.range, request.canTargetGround, request.canTargetAir,
    ));
  }

  /**
   * One console warning when a recompute took most of a tower's visible
   * cells away. In the playtest of 2026-09-15 a tower cluster stopped firing
   * for good with nothing in the console. The line says what set the
   * recompute off and what the cube saw from the tip, so a log tells a real
   * blocker (geometry spread over the range) from a cube that reads nearly
   * everything as blocked (geometry at the tip). Once per drop: the tower is
   * logged again only after its cells came back.
   */
  private reportLosDrop(tower: Tower, before: number, reason: LosResolveReason, ctx: LosResolveContext): void {
    const after = tower.visibleCells.length;
    if (before < TowerLosRegistry.LOS_DROP_MIN_CELLS || after > before * TowerLosRegistry.LOS_DROP_LEFT_SHARE) {
      this.losDropLogged.delete(tower.id);
      return;
    }
    if (this.losDropLogged.has(tower.id)) return;
    this.losDropLogged.add(tower.id);

    const nearM = TowerLosRegistry.LOS_DROP_NEAR_M;
    const { near, empty } = cubeCoverage(ctx, nearM);
    const tip = ctx.referencePos;
    const percent = (share: number) => `${Math.round(share * 100)} %`;
    console.warn(
      `[TowerLOS] ${tower.id} ${tower.typeConfig.id}: ${after} of ${before} visible cells left after a LOS recompute (${reason}). ` +
      `Cube from the tip (${tip.x.toFixed(1)}, ${tip.y.toFixed(1)}, ${tip.z.toFixed(1)}), far ${ctx.farDistance} m: ` +
      `${percent(near)} geometry within ${nearM} m of the tip, ${percent(empty)} empty. ` +
      `__towerTargets() shows what the tower makes of each enemy near it.`,
    );
  }

  /**
   * Renders the tower-shadow cubemap from `tipWorld` with `range` as far,
   * then returns a context the GlobalRouteGrid uses to GPU-resolve cell
   * visibility. `mapper.invalidate()` is hardcoded here so the move-gate
   * never skips a render that the caller needs (a previous build-preview
   * call may have left the cube cached for a different tip).
   */
  private buildLosResolveContext(tipWorld: Vector3, range: number): LosResolveContext | null {
    if (!this.engine) return null;
    const blockerGroup = this.engine.getLosBlockerGroup();
    if (!blockerGroup) return null;
    const mapper = this.engine.getTowerShadowMapper();
    mapper.invalidate();
    mapper.update(tipWorld, range, blockerGroup);
    return {
      cube: mapper.getRenderTarget(),
      referencePos: mapper.getReferencePos(),
      farDistance: mapper.getFarDistance(),
      // All six faces into the CPU buffers at once, instead of a synchronous
      // 1x1 readback per cell during the resolve. Lazy: only once the resolve
      // samples a cell; an incremental registration that sees cached cells
      // only triggers no GPU-to-CPU round trip at all.
      get faces() {
        return mapper.readFacesToCpu();
      },
      visibilityBias: LOS_VIZ_CONFIG.visibilityBiasMeters,
      emptyDepthEpsilon: LOS_VIZ_CONFIG.emptyDepthEpsilon,
    };
  }
}
