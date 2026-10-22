import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { TowerLosViz } from '../utils/tower-los-viz';
import { losLayerCapacity } from '../utils/tower-los-layer-builder';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import { losPerf } from '../utils/los-perf';

/** Which answers the per-tower LOS viz shows. */
export type LosFilterMode = Parameters<TowerLosViz['setFilterMode']>[0];

/**
 * GPU-LOS-Viz für die Build-Preview. Lifecycle: erzeugt beim ersten validen
 * Cursor-Hover, bei jeder Bewegung über die Schwelle an den neuen Ort
 * versetzt (neue Zellen in dieselben Meshes, TowerLosViz.moveTo), auf einem
 * ungültigen Platz oder ohne Zellen verborgen, neu gebaut nur für einen
 * anderen Tower-Typ (Reichweite, Ziele), disposed beim Verlassen des
 * Build-Mode. Lesson 9 — niemals parallel zur Selection-Viz.
 */
export class BuildPreviewLos {
  private viz: TowerLosViz | null = null;
  /** Typ und Ziele, für die die Viz gebaut ist: ein anderer baut sie neu. */
  private vizKey = '';
  /** Ob die Viz gerade zu sehen ist (verborgen tickt sie nicht). */
  private shown = false;
  /** Zuletzt für die Preview-Viz verwendete Tower-XZ — als Move-Schwelle. */
  private lastX = 0;
  private lastZ = 0;

  /** Bewegung in m bevor das Cell-Set neu gesammelt wird. */
  private static readonly REBUILD_THRESHOLD_M = 1.0;

  constructor(
    private readonly grid: GlobalRouteGridService,
    /** Anti-air retrofit researched: read on every update. */
    private readonly airTargetingUnlocked: () => boolean,
  ) {}

  /**
   * GPU-LOS-Preview-Viz aktualisieren. Wenn die Tower-XZ-Position sich
   * mehr als REBUILD_THRESHOLD verschoben hat → Cell-Set ändert sich, also
   * die Zellen neu sammeln und die Viz versetzen. Sonst nur den
   * TowerTip-Uniform refreshen (triggert auch das move-gated Cube-Render im
   * Mapper). `filterMode` gilt für eine neu gebaute Viz.
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
    const key = `${typeId}|${canTargetGround}|${canTargetAir}`;
    if (this.viz && key !== this.vizKey) this.dispose();

    // The cells are the ones the corridor build froze (CorridorBuild); the
    // preview draws those with a height (getCellsInRange filters on
    // `heightSampled`) and samples none of its own.

    // Move-Schwelle: nur bei größerer Bewegung die Zellen neu sammeln
    const movedSq =
      (local.x - this.lastX) ** 2 +
      (local.z - this.lastZ) ** 2;
    const threshold = BuildPreviewLos.REBUILD_THRESHOLD_M;
    const needsCells =
      !this.viz ||
      !this.shown ||
      movedSq > threshold * threshold;

    const tipWorld = new Vector3(local.x, tipY, local.z);

    if (!needsCells && this.viz) {
      const tTipStart = performance.now();
      this.viz.updateTowerTip(tipWorld);
      losPerf.sample('preview/tip-only', performance.now() - tTipStart);
      return;
    }

    const blockerGroup = engine.getLosBlockerGroup();
    if (!blockerGroup) {
      this.hide();
      return;
    }
    const tGetStart = performance.now();
    const cells = this.grid.getCellsInRange(
      local.x, local.z, range,
    );
    losPerf.sample('preview/getCells', performance.now() - tGetStart, cells.length);
    if (cells.length === 0) {
      this.hide();
      return;
    }

    this.lastX = local.x;
    this.lastZ = local.z;
    this.shown = true;
    if (this.viz) {
      this.viz.moveTo(tipWorld, cells);
      this.viz.setVisible(true);
      return;
    }

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
      capacity: losLayerCapacity(range, this.grid.getCellSize()),
      standY: (cell) => this.grid.getCellStandY(cell),
    });
    this.vizKey = key;
    // Apply current per-tower-LOS filter directly — the reactive effect
    // would only fire on signal changes, not on viz (re)creation.
    this.viz.setFilterMode(filterMode);
    this.viz.addTo(engine.getScene());
  }

  /** Apply a new per-tower LOS filter to the viz, if there is one. */
  setFilterMode(mode: LosFilterMode): void {
    this.viz?.setFilterMode(mode);
  }

  /** Per-Frame-Tick für die GPU-LOS-Preview-Pulse-Animation. */
  tick(timeSeconds: number): void {
    if (this.shown) this.viz?.tick(timeSeconds);
  }

  /**
   * Verbirgt die Viz (ungültiger Platz), behält Meshes und Materialien für
   * den nächsten gültigen: dort wird sie versetzt, nicht neu gebaut.
   */
  hide(): void {
    this.shown = false;
    this.viz?.setVisible(false);
  }

  /**
   * Dispose the active GPU-LOS preview viz, if any.
   */
  dispose(): void {
    this.shown = false;
    if (this.viz) {
      this.viz.dispose();
      this.viz = null;
    }
  }
}
