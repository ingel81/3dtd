import { Injectable, computed, signal } from '@angular/core';
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { TowerShadowMapper } from '../../three-engine/tower-shadow-mapper';
import { ThreeTilesEngine } from '../../three-engine';
import { TowerManager } from '../../managers/tower.manager';
import { GameEventBus, SubscriptionBag } from '../../game-engine';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { Tower } from '../../entities/tower.entity';
import { RouteCell, getAirTargetY } from '../../utils/global-route-grid';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { LOS_VIZ_CONFIG } from '../../configs/los-viz.config';
import { directionToFacePixel, FacePixel } from '../../utils/los-debug-pixel-math';

/**
 * State der Hovered-Pixel-Koordinate auf einem Cubemap-Face. `layer`
 * unterscheidet ob die Cells beim Hover als Ground- oder Air-Sample
 * gegen die Cubemap geprüft werden — beide nutzen dieselbe Cube, aber
 * unterschiedliche Sample-Y per Cell.
 */
export interface HoveredPixelState {
  face: number;
  px: number;
  py: number;
  layer: 'ground' | 'air';
}

/**
 * Per-Cell Lookup-Eintrag — die `pixel`-Position ist die {@link
 * directionToFacePixel} der Cell-Direction von Tower-Tip auf
 * (cell.x, sampleY, cell.z).
 */
interface CellPixelEntry {
  cell: RouteCell;
  groundPixel: FacePixel;
  airPixel: FacePixel;
}

const HOVER_MARKER_GEOMETRY = new SphereGeometry(0.8, 12, 8);

/**
 * Stateful service that orchestrates the LOS-debug-panel:
 *  - tracks the active tower (from the TowerManager's selection)
 *  - exposes a wrapper around {@link TowerShadowMapper.getFaceImageData}
 *  - maintains a pixel→cell lookup so the Canvas-hover can show "which
 *    cells project onto this Cubemap texel"
 *  - drives a small 3D-marker (Sphere) in the scene that visualises the
 *    cell currently hovered in the panel
 *
 * The service is **decoupled** from the LOS-Viz-Pipeline ownership rules
 * (Build-Preview vs. Selection mutex) — it inspects whatever the active
 * tower's Cubemap currently contains.
 */
@Injectable({ providedIn: 'root' })
export class LosDebugService {
  private engine: ThreeTilesEngine | null = null;
  private towerManager: TowerManager | null = null;
  private eventBus: GameEventBus | null = null;
  private globalRouteGrid: GlobalRouteGridService | null = null;

  /** Currently active tower for inspection. Mirrors TowerManager selection. */
  private readonly _activeTower = signal<Tower | null>(null);
  readonly activeTower = this._activeTower.asReadonly();

  /** Tower-Tip in World-Space — used by the panel for the hover-readout. */
  private readonly _towerTip = signal<Vector3 | null>(null);
  readonly towerTip = this._towerTip.asReadonly();

  /** Cells currently within range, with their projected pixels. */
  private readonly _cellEntries = signal<CellPixelEntry[]>([]);
  readonly cellCount = computed(() => this._cellEntries().length);

  /** Hovered pixel coordinate (canvas → service). */
  private readonly _hoveredPixel = signal<HoveredPixelState | null>(null);
  readonly hoveredPixel = this._hoveredPixel.asReadonly();

  /**
   * Aktiver Inspect-Layer — Master-State für Sample-Y-Wahl beim
   * Projizieren von Cells. Wird vom Panel-Toggle gesetzt und ist
   * unabhängig davon ob aktuell ein Pixel/Cell gehovert ist. Sowohl
   * `setHoveredPixel` als auch `setHoveredCell` lesen daraus, sodass
   * der Toggle IMMER gewinnt — egal woher der Hover kommt.
   */
  private readonly _activeLayer = signal<'ground' | 'air'>('ground');
  readonly activeLayer = this._activeLayer.asReadonly();

  /** Hovered cell (panel cell-list / picking → service). */
  private readonly _hoveredCell = signal<RouteCell | null>(null);
  readonly hoveredCell = this._hoveredCell.asReadonly();

