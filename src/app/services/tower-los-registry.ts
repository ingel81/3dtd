import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';
import { GeoPosition } from '../models/game.types';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import { LosResolveContext, cubeCoverage } from '../utils/gpu-cube-resolve';
import { RouteCell } from '../utils/route-cell';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

/** A tower's place in the stale-LOS queue, see TowerLosRegistry.staleLos. */
interface StaleLosEntry {
  /** Cells whose height changed after the tower's answers for them were resolved. */
  cells: Set<RouteCell>;
  /** performance.now() when the tower was queued, measured against MAX_LOS_WAIT_MS. */
  since: number;
  /** Asked for by scheduleRecompute: nothing to coalesce, so it does not wait for a sweep. */
  explicit: boolean;
}

/**
 * Per-tower line of sight on the GlobalRouteGrid: registers a placed tower
 * (cubemap render from its tip, GPU resolve of the cells in range),
 * re-resolves it when the heights of its cells change as tiles stream in,
 * and unregisters it. TowerPlacementService owns one and exposes these as
 * its grid-registration API.
 */
export class TowerLosRegistry {
  private engine: ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;

  /** Unsubscribe for the cells-changed listener registered in attach(). */
  private cellsChangedOff: (() => void) | null = null;

  private tubeRebuildScheduled = false;

  /**
   * Towers whose LOS was resolved against a height that has changed since,
   * with the cells in question, plus towers a caller asked a recompute for
   * (scheduleRecompute). Filled by onCellsChanged, worked off by
   * drainLosRefresh. The old answers stay in the cells until the recompute
   * replaces them: a stale answer for a second beats no answer, which would
   * send every candidate in those cells down the CPU-raycast fallback of the
   * combat loop.
   */
  private readonly staleLos = new Map<Tower, StaleLosEntry>();
  private losRefreshRaf: number | null = null;
  /** Tower whose registerTowerIncremental is running: its answers for the cells the grid reports are current. */
  private resolvingTower: Tower | null = null;

  /**
   * LOS recomputes per frame. Each one is a forced cubemap render plus the
   * face readback; a big zoom-in refreshes hundreds of cells under every
   * tower at once, and running all of those towers in one frame blocked the
   * main thread for 1-2 s.
   */
  private static readonly LOS_RECOMPUTES_PER_FRAME = 1;

  /**
   * Longest a queued tower waits for a running terrain sweep, in wall-clock
   * ms. A full sweep converges in about 1.5-2 s at its 5 ms frame budget, so
   * a normal sweep still finishes first and the coalescing holds. Continuous
   * panning restarts the sweep with every tile load, though, and would hold
   * the queue back for as long as it goes on. Wall clock rather than game
   * time: the sweep and its restarts run on frames and tile loads, and game
   * time stands still in a pause.
   */
  private static readonly MAX_LOS_WAIT_MS = 3000;

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

  constructor(
    private readonly grid: GlobalRouteGridService,
    /** Anti-air retrofit researched: read at resolve time, not cached. */
    private readonly airTargetingUnlocked: () => boolean,
  ) {}

  /**
   * Work against the engine and game state of a (new) location.
   *
   * When tile-loading changes a cell's terrain sample — promoted
   * (heightSampled false → true) or refreshed (sampled → strictly-better
   * tile LOD) — any tower whose range covers it has stale LOS resolved
   * against the old terrainHeight. Listen for changed cells and recompute
   * LOS + viz mesh for just the affected towers, so the system self-heals
   * as tiles stream in without a full per-tower cache rebuild.
   */
  attach(engine: ThreeTilesEngine, gameState: GameStateManager): void {
    this.engine = engine;
    this.gameState = gameState;

    // attach() runs again on every location change while the grid is a
    // root singleton, so drop the previous subscription first — otherwise the
    // handler stacks up and each emit recomputes every affected tower's LOS
    // once per past location (a forced cubemap render each time).
    this.cellsChangedOff?.();
    this.cellsChangedOff = this.grid.addCellsChangedListener((changed) =>
      this.onCellsChanged(changed),
    );
    // Towers queued for the previous location went with its grid.
    this.staleLos.clear();
  }

