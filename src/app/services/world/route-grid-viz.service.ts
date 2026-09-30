import { Injectable, inject } from '@angular/core';
import { Group, InstancedMesh, Mesh, MeshBasicMaterial, Scene, SphereGeometry, Vector3 } from 'three';
import { GlobalRouteGridService } from './global-route-grid.service';
import { buildRouteAltitudeTubes, disposeRouteAltitudeTubes } from '../../utils/route-altitude-tubes';
import { RouteGridSelectionViz } from '../../utils/route-grid-selection-viz';
import type { PortalClipUniforms } from '../../three-engine/renderers/portal-clip';
import type { GeoPosition } from '../../models/game.types';
import type { RouteCell } from '../../utils/route-cell';
import { UIStore } from '../../store/ui.store';

/**
 * The debug overlays of the main thread's route grid (GlobalRouteGridService):
 * the Route Grid Overlay on the ground and at air height, the cell report's
 * frames, the air-route tube and the defense reach marker. Split off the grid
 * so the simulation's grid has no scene and no UI store; the overlays follow
 * the grid's cells (onCellsChanged).
 */
@Injectable({ providedIn: 'root' })
export class RouteGridVizService {
  private readonly uiStore = inject(UIStore);
  private readonly gridService = inject(GlobalRouteGridService);

  private scene: Scene | null = null;

  // The spawn portals' clip (ThreeTilesEngine.portalClip): the Route Grid Overlay ends at their planes
  private portalClip: PortalClipUniforms | undefined;

  // Debug: defense reach marker (orange sphere)
  private defenseReachMarker: Mesh | null = null;

  // Spatial grid debug visualization mesh (owned by this service)
  private spatialGridVizMesh: InstancedMesh | null = null;

  // Air-cell debug visualization mesh — same cell set as spatialGridVizMesh
  // but elevated to terrainY + airSampleYOffset, drawn in the air-layer colour.
  private airSpatialGridVizMesh: InstancedMesh | null = null;

  // Frames around the cells the cell report has selected, see showCellSelection
  private cellSelection: RouteGridSelectionViz | null = null;

  // Air-route tube debug overlay (owned by this service)
  private airRouteTube: Group | null = null;
  private airRouteTubeScene: Scene | null = null;

  constructor() {
    this.gridService.onCellsChanged((change) => {
      if (change === 'generated') {
        // Routes changed → existing tube geometry is stale, rebuild if shown
        if (this.airRouteTube) this.rebuildAirRouteLayer();
      } else {
        this.cleanupSpatialGridVisualization();
        this.cleanupAirSpatialGridVisualization();
        this.cleanupAirRouteLayer();
        this.cleanupCellSelection();
        this.hideDefenseReachMarker();
      }
    });
  }

  private get grid() {
    return this.gridService.getGrid();
  }

  /**
   * Initialize debug visualization with a Three.js scene reference.
   * Must be called before getDefenseReachPercent() can show the orange marker.
   * `portalClip`: the spawn portals' clip, which the Route Grid Overlay takes.
   */
  initDebugViz(scene: Scene, portalClip?: PortalClipUniforms): void {
    this.scene = scene;
    this.portalClip = portalClip;
  }

  /**
   * Create visualization mesh
   */
  createVisualization(): InstancedMesh {
    return this.grid.createVisualization(this.portalClip);
  }

  /**
   * Update the overlay's colours. The enemies in the cells come from
   * `enemies` (the mirror's living ones): the main thread's grid tracks no
   * enemies, the simulation's does, in its worker.
   */
  updateVisualization(enemies: readonly { position: { lat: number; lon: number } }[] = []): void {
    const grid = this.grid;
    const sync = grid.getCoordinateSync();
    const occupied = this.occupied;
    occupied.clear();
    if (sync) {
      const local = this.local;
      for (const enemy of enemies) {
        sync.geoToLocalSimpleInto(enemy.position.lat, enemy.position.lon, 0, local);
        const cell = grid.getCellAt(local.x, local.z);
        if (cell) occupied.add(cell);
      }
    }
    grid.updateVisualization(occupied);
  }

  /** Scratch of updateVisualization */
  private readonly occupied = new Set<RouteCell>();
  private readonly local = new Vector3();

  /**
   * Update animation time
   */
  updateAnimation(deltaTime: number): void {
    this.grid.updateAnimation(deltaTime);
  }

  /**
   * Get visualization mesh
   */
  getVisualization(): InstancedMesh | null {
    return this.grid.getVisualization();
  }

  /**
   * Dispose visualization
   */
  disposeVisualization(): void {
    this.grid.disposeVisualization();
  }

  // ========================================
  // SPATIAL GRID DEBUG VISUALIZATION
  // ========================================

