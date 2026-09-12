import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { TowerLosViz } from '../utils/tower-los-viz';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import { losPerf } from '../utils/los-perf';

/** Which answers the per-tower LOS viz shows. */
export type LosFilterMode = Parameters<TowerLosViz['setFilterMode']>[0];

/**
 * GPU-LOS-Viz für die Build-Preview. Lifecycle: erzeugt bei erstem
 * validen Cursor-Hover, neu gebaut bei jedem Mouse-Move (das Cell-Set
 * ändert sich mit der Tower-Position), disposed beim Verlassen des
 * Build-Mode. Lesson 9 — niemals parallel zur Selection-Viz.
 */
export class BuildPreviewLos {
  private viz: TowerLosViz | null = null;
  /** Zuletzt für die Preview-Viz verwendete Tower-XZ — als Move-Schwelle. */
  private lastX = 0;
  private lastZ = 0;

  /** Bewegung in m bevor das Cell-Set neu gebaut wird. */
  private static readonly REBUILD_THRESHOLD_M = 1.0;

  constructor(
    private readonly grid: GlobalRouteGridService,
    /** Anti-air retrofit researched: read on every update. */
    private readonly airTargetingUnlocked: () => boolean,
  ) {}

  /**
   * GPU-LOS-Preview-Viz aktualisieren. Wenn die Tower-XZ-Position sich
   * mehr als REBUILD_THRESHOLD verschoben hat → Cell-Set ändert sich,
   * also komplett neu bauen. Sonst nur den TowerTip-Uniform refreshen
   * (triggert auch das move-gated Cube-Render im Mapper). `filterMode`
   * gilt für eine neu gebaute Viz.
   */
  update(
    engine: ThreeTilesEngine,
    lat: number,
    lon: number,
    height: number,
    typeId: TowerTypeId,
    filterMode: LosFilterMode,
  ): void {
    if (!this.grid.isInitialized()) return;

    const config = TOWER_TYPES[typeId];
    if (!config) return;

    const local = engine.sync.geoToLocalSimple(lat, lon, height);
    const tipY = local.y + config.heightOffset + config.shootHeight;

    const canTargetGround = config.canTargetGround ?? true;
    const canTargetAir = canTargetAirEffective(typeId, this.airTargetingUnlocked());
    const range = config.range;

    // Cells in der Cursor-Region zu `stable` promoten falls noch nicht
    // gesampelt — sonst tauchen sie nicht in der Viz auf (getCellsInRange
    // filtert auf `heightSampled`). Schmal-Variante: stabile Cells werden
    // übersprungen, also kein Raycast pro Move. LOD-Upgrades für stabile
    // Cells laufen separat über den Tile-Streaming-Pfad.
    const tPromoteStart = performance.now();
    this.grid.promoteUnsampledCellsInRadius(
      local.x, local.z, range,
    );
    losPerf.sample('preview/promote', performance.now() - tPromoteStart);

    // Move-Schwelle: nur bei größerer Bewegung neu bauen
    const movedSq =
      (local.x - this.lastX) ** 2 +
      (local.z - this.lastZ) ** 2;
    const threshold = BuildPreviewLos.REBUILD_THRESHOLD_M;
    const needsRebuild =
      !this.viz ||
      movedSq > threshold * threshold;

    const tipWorld = new Vector3(local.x, tipY, local.z);

    if (!needsRebuild && this.viz) {
      const tTipStart = performance.now();
      this.viz.updateTowerTip(tipWorld);
      losPerf.sample('preview/tip-only', performance.now() - tTipStart);
      return;
    }

    // Komplett neu bauen — Cell-Set neu sammeln.
    this.dispose();

    const blockerGroup = engine.getLosBlockerGroup();
    if (!blockerGroup) return;
    const tGetStart = performance.now();
    const cells = this.grid.getCellsInRange(
      local.x, local.z, range,
    );
    losPerf.sample('preview/getCells', performance.now() - tGetStart, cells.length);
    if (cells.length === 0) return;

    this.viz = new TowerLosViz({
      cells,
      towerTip: tipWorld,
      groundRange: range,
      airRange: range,
      canTargetGround,
      canTargetAir,
      gridCellSize: this.grid.getCellSize(),
      shadowMapper: engine.getTowerShadowMapper(),
      blockerGroup,
    });
    // Apply current per-tower-LOS filter directly — the reactive effect
    // would only fire on signal changes, not on viz (re)creation.
    this.viz.setFilterMode(filterMode);
    this.viz.addTo(engine.getScene());
    this.lastX = local.x;
    this.lastZ = local.z;
  }

  /** Apply a new per-tower LOS filter to the viz, if there is one. */
  setFilterMode(mode: LosFilterMode): void {
    this.viz?.setFilterMode(mode);
  }

  /** Per-Frame-Tick für die GPU-LOS-Preview-Pulse-Animation. */
  tick(timeSeconds: number): void {
    this.viz?.tick(timeSeconds);
  }

  /**
   * Dispose the active GPU-LOS preview viz, if any.
   */
  dispose(): void {
    if (this.viz) {
      this.viz.dispose();
      this.viz = null;
    }
  }
}
