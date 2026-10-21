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
import type { GeoPosition } from '../models/game.types';
import type { SightCount } from '../utils/route-grid-los';
import { SimClient } from '../sim/client/sim-client.service';
import type { LosNeededPayload } from '../sim/protocol/events';
import type { SimFramePacket } from '../sim/protocol/packet';
import { WORLD_BUSY_OPS, WORLD_CALM_FRAMES, WorldSightBatch } from './world-sight-batch';

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
 * A tower whose world changed (reason 'world': a crater under the routes, a
 * fall, a ruin's lost wall, a wave event's objects) renders its cube again
 * from the world as it is now and samples every cell in reach anew; those
 * requests go in batches, at most one a second (WorldSightBatch), the
 * others at once.
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
  /**
   * The packet each request came in with (`packets` then): a removal or a
   * mask of the same packet is older than the request (events are handed on
   * before the frame's tower states are read here) and does not end it.
   */
  private readonly queuedAt = new Map<string, number>();
  /** Packets handled so far, see queuedAt */
  private packets = 0;
  /** The request whose cube is read back now (resolveQueued); the next waits for it */
  private inFlight: LosNeededPayload | null = null;
  /** Counts the times the requests were dropped: a readback of an earlier count answers nothing */
  private epoch = 0;
  /** When the requests of towers whose world changed render (reason 'world') */
  private readonly worldBatch = new WorldSightBatch<LosNeededPayload>();
  /** Frames to go before a changed world's cube may render: none in a frame a fall or a crater comes with, nor the next */
  private calmIn = 0;
  private readonly unsubscribe: (() => void)[] = [];

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
    // Live only: a replay's towers take their masks from the log
    const needed = bus.onLive('tower:los-needed', (event) => {
      const { type: _type, ...payload } = event;
      this.queue.delete(payload.towerId);
      this.queue.set(payload.towerId, payload);
      this.queuedAt.set(payload.towerId, this.packets);
    });
    const reset = bus.on('game:reset', () => this.clearQueue());
    this.unsubscribe.push(() => needed.dispose(), () => reset.dispose());
    this.unsubscribe.push(this.sim.onFrame((packet) => this.afterFrame(packet)));
  }

  detach(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.clearQueue();
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

  private clearQueue(): void {
    this.queue.clear();
    this.queuedAt.clear();
    this.inFlight = null;
    this.epoch++;
    this.worldBatch.reset();
    this.calmIn = 0;
  }

  /** The request of `id` ends, unless it came with this packet (see queuedAt). */
  private endRequest(id: string): void {
    const at = this.queuedAt.get(id);
    if (at === undefined || at === this.packets) return;
    this.queue.delete(id);
    this.queuedAt.delete(id);
  }

  /** The simulation's answers into the main grid, then this frame's renders. */
  private afterFrame(packet: SimFramePacket): void {
    // A tower removed and put back in the same packet (a restore) keeps the request its new self made
    for (const id of packet.removedTowers) {
      this.endRequest(id);
      this.losDropLogged.delete(id);
      this.grid.unregisterTower(id);
    }
    for (const state of packet.towerStates) {
      if (state.losMask === undefined) continue;
      // Answered: by this client's render, or by the host's for a coop guest,
      // whose queue would otherwise hold every tower when it becomes the host
      this.endRequest(state.id);
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
    if (this.role === 'render') {
      if (packet.ops.some((op) => WORLD_BUSY_OPS.has(op[0]))) this.calmIn = WORLD_CALM_FRAMES;
      this.worldBatch.tick(this.worldWaiting(), (this.engine?.world.destruction?.ground?.pending ?? 0) === 0);
      this.resolveQueued(this.calmIn === 0);
      if (this.calmIn > 0) this.calmIn--;
    }
    this.packets++;
  }

  /** The requests of towers whose world changed, waiting since an earlier packet (WorldSightBatch.tick) */
  private worldWaiting(): LosNeededPayload[] {
    const out: LosNeededPayload[] = [];
    for (const [id, request] of this.queue) {
      if (request.reason === 'world' && (this.queuedAt.get(id) ?? this.packets) < this.packets) out.push(request);
    }
    return out;
  }

  private localOf(tower: Tower): { x: number; y: number; z: number } | null {
    if (!this.engine) return null;
    const p = tower.position;
    return this.engine.sync.geoToLocalSimple(p.lat, p.lon, p.height ?? 0);
  }

  /**
   * One cube per frame at most, and none while the last one's faces come
   * back: the oldest request renders (one for a changed world only in its
   * batch, WorldSightBatch, and not in a frame a fall or a crater weighs on), its readback runs without waiting
   * (TowerShadowMapper.readFacesAsync), and the answer goes out once the
   * faces are there (finish), a frame or two after the render. The
   * simulation waits for the mask either way; what it applies, and when, is
   * in the command log (docs/SIM_WORKER.md).
   */
  private resolveQueued(worldCalm: boolean): void {
    if (!this.engine || !this.grid.isInitialized() || this.inFlight) return;
    for (const [id, request] of this.queue) {
      const tower = this.sim.mirror.tower(id);
      if (!tower) {
        // Sold before its turn
        this.queue.delete(id);
        this.queuedAt.delete(id);
        continue;
      }
      if (request.reason === 'world' && (!worldCalm || !this.worldBatch.allows(request))) continue;
      this.start(tower, request);
      return;
    }
  }

  /** Renders the cube from the tower's tip and reads its faces back; the cells resolve when they are there (finish) */
  private start(tower: Tower, request: LosNeededPayload): void {
    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    const terrainPos = this.localOf(tower);
    if (!config || !terrainPos || !this.engine) return;
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;
    const cube = this.renderCube(new Vector3(terrainPos.x, tipY, terrainPos.z), request.range);
    if (!cube) {
      console.warn('[TowerLosRegistry] no LOS blocker group');
      return;
    }
    const epoch = this.epoch;
    this.inFlight = request;
    this.engine.getTowerShadowMapper().readFacesAsync().then(
      (faces) => this.finish(tower.id, request, epoch, terrainPos, { ...cube, faces }),
      (error: unknown) => {
        // A lost context: the request stays and renders again with the next frame
        if (this.epoch === epoch && this.inFlight === request) this.inFlight = null;
        console.warn('[TowerLosRegistry] cube readback failed', error);
      },
    );
  }

  /**
   * The faces are back: resolve the tower's cells in range on the main grid
   * and send the mask. Nothing if the request is no longer the tower's (a
   * newer one, sold, a new run or location).
   */
  private finish(id: string, request: LosNeededPayload, epoch: number, terrainPos: { x: number; z: number }, ctx: LosResolveContext): void {
    if (this.epoch !== epoch) return;
    this.inFlight = null;
    const tower = this.sim.mirror.tower(id);
    if (this.queue.get(id) !== request || !tower || !this.grid.isInitialized()) return;
    this.queue.delete(id);
    this.queuedAt.delete(id);
    const mask = this.resolve(tower, request, terrainPos, ctx);
    this.sim.bus.emit({ type: 'command:los-mask', towerId: id, reason: request.reason, mask, generation: request.generation });
  }

  /**
   * The tower's cells in range against the cube on the main grid: all of
   * them for a place and for a changed world (the cube saw the world as it
   * is now, every old answer may be wrong), incrementally for a range
   * upgrade and an air retrofit (cells that keep a cached answer are not
   * sampled again). The answers stay in the main grid;
   * the mask goes to the simulation.
   */
  private resolve(tower: Tower, request: LosNeededPayload, terrainPos: { x: number; z: number }, ctx: LosResolveContext): ReturnType<typeof losMaskToJson> {
    const before = tower.visibleCells.length;
    const incremental = request.reason === 'upgrade' || request.reason === 'retrofit';
    tower.visibleCells = incremental
      ? this.grid.registerTowerIncremental(tower.id, terrainPos.x, terrainPos.z, request.range, ctx, request.canTargetGround, request.canTargetAir)
      : this.grid.registerTower(tower.id, terrainPos.x, terrainPos.z, request.range, ctx, request.canTargetGround, request.canTargetAir);
    if (incremental) this.reportLosDrop(tower, before, request.reason, ctx);
    return losMaskToJson(this.grid.encodeLosMask(
      tower.id, terrainPos.x, terrainPos.z, request.range, request.canTargetGround, request.canTargetAir,
    ));
  }

  /** probeSight can answer: the engine and the grid are there */
  canProbeSight(): boolean {
    return this.engine !== null && this.grid.isInitialized();
  }

  /**
   * What a tower of `typeId` standing at `position` (its foot, as the
   * placement puts it) would see of the route: the cube from its tip like a
   * placement renders it, counted on the main grid, but no cell keeps an
   * answer. For the bot's choice among spots, the look a player takes at the
   * build preview (docs/BOT_PLAYER_PLAN.md, B2). Null without the engine, its
   * blocker group or the grid, and for a building without range.
   */
  probeSight(position: GeoPosition, typeId: TowerTypeId, canTargetAir: boolean): SightCount | null {
    const config = TOWER_TYPES[typeId];
    if (!this.engine || !this.grid.isInitialized() || !config?.range) return null;
    const local = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    const tipY = local.y + config.heightOffset + config.shootHeight;
    const ctx = this.buildLosResolveContext(new Vector3(local.x, tipY, local.z), config.range);
    if (!ctx) return null;
    const sight = this.grid.sightFrom(local.x, local.z, config.range, ctx, config.canTargetGround ?? true, canTargetAir);
    // The build preview renders only when its tip moves: make it render its own again
    this.engine.getTowerShadowMapper().invalidate();
    return sight;
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
   * Renders the tower-shadow cubemap from `tipWorld` with `range` as far and
   * returns what a resolve against it needs but its faces, the tip taken now
   * (the build preview may render the cube again before the faces are
   * back). `mapper.invalidate()` is hardcoded here so the move-gate never
   * skips a render that the caller needs (a previous build-preview call may
   * have left the cube cached for a different tip).
   */
  private renderCube(tipWorld: Vector3, range: number): Omit<LosResolveContext, 'faces'> | null {
    if (!this.engine) return null;
    const blockerGroup = this.engine.getLosBlockerGroup();
    if (!blockerGroup) return null;
    const mapper = this.engine.getTowerShadowMapper();
    mapper.invalidate();
    mapper.update(tipWorld, range, blockerGroup);
    return {
      cube: mapper.getRenderTarget(),
      referencePos: mapper.getReferencePos().clone(),
      farDistance: mapper.getFarDistance(),
      visibilityBias: LOS_VIZ_CONFIG.visibilityBiasMeters,
      emptyDepthEpsilon: LOS_VIZ_CONFIG.emptyDepthEpsilon,
    };
  }

  /** The cube rendered from `tipWorld`, its faces read back at once, for a resolve that cannot wait (probeSight) */
  private buildLosResolveContext(tipWorld: Vector3, range: number): LosResolveContext | null {
    const cube = this.renderCube(tipWorld, range);
    if (!cube || !this.engine) return null;
    const mapper = this.engine.getTowerShadowMapper();
    return {
      ...cube,
      // All six faces into the CPU buffers at once, instead of a synchronous
      // 1x1 readback per cell during the resolve. Lazy: only once the resolve
      // samples a cell; an incremental registration that sees cached cells
      // only triggers no GPU-to-CPU round trip at all.
      get faces() {
        return mapper.readFacesToCpu();
      },
    };
  }
}
