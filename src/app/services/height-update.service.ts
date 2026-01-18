import { Injectable, signal, WritableSignal } from '@angular/core';
import { Group, Vector3 } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';

/**
 * HeightUpdateService
 *
 * Manages terrain height synchronization for overlays (markers, streets).
 * Handles periodic height updates until terrain tiles are fully loaded and stable.
 */
@Injectable({ providedIn: 'root' })
export class HeightUpdateService {
  // ========================================
  // CONSTANTS
  // ========================================

  /** Maximum height update attempts */
  private readonly MAX_ATTEMPTS = 20; // Max 20 attempts (10 seconds total)

  /** Minimum height update attempts */
  private readonly MIN_ATTEMPTS = 4; // Minimum 4 attempts (2 seconds)

  /** Update interval in milliseconds */
  private readonly UPDATE_INTERVAL_MS = 500;

  // ========================================
  // SIGNALS
  // ========================================

  /** Height updates in progress */
  readonly heightsLoading = signal(true);

  /** Current height update progress (attempt count) */
  readonly heightProgress = signal(0);

  // ========================================
  // STATE
  // ========================================

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for height calculations */
  private baseCoords: GeoPosition | null = null;

  /** Height update interval ID */
  private heightUpdateIntervalId: number | null = null;

  /** Height update attempt counter */
  private heightUpdateAttempts = 0;

  /** Flag indicating overlays have been updated */
  private overlayHeightsUpdated = false;

  /** Promise resolve callback for height stability */
  private heightStableResolve: (() => void) | null = null;

  /** Loading status signal (from EngineInitializationService) */
  private loadingStatusSignal: WritableSignal<string> | null = null;

  /** Callback to update marker heights */
  private onUpdateMarkersCallback: (() => void) | null = null;

  /** Callback to render streets */
  private onRenderStreetsCallback: (() => void) | null = null;

  /** Callback to finalize step */
  private onFinalizeCallback: ((detail: string) => void) | null = null;

  /** Callback to update step detail (for live progress display) */
  private onUpdateDetailCallback: ((detail: string) => void) | null = null;

  /** Callback to check all loaded */
  private onCheckAllLoadedCallback: (() => void) | null = null;

  /** Callback for camera correction (called BEFORE heightsLoading becomes false) */
  private onCameraCorrectionCallback: (() => void) | null = null;

  /** Previous street line count for stability detection */
  private previousLineCount = 0;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize height update service
   * @param engine ThreeTilesEngine instance
   * @param baseCoords Base/HQ coordinates
   * @param loadingStatusSignal Loading status signal
   * @param onUpdateMarkers Callback to update marker heights
   * @param onRenderStreets Callback to render streets
   * @param onFinalize Callback to finalize step
   * @param onUpdateDetail Callback to update step detail (for live progress)
   * @param onCheckAllLoaded Callback to check all loaded
   * @param onCameraCorrection Callback for camera correction (called BEFORE overlay hides)
   */
  initialize(
    engine: ThreeTilesEngine,
    baseCoords: GeoPosition,
    loadingStatusSignal: WritableSignal<string>,
    onUpdateMarkers: () => void,
    onRenderStreets: () => void,
    onFinalize: (detail: string) => void,
    onUpdateDetail: (detail: string) => void,
    onCheckAllLoaded: () => void,
    onCameraCorrection?: () => void
  ): void {
    this.engine = engine;
    this.baseCoords = baseCoords;
    this.loadingStatusSignal = loadingStatusSignal;
    this.onUpdateMarkersCallback = onUpdateMarkers;
    this.onRenderStreetsCallback = onRenderStreets;
    this.onFinalizeCallback = onFinalize;
    this.onUpdateDetailCallback = onUpdateDetail;
    this.onCheckAllLoadedCallback = onCheckAllLoaded;
    this.onCameraCorrectionCallback = onCameraCorrection ?? null;
  }

  // ========================================
  // HEIGHT UPDATE SCHEDULING
  // ========================================

  /**
   * Schedule periodic overlay height updates
   * Runs every 500ms until terrain heights are stable
   * @returns Promise that resolves when heights are stable
   */
  scheduleOverlayHeightUpdate(): Promise<void> {
    // Reset counters for fresh location
    this.heightUpdateAttempts = 0;
    this.overlayHeightsUpdated = false;
    this.heightsLoading.set(true);
    this.heightProgress.set(0);
    this.previousLineCount = 0;

    if (this.loadingStatusSignal) {
      this.loadingStatusSignal.set('Synchronisiere mit Terrain...');
    }

    return new Promise((resolve) => {
      this.heightStableResolve = resolve;

      this.heightUpdateIntervalId = window.setInterval(() => {
        this.performHeightUpdate();
      }, this.UPDATE_INTERVAL_MS);
    });
  }