  /** Unsubscribe, cancel a pending refresh and forget engine and game state. */
  detach(): void {
    this.cellsChangedOff?.();
    this.cellsChangedOff = null;
    if (this.losRefreshRaf !== null) {
      cancelAnimationFrame(this.losRefreshRaf);
      this.losRefreshRaf = null;
    }
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

    const config = TOWER_TYPES[typeId];
    if (!config) return;

    const terrainPos = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(
      tower.typeConfig.id as TowerTypeId,
      this.airTargetingUnlocked(),
    );

    // Refine cell-Y in the tower's range BEFORE LOS computation. This
    // promotes any still-unsampled cells in the tower's reach using the
    // current tile state, so the cubemap render sees accurate
    // terrainHeight values for sample-Y computation. Cheap: only walks
    // cells inside the radius.
    this.grid.refineCellsInRadius(terrainPos.x, terrainPos.z, config.range);

    const tipWorld = new Vector3(terrainPos.x, tipY, terrainPos.z);
    const ctx = this.buildLosResolveContext(tipWorld, config.range);
    if (!ctx) {
      console.warn('[TowerPlacementService] registerTowerOnGrid: no LOS blocker group');
      return;
    }

    const visibleCells = this.grid.registerTower(
      tower.id,
      terrainPos.x,
      terrainPos.z,
      config.range,
      ctx,
      canTargetGround,
      canTargetAir,
    );
    tower.visibleCells = visibleCells;
    tower.losReady = true;

    // Wenn dieser Tower bereits selected ist (z.B. nach Auto-Select beim
    // Place), die Selection-Viz vom TowerManager refreshen lassen.
    if (tower.selected) {
      this.gameState?.towerManager.refreshSelectionViz(tower);
    }
  }

  /**
   * Unregister a tower from the GlobalRouteGrid.
   */
  unregister(tower: Tower): void {
    // Selection-Viz wird vom TowerManager bereinigt (Owner-Pattern).
    this.gameState?.towerManager.onTowerUnregistered(tower);
    this.grid.unregisterTower(tower.id);
    this.staleLos.delete(tower);
    tower.visibleCells = [];
  }

