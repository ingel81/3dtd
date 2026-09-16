import { Injectable, signal } from '@angular/core';
import { ThreeTilesEngine } from '../../three-engine';
import { cameraTimeline } from '../../utils/camera-timeline';

/**
 * HeightUpdateService
 *
 * Manages terrain height synchronization for overlays (markers, streets):
 * a fixed number of height updates, one every UPDATE_INTERVAL_MS.
 */
@Injectable({ providedIn: 'root' })
export class HeightUpdateService {
  // ========================================
  // CONSTANTS
  // ========================================

  /** Height update attempts */
  private readonly ATTEMPTS = 4; // 4 attempts (2 seconds)

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

  /** Height update interval ID */
  private heightUpdateIntervalId: number | null = null;

  /** Height update attempt counter */
  private heightUpdateAttempts = 0;

  /** Flag indicating overlays have been updated */
  private overlayHeightsUpdated = false;

  /** Promise resolve callback for height stability */
  private heightStableResolve: (() => void) | null = null;

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

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize height update service
   * @param engine ThreeTilesEngine instance
   * @param onUpdateMarkers Callback to update marker heights
   * @param onRenderStreets Callback to render streets
   * @param onFinalize Callback to finalize step
   * @param onUpdateDetail Callback to update step detail (for live progress)
   * @param onCheckAllLoaded Callback to check all loaded
   * @param onCameraCorrection Callback for camera correction (called BEFORE overlay hides)
   */
  initialize(
    engine: ThreeTilesEngine,
    onUpdateMarkers: () => void,
    onRenderStreets: () => void,
    onFinalize: (detail: string) => void,
    onUpdateDetail: (detail: string) => void,
    onCheckAllLoaded: () => void,
    onCameraCorrection?: () => void
  ): void {
    this.engine = engine;
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
   * Runs every 500ms, ATTEMPTS times
   * @returns Promise that resolves after the last one
   */
  scheduleOverlayHeightUpdate(): Promise<void> {
    cameraTimeline.record('heights.schedule', { alreadyRunning: this.heightUpdateIntervalId !== null });
    // Reset counters for fresh location
    this.heightUpdateAttempts = 0;
    this.overlayHeightsUpdated = false;
    this.heightsLoading.set(true);
    this.heightProgress.set(0);

    // Update detail for first cycle
    if (this.onUpdateDetailCallback) {
      this.onUpdateDetailCallback('Starting terrain sync...');
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

    // Update step detail for live progress display - show what's happening
    if (this.onUpdateDetailCallback) {
      const remaining = this.ATTEMPTS - this.heightUpdateAttempts;
      if (remaining > 0) {
        this.onUpdateDetailCallback(`Synchronizing terrain... (${this.heightUpdateAttempts}/${this.ATTEMPTS})`);
      } else {
        this.onUpdateDetailCallback(`Finalizing terrain...`);
      }
    }

    // Clear height cache before each attempt to get fresh values
    // This ensures we don't use stale heights from previous location
    this.engine.terrain.clearHeightCache();

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

    // Stop after the last attempt
    if (this.heightUpdateAttempts >= this.ATTEMPTS) {
      this.stopHeightUpdates();
    }
  }

  /**
   * Stop height update interval
   */
  stopHeightUpdates(): void {
    // Only run callbacks if there was an active height update cycle
    const hadActiveInterval = this.heightUpdateIntervalId !== null;
    cameraTimeline.record('heights.stop', { hadActiveInterval, attempts: this.heightUpdateAttempts }, true);

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
      this.onFinalizeCallback('Ready');
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
  }
}