  /**
   * Toggle spatial grid debug visualization.
   * Toggles UI state and updates visualization accordingly.
   */
  toggleSpatialGridDebug(): void {
    this.uiStore.toggleSpatialGridDebug();
    this.updateSpatialGridVisualization();
  }

  /**
   * Initialize spatial grid visualization if persisted state was enabled.
   * Called after grid is initialized to restore persisted visibility.
   */
  initSpatialGridVisualizationIfEnabled(): void {
    if (this.uiStore.spatialGridDebugVisible()) {
      this.updateSpatialGridVisualization();
    }
  }

  /**
   * Update spatial grid visualization based on current UI state.
   * Creates mesh on first show, toggles visibility thereafter.
   */
  updateSpatialGridVisualization(): void {
    const visible = this.uiStore.spatialGridDebugVisible();

    if (visible) {
      // Create and add visualization mesh to scene
      if (!this.spatialGridVizMesh && this.scene && this.gridService.isInitialized()) {
        this.spatialGridVizMesh = this.grid.createVisualization(this.portalClip);
        this.scene.add(this.spatialGridVizMesh);
      }
      if (this.spatialGridVizMesh) {
        this.spatialGridVizMesh.visible = true;
      }
    } else {
      // Hide visualization (don't dispose - may toggle again)
      if (this.spatialGridVizMesh) {
        this.spatialGridVizMesh.visible = false;
      }
    }
  }

  /**
   * Check if the spatial grid viz mesh is active and visible
   * (used by game loop for per-frame visualization updates)
   */
  isSpatialGridVizVisible(): boolean {
    return this.uiStore.spatialGridDebugVisible() && this.spatialGridVizMesh !== null;
  }

  /**
   * Cleanup spatial grid visualization mesh.
   * Removes from scene and disposes resources.
   */
  cleanupSpatialGridVisualization(): void {
    if (this.spatialGridVizMesh) {
      if (this.scene) {
        this.scene.remove(this.spatialGridVizMesh);
      }
      this.grid.disposeVisualization();
      this.spatialGridVizMesh = null;
    }
  }

  // ========================================
  // AIR-CELL DEBUG (mirror of spatial-grid-debug at air altitude)
  // ========================================

  /** Toggle the air-cell debug overlay. Persisted via UIStore. */
  toggleAirSpatialGridDebug(): void {
    this.uiStore.toggleAirSpatialGridDebug();
    this.updateAirSpatialGridVisualization();
  }

  /** Restore from persisted state. Call after grid init. */
  initAirSpatialGridVisualizationIfEnabled(): void {
    if (this.uiStore.airSpatialGridDebugVisible()) {
      this.updateAirSpatialGridVisualization();
    }
  }

  /**
   * Reflect the current UIStore state on the scene — show or hide.
   * Idempotent; manages create/dispose lifecycle internally.
   */
  updateAirSpatialGridVisualization(): void {
    const visible = this.uiStore.airSpatialGridDebugVisible();

    if (visible) {
      if (!this.airSpatialGridVizMesh && this.scene && this.gridService.isInitialized()) {
        this.airSpatialGridVizMesh = this.grid.createAirVisualization(this.portalClip);
        this.scene.add(this.airSpatialGridVizMesh);
      }
      if (this.airSpatialGridVizMesh) {
        this.airSpatialGridVizMesh.visible = true;
      }
    } else {
      if (this.airSpatialGridVizMesh) {
        this.airSpatialGridVizMesh.visible = false;
      }
    }
  }

  /** True if the air-cell-mesh is built and currently visible. */
  isAirSpatialGridVizVisible(): boolean {
    return this.uiStore.airSpatialGridDebugVisible() && this.airSpatialGridVizMesh !== null;
  }

  /** Dispose the air-cell-mesh — invoked on grid clear / dispose. */
  cleanupAirSpatialGridVisualization(): void {
    if (this.airSpatialGridVizMesh) {
      if (this.scene) {
        this.scene.remove(this.airSpatialGridVizMesh);
      }
      this.grid.disposeAirVisualization();
      this.airSpatialGridVizMesh = null;
    }
  }

  // ========================================
  // CELL REPORT SELECTION
  // ========================================

  /**
   * Frame these grid spots over the Route Grid Overlay, also while the
   * overlay is off (the cell report, CellReportService). A spot with a cell
   * lies on the cell's ground (getGroundLocalYAt), one without at its own
   * `y`. Empty takes the frames down; so do clear and dispose.
   */
  showCellSelection(spots: readonly { x: number; y: number; z: number }[]): void {
    if (spots.length === 0 || !this.scene) {
      this.cleanupCellSelection();
      return;
    }
    if (!this.cellSelection) {
      this.cellSelection = new RouteGridSelectionViz(this.grid.getCellSize());
      this.scene.add(this.cellSelection.object);
    }
    this.cellSelection.setSpots(spots.map((spot) => ({
      x: spot.x,
      y: this.grid.getCellAt(spot.x, spot.z) ? this.grid.getGroundLocalYAt(spot.x, spot.z) ?? spot.y : spot.y,
      z: spot.z,
    })));
  }