  /**
   * Recompute a tower's LOS after some cells in its range changed their
   * terrain sample, or after its range grew. Uses incremental registration:
   * cells that still hold a cached entry for this tower keep it (no raycast);
   * the cells queued for it in `staleLos` drop theirs first and get
   * re-resolved against a fresh cubemap, like the cells new to its range.
   */
  recompute(tower: Tower): void {
    if (!this.engine || !this.grid.isInitialized()) return;

    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    if (!config) return;

    const position = tower.position;
    const terrainPos = this.engine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(
      tower.typeConfig.id as TowerTypeId,
      this.airTargetingUnlocked(),
    );

    const tipWorld = new Vector3(terrainPos.x, tipY, terrainPos.z);
    const ctx = this.buildLosResolveContext(tipWorld, tower.combat.range);
    if (!ctx) {
      console.warn('[TowerPlacementService] recomputeTowerLOS: no LOS blocker group');
      return;
    }

    // The queue entry is settled only here, once the recompute can run. One
    // that bails above stays queued and the drain retries it next frame:
    // dropped, its old answers would stay in the cells for good, because the
    // peek-skip keeps every later sweep from reporting those cells again. A
    // direct call (range upgrade) settles the entry as well.
    const stale = this.staleLos.get(tower);
    this.staleLos.delete(tower);
    if (stale) {
      for (const cell of stale.cells) {
        cell.towerVisibility.delete(tower.id);
        cell.airVisibility.delete(tower.id);
      }
    }

    // Incremental: only sample cells that don't already have a cached entry
    const before = tower.visibleCells.length;
    this.resolvingTower = tower;
    try {
      tower.visibleCells = this.grid.registerTowerIncremental(
        tower.id,
        terrainPos.x,
        terrainPos.z,
        tower.combat.range,
        ctx,
        canTargetGround,
        canTargetAir
      );
    } finally {
      this.resolvingTower = null;
    }
    this.reportLosDrop(tower, before, stale, ctx);

    // Selection-Viz refreshen, falls dieser Tower selected ist.
    if (tower.selected) {
      this.gameState?.towerManager.refreshSelectionViz(tower);
    }
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
  private reportLosDrop(tower: Tower, before: number, stale: StaleLosEntry | undefined, ctx: LosResolveContext): void {
    const after = tower.visibleCells.length;
    if (before < TowerLosRegistry.LOS_DROP_MIN_CELLS || after > before * TowerLosRegistry.LOS_DROP_LEFT_SHARE) {
      this.losDropLogged.delete(tower);
      return;
    }
    if (this.losDropLogged.has(tower)) return;
    this.losDropLogged.add(tower);

    const causes: string[] = [];
    if (stale?.explicit) causes.push('asked for');
    if (stale && stale.cells.size > 0) causes.push(`${stale.cells.size} cell heights changed`);
    const trigger = stale ? causes.join(', ') : 'direct call';
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
   * recompute in one of the next frames instead of right away, through the
   * same queue as the height changes. For callers inside an event handler
   * whose follow-up state the recompute has to see. Does not wait for a
   * running terrain sweep: there is nothing to coalesce.
   */
  scheduleRecompute(tower: Tower): void {
    const entry = this.staleLos.get(tower);
    if (entry) entry.explicit = true;
    else this.staleLos.set(tower, { cells: new Set(), since: performance.now(), explicit: true });
    this.scheduleLosRefresh();
  }

  private onCellsChanged(changed: RouteCell[]): void {
    if (!this.gameState || !this.engine || changed.length === 0) return;

    // The air-route tube caches cell terrainHeights at build time; without
    // a rebuild it visibly stays on the old (wrong) heights even after
    // cell promotions correct them. Debounced via rAF so a streaming burst
    // collapses to a single rebuild.
    if (!this.tubeRebuildScheduled) {
      this.tubeRebuildScheduled = true;
      requestAnimationFrame(() => {
        this.tubeRebuildScheduled = false;
        this.grid.rebuildAirRouteLayer();
      });
    }

    const towers = this.gameState.towerManager.getAll();
    if (towers.length === 0) return;

    // Precompute tower local positions to avoid N*M geo-to-local conversions.
    // A tower that is not registered yet has nothing stale: its registration
    // resolves every cell against the current height anyway. Neither has the
    // tower being resolved right now: the grid reports the cells it moved
    // after re-resolving them for that tower.
    const towerPositions: { tower: Tower; x: number; z: number; rangeSq: number }[] = [];
    for (const tower of towers) {
      if (!tower.losReady || tower === this.resolvingTower) continue;
      const lp = this.engine.sync.geoToLocalSimple(
        tower.position.lat, tower.position.lon, tower.position.height ?? 0,
      );
      towerPositions.push({
        tower, x: lp.x, z: lp.z,
        rangeSq: tower.combat.range * tower.combat.range,
      });
    }

    // For each changed cell, note the towers whose range covers it. Nothing
    // is recomputed here: during a budgeted sweep this runs once per slice,
    // and recomputing per slice re-rendered the same tower's cubemap in every
    // frame of the sweep.
    const now = performance.now();
    for (const cell of changed) {
      for (const t of towerPositions) {
        const distSq = (cell.x - t.x) ** 2 + (cell.z - t.z) ** 2;
        if (distSq > t.rangeSq) continue;
        let entry = this.staleLos.get(t.tower);
        if (!entry) {
          entry = { cells: new Set(), since: now, explicit: false };
          this.staleLos.set(t.tower, entry);
        }
        entry.cells.add(cell);
      }
    }
    if (this.staleLos.size > 0) this.scheduleLosRefresh();
  }

  /** Schedule the next drainLosRefresh, at most one frame callback at a time. */
  private scheduleLosRefresh(): void {
    if (this.losRefreshRaf !== null) return;
    this.losRefreshRaf = requestAnimationFrame(() => {
      this.losRefreshRaf = null;
      this.drainLosRefresh();
    });
  }

  /**
   * Recompute the towers queued in `staleLos`. While a budgeted terrain sweep
   * is in flight, entries for changed cells wait, the same way the route-line
   * refresh does: the sweep reports its changes slice by slice, so a tower
   * covered by several slices would otherwise pay for a forced cubemap render
   * plus face readback once per slice. After the sweep each tower runs once,
   * with all its cells, spread over the following frames
   * (LOS_RECOMPUTES_PER_FRAME). Explicit requests do not wait, and no entry
   * waits longer than MAX_LOS_WAIT_MS.
   */
  private drainLosRefresh(): void {
    const sweeping = this.grid.isTerrainRefreshActive();
    const now = performance.now();
    let budget = TowerLosRegistry.LOS_RECOMPUTES_PER_FRAME;
    for (const [tower, entry] of this.staleLos) {
      if (sweeping && !entry.explicit && now - entry.since < TowerLosRegistry.MAX_LOS_WAIT_MS) continue;
      // recompute takes the tower out of the queue.
      this.recompute(tower);
      if (--budget === 0) break;
    }
    if (this.staleLos.size > 0) this.scheduleLosRefresh();
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