  /** Cells whose direction maps to {@link hoveredPixel}. */
  readonly cellsAtHoveredPixel = computed<RouteCell[]>(() => {
    const pix = this._hoveredPixel();
    if (!pix) return [];
    const entries = this._cellEntries();
    const out: RouteCell[] = [];
    for (const entry of entries) {
      const target = pix.layer === 'air' ? entry.airPixel : entry.groundPixel;
      if (target.face === pix.face && target.px === pix.px && target.py === pix.py) {
        out.push(entry.cell);
      }
    }
    return out;
  });

  /**
   * `enabled` reflects whether the panel window is open. When false the
   * service skips marker updates and cell-map rebuilds to stay free of
   * cost when nobody is looking.
   */
  private readonly _enabled = signal<boolean>(false);
  readonly enabled = this._enabled.asReadonly();

  /** 3D marker for the hovered cell — added/removed from scene on demand. */
  private hoverMarker: Mesh | null = null;
  private hoverMarkerScene: Scene | null = null;
  private hoverMarkerGroup: Group | null = null;

  // Reverse-Hover (3D-Cell-Picking → Cubemap-Marker). Document-weiter
  // Mousemove-Listener; aktiv nur solange das Panel offen ist.
  private readonly pickRaycaster = new Raycaster();
  private readonly pickPointer = new Vector2();
  private pickListener: ((event: MouseEvent) => void) | null = null;
  private pickHostCanvas: HTMLCanvasElement | null = null;

  /** Event-bus subscriptions — disposed and rebuilt on every initialize(). */
  private readonly subs = new SubscriptionBag();

  initialize(
    engine: ThreeTilesEngine,
    towerManager: TowerManager,
    eventBus: GameEventBus,
    globalRouteGrid: GlobalRouteGridService,
  ): void {
    // initialize() runs again on every location change — drop the previous
    // subscriptions so listeners don't accumulate (N×3 leak otherwise).
    this.subs.disposeAll();

    this.engine = engine;
    this.towerManager = towerManager;
    this.eventBus = eventBus;
    this.globalRouteGrid = globalRouteGrid;

    this.subs.add(
      eventBus.on('tower:selected', (e) => {
        const tower = (e as { tower: Tower }).tower;
        this.onTowerSelected(tower);
      }),
    );
    this.subs.add(eventBus.on('tower:deselected', () => this.onTowerDeselected()));
    this.subs.add(
      eventBus.on('tower:sold', (e) => {
        const sold = e as { tower: Tower };
        if (this._activeTower()?.id === sold.tower.id) this.onTowerDeselected();
      }),
    );

    // If a tower is already selected at init time pull its state.
    const preSelected = towerManager.getSelected();
    if (preSelected) this.onTowerSelected(preSelected);
  }

  setEnabled(on: boolean): void {
    this._enabled.set(on);
    if (!on) {
      this.removeHoverMarker();
      this.detachPickListener();
    } else {
      // refresh once when re-enabled
      const t = this._activeTower();
      if (t) this.rebuildCellEntries(t);
      this.attachPickListener();
    }
  }

  /**
   * Forces a recomputation of the cell-pixel map for the active tower.
   * Useful after the panel detects a Cubemap re-render (e.g. on tile
   * load) or when range upgrades change the cell set.
   */
  refreshCellMap(): void {
    const t = this._activeTower();
    if (t) this.rebuildCellEntries(t);
  }

  /** The mapper the panel reads from. Null if no engine wired up. */
  getMapper(): TowerShadowMapper | null {
    return this.engine?.getTowerShadowMapper() ?? null;
  }

  /** Cubemap face size in texels — single source for canvas math. */
  getFaceSize(): number {
    return LOS_VIZ_CONFIG.cubeSize;
  }

  setHoveredPixel(pix: HoveredPixelState | null): void {
    this._hoveredPixel.set(pix);
    // pix.layer ist redundant zu activeLayer, sollte aber konsistent
    // bleiben — Canvas-Hover schreibt den Toggle-Wert hier rein.
    if (pix && pix.layer !== this._activeLayer()) {
      this._activeLayer.set(pix.layer);
    }
    if (pix) {
      const cells = this.cellsAtHoveredPixel();
      this._hoveredCell.set(cells[0] ?? null);
    } else {
      this._hoveredCell.set(null);
    }
    this.updateHoverMarker();
  }