  private cleanupCellSelection(): void {
    this.cellSelection?.dispose();
    this.cellSelection = null;
  }

  // ========================================
  // AIR-ROUTE TUBE (Quick-Actions toggle)
  // ========================================

  /** Toggle the air-route tube overlay. Persisted via UIStore. */
  toggleAirRouteLayer(): void {
    this.uiStore.toggleAirRoute();
    this.updateAirRouteLayer();
  }

  /** Re-instantiate the tube if the persisted state was enabled. */
  initAirRouteLayerIfEnabled(): void {
    if (this.uiStore.airRouteVisible()) {
      this.updateAirRouteLayer();
    }
  }

  /**
   * Reflect the current UIStore state on the scene — show or hide.
   * Idempotent; calls into the show/hide methods which manage their
   * own create/dispose lifecycle.
   */
  updateAirRouteLayer(): void {
    if (!this.scene) return;
    if (this.uiStore.airRouteVisible()) {
      this.showAirRouteLayer(this.scene);
    } else {
      this.hideAirRouteLayer();
    }
  }

  /** Build (lazy) and show the tube. Idempotent. */
  private showAirRouteLayer(scene: Scene): void {
    if (!this.airRouteTube) {
      this.airRouteTube = buildRouteAltitudeTubes(this.grid);
    }
    if (this.airRouteTubeScene !== scene) {
      this.airRouteTube.removeFromParent();
      scene.add(this.airRouteTube);
      this.airRouteTubeScene = scene;
    }
    this.airRouteTube.visible = true;
  }

  /** Hide without disposing. Idempotent. */
  private hideAirRouteLayer(): void {
    if (this.airRouteTube) {
      this.airRouteTube.visible = false;
    }
  }

  /**
   * Force re-build of the tube — used after a location switch or new
   * route generation where the polyline geometry has changed.
   */
  rebuildAirRouteLayer(): void {
    if (!this.airRouteTube) return;
    const wasVisible = this.airRouteTube.visible;
    const scene = this.airRouteTubeScene;
    disposeRouteAltitudeTubes(this.airRouteTube);
    this.airRouteTube = null;
    this.airRouteTubeScene = null;
    if (wasVisible && scene) {
      this.showAirRouteLayer(scene);
    }
  }

  /** Disposes the cached tube — invoked on full grid clear. */
  cleanupAirRouteLayer(): void {
    if (this.airRouteTube) {
      disposeRouteAltitudeTubes(this.airRouteTube);
      this.airRouteTube = null;
      this.airRouteTubeScene = null;
    }
  }

  // ========================================
  // DEFENSE REACH
  // ========================================

  /**
   * Defense reach percent (GlobalRouteGridService.defenseReach) of the
   * routes, with the orange debug marker moved to its waypoint.
   *
   * @param routes Array of route paths (GeoPosition[][])
   * @returns Defense reach as fraction 0..1
   */
  getDefenseReachPercent(routes: GeoPosition[][]): number {
    const reach = this.gridService.defenseReach(routes);
    if (reach.marker) this.updateDefenseReachMarker(reach.marker.x, reach.marker.y, reach.marker.z);
    else this.hideDefenseReachMarker();
    return reach.fraction;
  }

  private updateDefenseReachMarker(x: number, y: number, z: number): void {
    if (!this.scene) return;

    if (!this.defenseReachMarker) {
      const geo = new SphereGeometry(1.5, 8, 6);
      const mat = new MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.85 });
      this.defenseReachMarker = new Mesh(geo, mat);
      this.defenseReachMarker.renderOrder = 10;
      this.scene.add(this.defenseReachMarker);
    }

    this.defenseReachMarker.position.set(x, y, z);
    this.defenseReachMarker.visible = true;
  }

  private hideDefenseReachMarker(): void {
    if (this.defenseReachMarker) {
      this.defenseReachMarker.visible = false;
    }
  }

  /** Every overlay and the marker gone, the scene forgotten (teardown). */
  dispose(): void {
    this.cleanupSpatialGridVisualization();
    this.cleanupAirSpatialGridVisualization();
    this.cleanupAirRouteLayer();
    this.cleanupCellSelection();
    if (this.defenseReachMarker) {
      if (this.scene) this.scene.remove(this.defenseReachMarker);
      this.defenseReachMarker.geometry.dispose();
      (this.defenseReachMarker.material as MeshBasicMaterial).dispose();
      this.defenseReachMarker = null;
    }
    this.scene = null;
  }
}
