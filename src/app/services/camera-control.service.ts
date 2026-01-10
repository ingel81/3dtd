import { Injectable } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';

/**
 * CameraControlService
 *
 * Manages camera position, animations, and view controls for the Tower Defense game.
 * Handles camera reset, fly-to animations, and position tracking.
 */
@Injectable({ providedIn: 'root' })
export class CameraControlService {
  // ========================================
  // STATE
  // ========================================

  /** Stored initial camera position for reset functionality */
  private initialCameraPosition: { x: number; y: number; z: number } | null = null;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for fallback positioning */
  private baseCoords: GeoPosition | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize camera control service with engine reference
   * @param engine ThreeTilesEngine instance
   * @param baseCoords Base/HQ coordinates for fallback positioning
   */
  initialize(engine: ThreeTilesEngine, baseCoords: GeoPosition): void {
    this.engine = engine;
    this.baseCoords = baseCoords;
  }

  // ========================================
  // POSITION MANAGEMENT
  // ========================================

  /**
   * Save current camera position as initial position
   * This is called after engine initialization to store the default view
   */
  saveInitialPosition(): void {
    if (!this.engine) return;

    const camera = this.engine.getCamera();
    this.initialCameraPosition = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };

    console.log('[Camera] Initial position captured:', this.initialCameraPosition);
  }

  /**
   * Reset camera to initial position or fallback to base coordinates
   */
  resetCamera(): void {
    if (!this.engine) return;

    // Use stored initial camera position if available
    if (this.initialCameraPosition) {
      const pos = this.initialCameraPosition;
      // Look at terrain level (Y - 400 since camera is 400m above ground)
      const lookAtY = pos.y - 400;
      this.engine.setLocalCameraPosition(pos.x, pos.y, pos.z, 0, lookAtY, 0);
    } else {
      // Fallback: calculate from terrain (less accurate before tiles fully load)
      if (!this.baseCoords) {
        console.warn('[Camera] No base coords available for fallback positioning');
        return;
      }

      const terrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon) ?? 0;
      const heightAboveGround = 400;
      const cameraY = terrainY + heightAboveGround;
      this.engine.setLocalCameraPosition(0, cameraY, -heightAboveGround, 0, terrainY, 0);
    }
  }

  // ========================================
  // FLY-TO ANIMATIONS
  // ========================================

  /**
   * Fly camera to center location (uses resetCamera for consistent positioning)
   */
  flyToCenter(): void {
    this.resetCamera();
  }

  /**
   * Fly camera to specific location
   * @param lat Latitude
   * @param lon Longitude
   * @param height Optional height above terrain (default: 400m)
   * @param duration Optional animation duration in ms (default: instant)
   */
  flyToLocation(lat: number, lon: number, height: number = 400, duration: number = 0): void {
    if (!this.engine) return;

    const terrainY = this.engine.getTerrainHeightAtGeo(lat, lon) ?? 0;
    const cameraY = terrainY + height;

    // For now, we use instant positioning (no animation)
    // TODO: Implement smooth animation with requestAnimationFrame
    this.engine.setLocalCameraPosition(0, cameraY, -height, 0, terrainY, 0);
  }

  // ========================================
  // DEBUG
  // ========================================

  /**
   * Log current camera position and rotation to console
   * Useful for debugging camera issues and determining initial positions
   */
  logCameraPosition(): void {
    if (!this.engine) return;

    const camera = this.engine.getCamera();

    const data = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      rotation: {
        x: camera.rotation.x,
        y: camera.rotation.y,
        z: camera.rotation.z,
      },
    };

    console.log('[Camera] Current position:', JSON.stringify(data, null, 2));
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Clear camera state
   */
  dispose(): void {
    this.engine = null;
    this.baseCoords = null;
    this.initialCameraPosition = null;
  }
}
