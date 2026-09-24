import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';
import { GeoPosition } from '../models/game.types';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import { LosResolveContext, cubeCoverage } from '../utils/gpu-cube-resolve';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { losMaskToJson, type LosMask } from '../utils/los-mask';
import type { LosResolveReason } from '../game-engine/game-event-bus';

/**
 * Per-tower line of sight on the GlobalRouteGrid: registers a placed tower
 * (cubemap render from its tip, GPU resolve of the cells in range) and
 * unregisters it. The cells are the ones the corridor build froze, so the
 * answers hold for as long as the tower stands; only a research retrofit or
 * a range upgrade asks for a recompute. TowerPlacementService owns one and
 * exposes these as its grid-registration API.
 *
 * Every resolve ends in a LosMask on the tower (`tower.losMask`) and a
 * `tower:los-resolved` event carrying it. registerFromMask applies a stored
 * mask instead of a cube, for a snapshot restore or a re-simulation.
 */
/** A tower's answers as resolveOnGpu wrote them: what encoding a mask of them needs. */
interface ResolvedLos {
  x: number;
  z: number;
  range: number;
  canTargetGround: boolean;
  canTargetAir: boolean;
  ctx: LosResolveContext;
}

export class TowerLosRegistry {
  private engine: ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;

  /**
   * Towers a caller asked a recompute for (scheduleRecompute: the air
   * retrofit of a research), worked off by drainLosQueue from the game loop,
   * in the order they were queued. The old answers stay in the cells until
   * the recompute replaces them; the air answers the retrofit adds are
   * missing until then, and combat counts a missing answer as not visible.
   */
  private readonly staleLos = new Set<Tower>();

  /**
   * LOS recomputes per frame. Each one is a forced cubemap render plus the
   * face readback; running many towers in one frame blocked the main thread
   * for 1-2 s.
   */
  private static readonly LOS_RECOMPUTES_PER_FRAME = 1;

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
  private readonly losDropLogged = new WeakSet<Tower>();

  /**
   * Re-simulation (docs/SIMULATOR_PLAN.md, P4): where a place or an upgrade
   * gets its mask instead of the GPU, the one the live run logged. A cube
   * rendered again could see other tiles than the live one did. The
   * retrofit queue does not drain meanwhile: the re-simulation applies the
   * logged retrofit masks at the sub-step they came in.
   */
  private maskSource: ((towerId: string, reason: LosResolveReason) => LosMask | null) | null = null;

  /**
   * Coop (docs/COOP_PLAN.md, C3): no client applies a line of sight it
   * rendered itself, the host's GPU answers for everyone. A tower that needs
   * one waits here (place, upgrade, retrofit, in the order they came up; the
   * same on every client, as the simulation asks). The host renders it after
   * the frame, puts the cells back as they were and sends the mask as
   * `command:los-mask`; every client applies it at the tick it comes back
   * (applyCoopMask). Null in the single player game.
   */
  private coopRole: 'host' | 'guest' | null = null;
  private readonly awaiting = new Map<Tower, LosResolveReason>();
  /** Host: masks sent and not back yet, so a frame does not send one twice */
  private readonly sent = new Set<Tower>();

  /** Coop masks the host renders per frame: each is a cube render and readback, as LOS_RECOMPUTES_PER_FRAME */
  private static readonly COOP_RESOLVES_PER_FRAME = 1;

  constructor(private readonly grid: GlobalRouteGridService) {}

  /** Coop: 'host' renders and sends the masks, 'guest' waits for them; null for the single player game. See coopRole. */
  setCoopRole(role: 'host' | 'guest' | null): void {
    this.coopRole = role;
    this.sent.clear();
  }

  /** Coop: the towers waiting for a mask from the host, oldest first. */
  awaitingTowerIds(): string[] {
    return [...this.awaiting.keys()].map((tower) => tower.id);
  }

  /** See maskSource; null goes back to the GPU. */
  setMaskSource(source: ((towerId: string, reason: LosResolveReason) => LosMask | null) | null): void {
    this.maskSource = source;
  }

  /** Towers waiting for their retrofit, oldest first (for the wave-start snapshot). */
  queuedTowerIds(): string[] {
    return [...this.staleLos].map((tower) => tower.id);
  }

