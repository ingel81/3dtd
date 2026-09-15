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

/**
 * Per-tower line of sight on the GlobalRouteGrid: registers a placed tower
 * (cubemap render from its tip, GPU resolve of the cells in range) and
 * unregisters it. The cells are the ones the corridor build froze, so the
 * answers hold for as long as the tower stands; only a research retrofit or
 * a range upgrade asks for a recompute. TowerPlacementService owns one and
 * exposes these as its grid-registration API.
 */
export class TowerLosRegistry {
  private engine: ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;

  /**
   * Towers a caller asked a recompute for (scheduleRecompute: the air
   * retrofit of a research), worked off by drainLosRefresh. The old answers
   * stay in the cells until the recompute replaces them: a stale answer for
   * a second beats no answer, which would send every candidate in those
   * cells down the CPU-raycast fallback of the combat loop.
   */
  private readonly staleLos = new Set<Tower>();
  private losRefreshRaf: number | null = null;

  /**
   * LOS recomputes per frame. Each one is a forced cubemap render plus the
   * face readback; a big zoom-in refreshes hundreds of cells under every
   * tower at once, and running all of those towers in one frame blocked the
   * main thread for 1-2 s.
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

  constructor(
    private readonly grid: GlobalRouteGridService,
    /** Anti-air retrofit researched: read at resolve time, not cached. */
    private readonly airTargetingUnlocked: () => boolean,
  ) {}

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

  /** Cancel a pending refresh and forget engine and game state. */
  detach(): void {
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

    // The cells and their heights are the ones the corridor build froze
    // (CorridorBuild): the tower registers its answers on them once.
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
   * Recompute a tower's LOS after it gained air targets or its range grew.
   * Uses incremental registration: cells that still hold a cached entry for
   * this tower keep it (no cube sample), cells new to its range and the
   * capability it just gained are resolved against a fresh cubemap.
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
    // dropped, its old answers would stay in the cells for good. A direct
    // call (range upgrade) settles the entry as well.
    const queued = this.staleLos.delete(tower);

    // Incremental: only sample cells that don't already have a cached entry
    const before = tower.visibleCells.length;
    tower.visibleCells = this.grid.registerTowerIncremental(
      tower.id,
      terrainPos.x,
      terrainPos.z,
      tower.combat.range,
      ctx,
      canTargetGround,
      canTargetAir,
    );
    this.reportLosDrop(tower, before, queued, ctx);

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
   * recompute in one of the next frames instead of right away. For callers
   * inside an event handler whose follow-up state the recompute has to see
   * (the research that hands a tower air targets applies the unlock after
   * its own handlers ran).
   */
  scheduleRecompute(tower: Tower): void {
    this.staleLos.add(tower);
    this.scheduleLosRefresh();
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
   * Recompute the towers queued in `staleLos`, one per frame
   * (LOS_RECOMPUTES_PER_FRAME): each is a forced cubemap render plus the
   * face readback.
   */
  private drainLosRefresh(): void {
    let budget = TowerLosRegistry.LOS_RECOMPUTES_PER_FRAME;
    for (const tower of [...this.staleLos]) {
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