  setHoveredCell(cell: RouteCell | null): void {
    this._hoveredCell.set(cell);
    if (cell) {
      const entry = this._cellEntries().find((e) => e.cell.key === cell.key);
      if (entry) {
        // Toggle-Master: activeLayer entscheidet welche Pixel-Projektion
        // wir setzen. Reverse-Hover folgt also dem Toggle, NICHT dem
        // gepickten Mesh-Typ.
        const layer = this._activeLayer();
        const target = layer === 'air' ? entry.airPixel : entry.groundPixel;
        this._hoveredPixel.set({ face: target.face, px: target.px, py: target.py, layer });
      }
    }
    this.updateHoverMarker();
  }

  /**
   * Setzt den aktiven Inspect-Layer ('ground' vs 'air'). Wird vom Panel-
   * Toggle aufgerufen. Re-projiziert die aktuell gehoverte Cell auf den
   * neuen Layer (Pixel + 3D-Marker wandern entsprechend).
   */
  setActiveLayer(layer: 'ground' | 'air'): void {
    if (this._activeLayer() === layer) return;
    this._activeLayer.set(layer);
    // Sync mit hoveredPixel falls vorhanden (Pixel selber bleibt, nur Layer-Tag)
    const pix = this._hoveredPixel();
    if (pix) this._hoveredPixel.set({ ...pix, layer });
    // Re-project hovered cell auf den neuen Layer
    const cell = this._hoveredCell();
    if (cell) this.setHoveredCell(cell);
    else this.updateHoverMarker();
  }

  /** Returns the pre-computed pixel for `cell` on the chosen layer. */
  getCellPixel(cell: RouteCell, layer: 'ground' | 'air'): FacePixel | null {
    const entry = this._cellEntries().find((e) => e.cell.key === cell.key);
    if (!entry) return null;
    return layer === 'air' ? entry.airPixel : entry.groundPixel;
  }

  /** All cell entries (for the panel's cell list). */
  getCellEntries(): readonly CellPixelEntry[] {
    return this._cellEntries();
  }

  // ----- internal -----

  private onTowerSelected(tower: Tower): void {
    this._activeTower.set(tower);
    this.computeTowerTip(tower);
    this.rebuildCellEntries(tower);
  }

  private onTowerDeselected(): void {
    this._activeTower.set(null);
    this._towerTip.set(null);
    this._cellEntries.set([]);
    this._hoveredPixel.set(null);
    this._hoveredCell.set(null);
    this.removeHoverMarker();
  }

  private computeTowerTip(tower: Tower): void {
    if (!this.engine) return;
    const config = TOWER_TYPES[tower.typeConfig.id as TowerTypeId];
    if (!config) return;
    const localPos = this.engine.sync.geoToLocalSimple(
      tower.position.lat,
      tower.position.lon,
      tower.position.height ?? 0,
    );
    const tipY = localPos.y + config.heightOffset + config.shootHeight;
    this._towerTip.set(new Vector3(localPos.x, tipY, localPos.z));
  }