  /**
   * Anti-air retrofit researched, from the simulation's ResearchManager
   * (not the UI store): read at resolve time, not cached.
   */
  private airTargetingUnlocked(tower: Tower): boolean {
    return this.gameState?.researchOf(tower.ownerId).airTargetingUnlocked ?? false;
  }

  /**
   * Work against the engine and game state of a (new) location. The cells a
   * tower registers on are the ones the corridor build froze (CorridorBuild)
   * and stay as they are while it stands; only a research retrofit asks for
   * a recompute (scheduleRecompute).
   */
  attach(engine: ThreeTilesEngine, gameState: GameStateManager): void {
    this.engine = engine;
    this.gameState = gameState;
    // Towers queued for the previous location went with its grid.
    this.staleLos.clear();
  }

  /** Drop the queue and forget engine and game state. */
  detach(): void {
    this.staleLos.clear();
    this.engine = null;
    this.gameState = null;
  }

  /**
   * Register a placed tower on the GlobalRouteGrid:
   * - LOS raycasting to determine visible cells
   * - Grid registration for enemy targeting
   * - LOS visualization mesh (hidden by default, shown on selection)
   */
  register(tower: Tower, position: GeoPosition, typeId: TowerTypeId): void {
    if (!this.engine || !this.grid.isInitialized()) return;
    if (this.maskSource) {
      const mask = this.maskSource(tower.id, 'place');
      if (mask) this.registerFromMask(tower, mask);
      return;
    }
    if (this.coopRole) {
      tower.losReady = false;
      this.awaiting.set(tower, 'place');
      return;
    }

    const resolved = this.resolveOnGpu(tower, TOWER_TYPES[typeId]?.range, false, position);
    if (!resolved) return;
    tower.losReady = true;
    this.recordMask(tower, resolved, 'place');

    // Wenn dieser Tower bereits selected ist (z.B. nach Auto-Select beim
    // Place), die Selection-Viz vom TowerManager refreshen lassen.
    if (tower.selected) {
      this.gameState?.towerManager.refreshSelectionViz(tower);
    }
  }

  /**
   * Render the cube from the tower's tip and resolve its cells in `range`:
   * all of them (a place), or incrementally, keeping the cached answers (a
   * recompute). Writes the answers into the grid and `tower.visibleCells`.
   * Null when there is nothing to render against.
   */
  private resolveOnGpu(
    tower: Tower,
    range: number | undefined,
    incremental: boolean,
    position: GeoPosition = tower.position,
  ): ResolvedLos | null {
    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    if (!config || range === undefined || !this.engine) return null;

    const terrainPos = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;
    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(
      tower.typeConfig.id as TowerTypeId,
      this.airTargetingUnlocked(tower),
    );

    // The cells and their heights are the ones the corridor build froze
    // (CorridorBuild): the tower registers its answers on them once.
    const tipWorld = new Vector3(terrainPos.x, tipY, terrainPos.z);
    const ctx = this.buildLosResolveContext(tipWorld, range);
    if (!ctx) {
      console.warn('[TowerLosRegistry] no LOS blocker group');
      return null;
    }
    tower.visibleCells = incremental
      ? this.grid.registerTowerIncremental(tower.id, terrainPos.x, terrainPos.z, range, ctx, canTargetGround, canTargetAir)
      : this.grid.registerTower(tower.id, terrainPos.x, terrainPos.z, range, ctx, canTargetGround, canTargetAir);
    return { x: terrainPos.x, z: terrainPos.z, range, canTargetGround, canTargetAir, ctx };
  }

  /**
   * Register a placed tower from a stored LosMask instead of its cube: the
   * same cells, visibleCells and losReady as register() gave when the mask
   * was taken, without GPU work. For a snapshot restore and a re-simulation
   * (the mask comes from a `tower:los-resolved` event or `tower.losMask`).
   * Emits no event: the mask is a recorded result, not a new one. Needs the
   * engine only for the local position of the tower.
   */
  registerFromMask(tower: Tower, mask: LosMask): void {
    if (!this.engine || !this.grid.isInitialized()) return;
    const position = tower.position;
    const terrainPos = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    this.staleLos.delete(tower);
    tower.visibleCells = this.grid.applyLosMask(tower.id, terrainPos.x, terrainPos.z, mask);
    tower.losMask = mask;
    tower.losReady = true;
    if (tower.selected) {
      this.gameState?.towerManager.refreshSelectionViz(tower);
    }
  }

