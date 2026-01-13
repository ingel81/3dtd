import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';

/**
 * KeyboardPanService - WASD and Arrow key panning for camera
 *
 * Allows panning the camera using keyboard:
 * - W / ArrowUp: Move forward (towards where camera is looking)
 * - S / ArrowDown: Move backward
 * - A / ArrowLeft: Move left (strafe)
 * - D / ArrowRight: Move right (strafe)
 *
 * Movement is relative to camera's current heading (XZ plane only).
 */
@Injectable({ providedIn: 'root' })
export class KeyboardPanService {
  private engine: ThreeTilesEngine | null = null;

  // Currently pressed keys
  private keysPressed = new Set<string>();

  // Pan speed in meters per second
  private readonly PAN_SPEED = 80;

  // Reusable vectors for calculations
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly movement = new THREE.Vector3();

  /**
   * Initialize with engine reference
   */
  initialize(engine: ThreeTilesEngine): void {
    this.engine = engine;
  }

  /**
   * Handle keydown event
   * @returns true if the key was handled (should prevent default)
   */
  onKeyDown(event: KeyboardEvent): boolean {
    const key = this.normalizeKey(event.key);
    if (!key) return false;

    this.keysPressed.add(key);
    return true;
  }

  /**
   * Handle keyup event
   * @returns true if the key was handled
   */
  onKeyUp(event: KeyboardEvent): boolean {
    const key = this.normalizeKey(event.key);
    if (!key) return false;

    this.keysPressed.delete(key);
    return true;
  }

  /**
   * Normalize key to our internal representation
   * Returns null for keys we don't handle
   */
  private normalizeKey(key: string): string | null {
    switch (key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        return 'forward';
      case 's':
      case 'arrowdown':
        return 'backward';
      case 'a':
      case 'arrowleft':
        return 'left';
      case 'd':
      case 'arrowright':
        return 'right';
      default:
        return null;
    }
  }

  /**
   * Check if any movement key is currently pressed
   */
  isMoving(): boolean {
    return this.keysPressed.size > 0;
  }

  /**
   * Update camera position based on currently pressed keys
   * Should be called each frame (e.g., in animation loop)
   *
   * @param deltaTime Time since last frame in seconds
   */
  update(deltaTime: number): void {
    if (!this.engine || this.keysPressed.size === 0) return;

    const camera = this.engine.getCamera();

    // Get camera's forward direction (projected onto XZ plane)
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();

    // Get right vector (perpendicular to forward on XZ plane)
    this.right.crossVectors(this.forward, camera.up).normalize();

    // Calculate movement direction
    this.movement.set(0, 0, 0);

    if (this.keysPressed.has('forward')) {
      this.movement.add(this.forward);
    }
    if (this.keysPressed.has('backward')) {
      this.movement.sub(this.forward);
    }
    if (this.keysPressed.has('left')) {
      this.movement.sub(this.right);
    }
    if (this.keysPressed.has('right')) {
      this.movement.add(this.right);
    }

    // Normalize if moving diagonally (so diagonal movement isn't faster)
    if (this.movement.lengthSq() > 0) {
      this.movement.normalize();

      // Scale by speed and delta time
      const distance = this.PAN_SPEED * deltaTime;
      this.movement.multiplyScalar(distance);

      // Apply movement to camera position
      camera.position.add(this.movement);
    }
  }

  /**
   * Clear all pressed keys (e.g., when window loses focus)
   */
  clearKeys(): void {
    this.keysPressed.clear();
  }

  /**
   * Dispose service
   */
  dispose(): void {
    this.engine = null;
    this.keysPressed.clear();
  }
}
