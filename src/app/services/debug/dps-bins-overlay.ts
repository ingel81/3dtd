import { DpsProfileVisualizer } from '../../ai/core/dps-profile-visualizer';
import type { AIDataCollectorService } from '../../ai/core/ai-data-collector.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { ThreeTilesEngine } from '../../three-engine';

/** What DpsBinsOverlay needs; VisualizationFacadeService passes its services. */
export interface DpsBinsOverlayDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'getGlobalRouteGrid' | 'getEventBus'>;
  aiDataCollector: Pick<AIDataCollectorService, 'getCurrentDPSProfile'>;
}

/**
 * DPS profile bins along the path: the current DPS profile of the AI data
 * collector, drawn again whenever a tower is placed, sold or upgraded while
 * the bins are shown.
 */
export class DpsBinsOverlay {
  private dpsProfileViz: DpsProfileVisualizer | null = null;
  private dpsVizUnsubscribes: (() => void)[] = [];

  constructor(private readonly deps: DpsBinsOverlayDeps) {}

  /**
   * Show the bins and follow tower changes, or hide them and stop
   * following. The visualizer is built on first show and kept.
   */
  setVisible(visible: boolean, engine: ThreeTilesEngine): void {
    if (visible) {
      const grid = this.deps.gameState().getGlobalRouteGrid();
      const coordSync = grid.getCoordinateSync();
      if (!coordSync) return;

      if (!this.dpsProfileViz) {
        this.dpsProfileViz = new DpsProfileVisualizer(coordSync);
      }

      this.updateDpsViz(engine);

      const eventBus = this.deps.gameState().getEventBus();
      const updateHandler = () => this.updateDpsViz(engine);
      const sub1 = eventBus.on('tower:placed', updateHandler);
      const sub2 = eventBus.on('tower:sold', updateHandler);
      const sub3 = eventBus.on('tower:upgraded', updateHandler);
      this.dpsVizUnsubscribes = [
        () => sub1.dispose(),
        () => sub2.dispose(),
        () => sub3.dispose(),
      ];
    } else {
      if (this.dpsProfileViz) {
        this.dpsProfileViz.setVisible(false);
      }
      this.dpsVizUnsubscribes.forEach(fn => fn());
      this.dpsVizUnsubscribes = [];
    }
  }

  /**
   * Dispose DPS visualization resources: the subscriptions, the mesh in
   * the scene of `engine` and the visualizer.
   */
  dispose(engine: ThreeTilesEngine | null): void {
    this.dpsVizUnsubscribes.forEach(fn => fn());
    this.dpsVizUnsubscribes = [];
    if (this.dpsProfileViz) {
      const mesh = this.dpsProfileViz.getMesh();
      if (mesh) engine?.getScene().remove(mesh);
      this.dpsProfileViz.dispose();
      this.dpsProfileViz = null;
    }
  }

  private updateDpsViz(engine: ThreeTilesEngine): void {
    if (!this.dpsProfileViz) return;
    const profile = this.deps.aiDataCollector.getCurrentDPSProfile();
    this.dpsProfileViz.update(profile);
    this.dpsProfileViz.setVisible(true);
    const mesh = this.dpsProfileViz.getMesh();
    if (mesh && !mesh.parent) {
      engine.getScene().add(mesh);
    }
  }
}