  /** Take the tower's answers as its LosMask and announce them (`tower:los-resolved`). */
  private recordMask(tower: Tower, resolved: ResolvedLos, reason: LosResolveReason): void {
    const mask = this.encode(tower, resolved);
    tower.losMask = mask;
    this.gameState?.getEventBus().emit({ type: 'tower:los-resolved', towerId: tower.id, mask, reason });
  }

  private encode(tower: Tower, resolved: ResolvedLos): LosMask {
    return this.grid.encodeLosMask(
      tower.id, resolved.x, resolved.z, resolved.range, resolved.canTargetGround, resolved.canTargetAir,
    );
  }

  /**
   * Unregister a tower from the GlobalRouteGrid.
   */
  unregister(tower: Tower): void {
    this.awaiting.delete(tower);
    this.sent.delete(tower);
    // Selection-Viz wird vom TowerManager bereinigt (Owner-Pattern).
    this.gameState?.towerManager.onTowerUnregistered(tower);
    this.grid.unregisterTower(tower.id);
    this.staleLos.delete(tower);
    tower.visibleCells = [];
    tower.losMask = null;
  }

  /**
   * Recompute a tower's LOS after it gained air targets or its range grew.
   * Uses incremental registration: cells that still hold a cached entry for
   * this tower keep it (no cube sample), cells new to its reach and the
   * capability it just gained are resolved against a fresh cubemap. The
   * result mixes cubes of different moments, so it is kept as a mask
   * (recordMask): a re-simulation applies that, it does not recompute.
   */
  recompute(tower: Tower, reason: LosResolveReason = 'upgrade'): void {
    if (!this.engine || !this.grid.isInitialized()) return;
    if (this.maskSource) {
      const mask = this.maskSource(tower.id, reason);
      if (mask) this.registerFromMask(tower, mask);
      return;
    }
    if (this.coopRole) {
      // The old answers stay until the host's mask comes back
      if (!this.awaiting.has(tower)) this.awaiting.set(tower, reason);
      return;
    }

    // Incremental: only sample cells that don't already have a cached entry.
    // The queue entry is settled only once the recompute ran. One that bails
    // stays queued and the drain retries it next frame: dropped, its air
    // answers would stay missing for good. A direct call (range upgrade)
    // settles the entry as well.
    const before = tower.visibleCells.length;
    const resolved = this.resolveOnGpu(tower, tower.combat.range, true);
    if (!resolved) return;
    const queued = this.staleLos.delete(tower);
    this.reportLosDrop(tower, before, queued, resolved.ctx);
    this.recordMask(tower, resolved, reason);

    // Selection-Viz refreshen, falls dieser Tower selected ist.
    if (tower.selected) {
      this.gameState?.towerManager.refreshSelectionViz(tower);
    }
  }

  /**
   * Coop host: render the line of sight of up to COOP_RESOLVES_PER_FRAME
   * waiting towers, put the grid and the tower back as every client has
   * them (the previous mask, or none), and send each mask as
   * `command:los-mask`. Nothing of it acts here before it comes back.
   */
  private resolveForCoop(): void {
    let budget = TowerLosRegistry.COOP_RESOLVES_PER_FRAME;
    for (const [tower, reason] of this.awaiting) {
      if (budget === 0) break;
      if (this.sent.has(tower)) continue;
      const previous = tower.losMask;
      const range = reason === 'place' ? TOWER_TYPES[tower.typeConfig.id as TowerTypeId]?.range : tower.combat.range;
      const resolved = this.resolveOnGpu(tower, range, reason !== 'place');
      if (!resolved) break;
      const mask = this.encode(tower, resolved);
      this.grid.unregisterTower(tower.id);
      if (previous) {
        this.registerFromMask(tower, previous);
      } else {
        tower.visibleCells = [];
        tower.losReady = false;
      }
      this.sent.add(tower);
      budget--;
      this.gameState?.getEventBus().emit({
        type: 'command:los-mask', towerId: tower.id, reason, mask: losMaskToJson(mask),
      });
    }
  }