  private rebuildCellEntries(tower: Tower): void {
    if (!this.globalRouteGrid || !this.engine) return;
    const tip = this._towerTip();
    if (!tip) return;

    const range = tower.combat.range;
    const cells = this.globalRouteGrid
      .getGrid()
      .getCellsInRange(tip.x, tip.z, range);

    const size = LOS_VIZ_CONFIG.cubeSize;
    const entries: CellPixelEntry[] = new Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const groundY = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
      const airY = getAirTargetY(cell);
      const groundPixel = directionToFacePixel(
        cell.x - tip.x,
        groundY - tip.y,
        cell.z - tip.z,
        size,
      );
      const airPixel = directionToFacePixel(
        cell.x - tip.x,
        airY - tip.y,
        cell.z - tip.z,
        size,
      );
      entries[i] = { cell, groundPixel, airPixel };
    }
    this._cellEntries.set(entries);
  }

  private updateHoverMarker(): void {
    if (!this._enabled() || !this.engine) {
      this.removeHoverMarker();
      return;
    }
    const cell = this._hoveredCell();
    if (!cell) {
      if (this.hoverMarker) this.hoverMarker.visible = false;
      return;
    }
    this.ensureHoverMarker();
    if (!this.hoverMarker) return;
    const layer = this._activeLayer();
    const y = layer === 'air' ? getAirTargetY(cell) : cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
    this.hoverMarker.position.set(cell.x, y, cell.z);
    this.hoverMarker.visible = true;
  }

  private ensureHoverMarker(): void {
    if (this.hoverMarker || !this.engine) return;
    const scene = this.engine.getScene();
    const group = new Group();
    group.name = 'los-debug-hover-marker';
    const material = new MeshBasicMaterial({
      color: new Color(1.0, 0.25, 0.85),
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(HOVER_MARKER_GEOMETRY, material);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    group.add(mesh);
    scene.add(group);
    this.hoverMarker = mesh;
    this.hoverMarkerGroup = group;
    this.hoverMarkerScene = scene;
  }

  private removeHoverMarker(): void {
    if (this.hoverMarkerGroup && this.hoverMarkerScene) {
      this.hoverMarkerScene.remove(this.hoverMarkerGroup);
    }
    if (this.hoverMarker) {
      (this.hoverMarker.material as MeshBasicMaterial).dispose();
    }
    this.hoverMarker = null;
    this.hoverMarkerGroup = null;
    this.hoverMarkerScene = null;
  }

  // ----- Reverse-Hover: 3D-Cell-Picking -----

  private attachPickListener(): void {
    if (this.pickListener || !this.engine) return;
    const canvas = this.engine.getRenderer().domElement;
    this.pickHostCanvas = canvas;
    this.pickListener = (e: MouseEvent) => this.onCanvasMousemove(e);
    canvas.addEventListener('mousemove', this.pickListener);
  }

  private detachPickListener(): void {
    if (!this.pickListener || !this.pickHostCanvas) return;
    this.pickHostCanvas.removeEventListener('mousemove', this.pickListener);
    this.pickListener = null;
    this.pickHostCanvas = null;
  }

  /**
   * Mouse-Move auf dem Spiel-Canvas: raycaste gegen die Plates der
   * Selection-Viz des aktiven Towers. Trifft eine Plate → setHoveredCell
   * (das wiederum Pixel + 3D-Marker syncronisiert). Trifft nichts →
   * Hover beibehalten (Reverse-Hover ist additive zum Canvas-Hover —
   * würden wir hier auf null setzen, würde jeder Mausschwenk außerhalb
   * der Plates den Canvas-Hover killen).
   */
  private onCanvasMousemove(event: MouseEvent): void {
    if (!this.towerManager || !this.engine) return;
    const viz = this.towerManager.getSelectionViz();
    const layer = viz?.getLayer();
    if (!viz || !layer) return;

    const canvas = this.pickHostCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.pickPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pickPointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

    const camera = this.engine.getCamera();
    this.pickRaycaster.setFromCamera(this.pickPointer, camera);

    // Nur die TATSÄCHLICH sichtbaren Plates picken — Three.js' Raycaster
    // ignoriert `object.visible=false` per default, deshalb müssen wir
    // hidden Meshes hier explizit aus der Target-Liste filtern. Sonst
    // würde im 'ground'-Filter-Mode das (unsichtbare, aber höher
    // liegende) Air-Mesh die Ground-Plate übersteuern und der Reverse-
    // Hover liefert das falsche Layer-Sample.
    const targets = [];
    if (layer.groundMesh.visible) targets.push(layer.groundMesh);
    if (layer.airMesh.visible) targets.push(layer.airMesh);
    if (targets.length === 0) return;
    const hits = this.pickRaycaster.intersectObjects(targets, false);
    if (hits.length === 0) return;

    const hit = hits[0];
    const instanceId = hit.instanceId;
    if (instanceId == null) return;
    const cell = layer.cells[instanceId];
    if (!cell) return;

    // Wichtig: der Hit-Mesh (ground vs air) bestimmt NICHT den Inspect-
    // Layer. Der Panel-Toggle ist der Master — wenn der User explizit
    // auf 'air' geschaltet hat, soll auch ein Hit auf der Ground-Plate
    // die Air-Sample der gehoverten Cell zeigen. setHoveredCell liest
    // den Layer aus `_hoveredPixel().layer` (das vom Component-Toggle
    // gesetzt wird) und projiziert entsprechend.
    this.setHoveredCell(cell);
  }
}
