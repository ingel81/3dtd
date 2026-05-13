import { Group, Object3D, Scene, Vector3 } from 'three';
import type { RouteCell } from './global-route-grid';
import { TowerLosLayer, TowerLosLayerBuilder } from './tower-los-layer-builder';
import { TowerShadowMapper } from '../three-engine/tower-shadow-mapper';

export interface TowerLosVizOptions {
  /** Bereits gefilterte Cells (heightSampled === true, in Range). */
  cells: RouteCell[];
  /** Tower-Tip in World-Space. */
  towerTip: Vector3;
  /** Horizontale Reichweite (Ground). */
  groundRange: number;
  /** Horizontale Reichweite (Air). */
  airRange: number;
  canTargetGround: boolean;
  canTargetAir: boolean;
  /** CELL_SIZE des Grids in m (für die Plattenbreite der Cell-Mesh). */
  gridCellSize: number;
  /** Shared Mapper aus der Engine. */
  shadowMapper: TowerShadowMapper;
  /** Group die als `includeOnly` für den Cube-Render durchgereicht wird. */
  blockerGroup: Object3D;
}

/**
 * TowerLosViz — Composite aus TowerShadowMapper + TowerLosLayer.
 *
 * Owner: die Stelle die die Viz angefordert hat (Build-Preview oder
 * Tower-Selection). Sie hält genau eine Instance pro aktiver Viz und
 * disposed sie beim Schließen.
 *
 * Lesson 9 (v2) — Build-Preview und Selection-Viz teilen sich einen
 * shared TowerShadowMapper. Sie dürfen NICHT gleichzeitig leben, sonst
 * "klaut" der eine dem anderen die Cubemap. Mutex liegt in der Aufruf-
 * stelle (TowerPlacementService deselected vor build mode, Selection
 * deselected vor anderem select).
 */
export class TowerLosViz {
  readonly group: Group;
  private layer: TowerLosLayer | null = null;
  private readonly shadowMapper: TowerShadowMapper;
  private readonly blockerGroup: Object3D;
  private readonly towerTip = new Vector3();
  private readonly maxRange: number;
  private disposed = false;

  constructor(opts: TowerLosVizOptions) {
    this.group = new Group();
    this.shadowMapper = opts.shadowMapper;
    this.blockerGroup = opts.blockerGroup;
    this.towerTip.copy(opts.towerTip);
    this.maxRange = Math.max(opts.groundRange, opts.airRange);

    // Erste Cubemap-Render — füttert dann den Layer-Build.
    this.shadowMapper.update(this.towerTip, this.maxRange, this.blockerGroup);

    this.layer = TowerLosLayerBuilder.build({
      cells: opts.cells,
      towerTip: this.towerTip,
      groundRange: opts.groundRange,
      airRange: opts.airRange,
      canTargetGround: opts.canTargetGround,
      canTargetAir: opts.canTargetAir,
      cubemap: this.shadowMapper.getRenderTarget(),
      cubemapFarDistance: this.shadowMapper.getFarDistance(),
      gridCellSize: opts.gridCellSize,
    });

    if (this.layer) {
      this.group.add(this.layer.groundMesh);
      this.group.add(this.layer.airMesh);
    }
  }

  /**
   * Tower-Position aktualisieren (z.B. bei Build-Preview-Mouse-Move).
   * Triggert einen Cube-Render (move-gated im Mapper) und refresht das
   * `uTowerTip`-Uniform im Cell-Shader. Setzt KEIN Mesh-Rebuild — der
   * Caller muss bei zellen-set-ändernder Bewegung `rebuild()` aufrufen.
   */
  updateTowerTip(tip: Vector3): void {
    if (this.disposed) return;
    this.towerTip.copy(tip);
    this.shadowMapper.update(this.towerTip, this.maxRange, this.blockerGroup);
    this.layer?.updateMapperReference(
      this.shadowMapper.getReferencePos() as Vector3,
      this.shadowMapper.getFarDistance(),
    );
  }

  /** Animation-Tick — refresht `uTime`. */
  tick(timeSeconds: number): void {
    this.layer?.tick(timeSeconds);
  }

  /**
   * Layer-Filter: setzt Shader-Filter-Mode + Mesh-Visibility in
   * Lockstep. Owner (TowerPlacementService / TowerManager) ruft das
   * auf wenn der `perTowerLosFilter`-Signal sich ändert oder direkt
   * nach Konstruktion um den persistierten Zustand anzuwenden.
   */
  setFilterMode(mode: 'both' | 'ground' | 'air'): void {
    this.layer?.setFilterMode(mode);
  }

  /** In die Scene einhängen. Caller entscheidet wo (Scene-Root vs Group). */
  addTo(scene: Scene | Object3D): void {
    scene.add(this.group);
  }

  /** Aus der Scene entfernen. */
  removeFrom(scene: Scene | Object3D): void {
    scene.remove(this.group);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.layer) {
      this.group.remove(this.layer.groundMesh);
      this.group.remove(this.layer.airMesh);
      this.layer.dispose();
      this.layer = null;
    }
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