  /**
   * Perform a single height update cycle
   */
  private performHeightUpdate(): void {
    if (!this.engine) {
      this.stopHeightUpdates();
      return;
    }

    this.heightUpdateAttempts++;
    this.heightProgress.set(this.heightUpdateAttempts);

    // Update step detail for live progress display
    if (this.onUpdateDetailCallback) {
      this.onUpdateDetailCallback(`${this.heightUpdateAttempts} Sync-Zyklen`);
    }

    // Clear height cache before each attempt to get fresh values
    // This ensures we don't use stale heights from previous location
    this.engine.clearHeightCache();

    // Re-render streets with current terrain data
    if (this.onRenderStreetsCallback) {
      this.onRenderStreetsCallback();
    }

    // Get new line count (passed via callback)
    // Note: This is a simplified version - in the full integration,
    // we'll need to get the actual line count from the component

    // Also update marker positions each attempt
    if (this.onUpdateMarkersCallback) {
      this.onUpdateMarkersCallback();
    }

    // Check if we should stop (stability or max attempts reached)
    this.checkStabilityAndStop();
  }

  /**
   * Check if heights are stable and stop updates if needed
   */
  private checkStabilityAndStop(): void {
    // Only stop after minimum attempts
    if (this.heightUpdateAttempts >= this.MIN_ATTEMPTS) {
      this.stopHeightUpdates();
    } else if (this.heightUpdateAttempts >= this.MAX_ATTEMPTS) {
      this.stopHeightUpdates();
    }
  }

  /**
   * Stop height update interval
   */
  stopHeightUpdates(): void {
    // Only run callbacks if there was an active height update cycle
    const hadActiveInterval = this.heightUpdateIntervalId !== null;

    if (this.heightUpdateIntervalId) {
      clearInterval(this.heightUpdateIntervalId);
      this.heightUpdateIntervalId = null;
    }
    this.overlayHeightsUpdated = true;

    // Only call callbacks if we had an active interval
    // This prevents stale callbacks from being called during location change init
    if (!hadActiveInterval) {
      return;
    }

    // IMPORTANT: Camera correction BEFORE overlay hides!
    // This ensures the camera jump happens while loading overlay is still visible
    if (this.onCameraCorrectionCallback) {
      this.onCameraCorrectionCallback();
    }

    // NOW hide the loading overlay
    this.heightsLoading.set(false);

    // Mark finalize step as done
    if (this.onFinalizeCallback) {
      this.onFinalizeCallback(`${this.heightUpdateAttempts} Sync-Zyklen`);
    }

    // Check if all loading is complete
    if (this.onCheckAllLoadedCallback) {
      this.onCheckAllLoadedCallback();
    }

    // Resolve the promise to signal completion
    if (this.heightStableResolve) {
      this.heightStableResolve();
      this.heightStableResolve = null;
    }
  }

  /**
   * Update marker heights to match terrain
   * @param baseMarker Base marker reference
   * @param spawnMarkers Spawn marker references
   */
  updateMarkerHeights(baseMarker: Group | null, spawnMarkers: Group[]): void {
    if (!this.engine || !this.baseCoords) return;

    const HQ_MARKER_HEIGHT = 30; // HQ marker floats higher (animated diamond)
    const SPAWN_MARKER_HEIGHT = 30; // Spawn markers ~30m above ground

    // Get origin terrain height as reference
    const originTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon);
    if (originTerrainY === null) {
      return;
    }

    // Set the overlay base Y so overlayGroup is positioned at terrain surface
    this.engine.setOverlayBaseY(originTerrainY);

    // Update base marker - at origin, so relative height = 0
    if (baseMarker) {
      const local = this.engine.sync.geoToLocalSimple(this.baseCoords.lat, this.baseCoords.lon, 0);
      baseMarker.position.set(local.x, HQ_MARKER_HEIGHT, local.z);
    }

    // Update spawn markers - use relative heights
    for (const marker of spawnMarkers) {
      // Extract spawn point info from marker name (format: "spawnMarker_spawn-1")
      // spawnId available for future use: marker.name.replace('spawnMarker_', '')

      // Get spawn position from marker's current world position
      const worldPos = new Vector3();
      marker.getWorldPosition(worldPos);
      const geoPos = this.engine.sync.localToGeo(worldPos);

      // Get terrain height at spawn location
      const spawnTerrainY = this.engine.getTerrainHeightAtGeo(geoPos.lat, geoPos.lon);
      if (spawnTerrainY !== null) {
        // Calculate relative Y (height difference from origin + marker height)
        const relativeY = spawnTerrainY - originTerrainY + SPAWN_MARKER_HEIGHT;
        marker.position.y = relativeY;
      }
    }
  }

  // ========================================
  // GETTERS
  // ========================================

  /**
   * Check if height updates are complete
   */
  isComplete(): boolean {
    return this.overlayHeightsUpdated;
  }

  /**
   * Get current attempt count
   */
  getAttemptCount(): number {
    return this.heightUpdateAttempts;
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.stopHeightUpdates();
    this.engine = null;
    this.baseCoords = null;
    this.loadingStatusSignal = null;
    this.onUpdateMarkersCallback = null;
    this.onRenderStreetsCallback = null;
    this.onFinalizeCallback = null;
    this.onUpdateDetailCallback = null;
    this.onCheckAllLoadedCallback = null;
    this.heightStableResolve = null;
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.stopHeightUpdates();
    this.heightUpdateAttempts = 0;
    this.overlayHeightsUpdated = false;
    this.heightsLoading.set(true);
    this.heightProgress.set(0);
    this.previousLineCount = 0;
  }
}