  /**
   * Coop: the host's mask for `tower` came back at its tick; every client
   * applies it here, at the same sub-step boundary. A tower that waits for
   * nothing takes nothing.
   */
  applyCoopMask(tower: Tower, mask: LosMask): void {
    if (!this.awaiting.has(tower)) return;
    this.awaiting.delete(tower);
    this.sent.delete(tower);
    this.grid.unregisterTower(tower.id);
    this.registerFromMask(tower, mask);
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
  private reportLosDrop(tower: Tower, before: number, queued: boolean, ctx: LosResolveContext): void {
    const after = tower.visibleCells.length;
    if (before < TowerLosRegistry.LOS_DROP_MIN_CELLS || after > before * TowerLosRegistry.LOS_DROP_LEFT_SHARE) {
      this.losDropLogged.delete(tower);
      return;
    }
    if (this.losDropLogged.has(tower)) return;
    this.losDropLogged.add(tower);

    const trigger = queued ? 'asked for' : 'direct call';
    const nearM = TowerLosRegistry.LOS_DROP_NEAR_M;
    const { near, empty } = cubeCoverage(ctx, nearM);
    const tip = ctx.referencePos;
    const percent = (share: number) => `${Math.round(share * 100)} %`;
    console.warn(
      `[TowerLOS] ${tower.id} ${tower.typeConfig.id}: ${after} of ${before} visible cells left after a LOS recompute (${trigger}). ` +
      `Cube from the tip (${tip.x.toFixed(1)}, ${tip.y.toFixed(1)}, ${tip.z.toFixed(1)}), far ${ctx.farDistance} m: ` +
      `${percent(near)} geometry within ${nearM} m of the tip, ${percent(empty)} empty. ` +
      `__towerTargets() shows what the tower makes of each enemy near it.`,
    );
  }

  /**
   * recompute on one of the next drainLosQueue calls instead of right away:
   * each recompute is a cube render and readback, and a research can hand
   * air targets to many towers at once (see LOS_RECOMPUTES_PER_FRAME).
   */
  scheduleRecompute(tower: Tower): void {
    if (this.coopRole) {
      if (!this.awaiting.has(tower)) this.awaiting.set(tower, 'retrofit');
      return;
    }
    this.staleLos.add(tower);
  }

  /** Put towers back in the retrofit queue, in order (wave-start snapshot restore). */
  requeue(towers: readonly Tower[]): void {
    this.staleLos.clear();
    for (const tower of towers) this.staleLos.add(tower);
  }

  /**
   * Recompute queued towers, at most LOS_RECOMPUTES_PER_FRAME (each is a
   * forced cubemap render plus the face readback), oldest first. Called by
   * the game loop once per frame after its sub-steps (GameStateManager
   * .update), so it runs under the heartbeat of a hidden tab as well, and
   * the answers change between two sub-steps. The `tower:los-resolved`
   * event of each carries the mask; for an exact re-simulation the command
   * log records the sub-step it came in.
   */
  drainLosQueue(): void {
    if (this.maskSource) return;
    if (this.coopRole) {
      if (this.coopRole === 'host') this.resolveForCoop();
      return;
    }
    let budget = TowerLosRegistry.LOS_RECOMPUTES_PER_FRAME;
    for (const tower of [...this.staleLos]) {
      // recompute takes the tower out of the queue.
      this.recompute(tower, 'retrofit');
      if (--budget === 0) break;
    }
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
      // Alle 6 Faces einmal in die CPU-Buffer holen — statt einem
      // synchronen 1×1-Readback pro Cell beim anschließenden Resolve.
      // Lazy: erst wenn der Resolve wirklich eine Zelle sampelt. Eine
      // inkrementelle Registrierung, die nur gecachte Zellen sieht,
      // löst damit gar keinen GPU→CPU-Roundtrip aus.
      get faces() {
        return mapper.readFacesToCpu();
      },
      visibilityBias: LOS_VIZ_CONFIG.visibilityBiasMeters,
      emptyDepthEpsilon: LOS_VIZ_CONFIG.emptyDepthEpsilon,
    };
  }
}
