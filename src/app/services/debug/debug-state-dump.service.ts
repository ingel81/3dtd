import { Injectable, inject } from '@angular/core';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { LocationStore } from '../../store/location.store';
import { UIStore } from '../../store/ui.store';

/**
 * Builds a structured JSON snapshot of currently-interesting engine state
 * and triggers a browser download. Used for bug hunts where copy-pasting
 * out of DevTools is awkward — user clicks the dump button, attaches the
 * resulting file to a chat / issue.
 *
 * Add new sections by injecting the relevant store/service and appending
 * to the returned object in `collectSnapshot()`. Keep section keys stable
 * so historical dumps stay comparable.
 */
@Injectable({ providedIn: 'root' })
export class DebugStateDumpService {
  private readonly routeGrid = inject(GlobalRouteGridService);
  private readonly locationStore = inject(LocationStore);
  private readonly uiStore = inject(UIStore);

  /** Build the snapshot and trigger a browser download. */
  dumpAndDownload(): void {
    const snapshot = this.collectSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    const stamp = snapshot.meta.timestamp.replace(/[:.]/g, '-');
    const loc = (snapshot.meta.location.name || 'unknown')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    this.triggerDownload(`3dtd-state-${loc}-${stamp}.json`, json);
  }

  /**
   * Build the snapshot without downloading — useful from DevTools when
   * inspecting state inline (`__rg.grid` etc. still exists as a faster
   * alternative for the route-grid specifically).
   */
  collectSnapshot(): StateSnapshot {
    const grid = this.routeGrid.getGrid();
    const base = this.locationStore.baseCoords();
    const center = this.locationStore.centerCoords();

    return {
      meta: {
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        location: {
          name: this.locationStore.currentLocationName(),
          base: { lat: base.lat, lon: base.lon },
          center: { lat: center.lat, lon: center.lon, height: center.height },
          streetCount: this.locationStore.streetCount(),
          spawnPoints: this.locationStore.spawnPoints().length,
        },
        uiFlags: {
          spatialGridDebug: this.uiStore.spatialGridDebugVisible(),
          airSpatialGridDebug: this.uiStore.airSpatialGridDebugVisible(),
          airRoute: this.uiStore.airRouteVisible(),
          routes: this.uiStore.routesVisible(),
          buildings: this.uiStore.buildingsVisible(),
          streets: this.uiStore.streetsVisible(),
          heightDebug: this.uiStore.heightDebugVisible(),
          perTowerLosFilter: this.uiStore.perTowerLosFilter(),
        },
      },
      routeGrid: {
        initialized: this.routeGrid.isInitialized(),
        gridStats: this.routeGrid.getStats(),
        sampleStats: grid.dumpStats(),
        outliers20m: grid.dumpOutliers(20),
      },
    };
  }

  private triggerDownload(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export interface StateSnapshot {
  meta: {
    timestamp: string;
    userAgent: string;
    location: {
      name: string;
      base: { lat: number; lon: number };
      center: { lat: number; lon: number; height: number };
      streetCount: number;
      spawnPoints: number;
    };
    uiFlags: Record<string, unknown>;
  };
  routeGrid: {
    initialized: boolean;
    gridStats: { totalCells: number; trackedEnemies: number; occupiedCells: number };
    sampleStats: ReturnType<import('../../utils/global-route-grid').GlobalRouteGrid['dumpStats']>;
    outliers20m: ReturnType<import('../../utils/global-route-grid').GlobalRouteGrid['dumpCellsInBox']>;
  };
}
