/**
 * DPS Profile Visualizer
 *
 * Displays 20 colored markers along the enemy path representing
 * the DPS coverage at each bin. Used in training/debug mode.
 *
 * Color encoding:
 * - Gray:  DPS = 0 (no coverage)
 * - Yellow: DPS < 50% of max
 * - Green:  DPS 50-100% of max
 * - Cyan:   DPS = max (100%)
 */

import {
  InstancedMesh,
  SphereGeometry,
  MeshBasicMaterial,
  Color,
  Object3D,
  InstancedBufferAttribute,
} from 'three';
import { PathDPSProfile, NUM_BINS } from './dps-profile';
import { CoordinateSync } from '../../three-engine/renderers';

const COLORS = {
  none: new Color(0.5, 0.5, 0.5),     // Gray: no coverage
  low: new Color(1.0, 0.9, 0.2),      // Yellow: < 50%
  medium: new Color(0.2, 0.8, 0.3),   // Green: 50-100%
  full: new Color(0.0, 0.9, 0.9),     // Cyan: 100%
};

const SPHERE_RADIUS = 3;  // meters
const SPHERE_HEIGHT_OFFSET = 8;  // meters above terrain

export class DpsProfileVisualizer {
  private mesh: InstancedMesh | null = null;
  private dummy = new Object3D();
  private visible = false;

  constructor(private coordinateSync: CoordinateSync) {}

  /**
   * Create or update the visualization mesh from a DPS profile
   */
  update(profile: PathDPSProfile, terrainHeightAt?: (lat: number, lon: number) => number): void {
    if (!profile.binPositions.length) {
      this.dispose();
      return;
    }

    // Create mesh if needed
    if (!this.mesh || this.mesh.count !== NUM_BINS) {
      this.dispose();
      const geometry = new SphereGeometry(SPHERE_RADIUS, 8, 6);
      const material = new MeshBasicMaterial({ transparent: true, opacity: 0.8 });
      this.mesh = new InstancedMesh(geometry, material, NUM_BINS);
      this.mesh.name = 'dps-profile-viz';
      this.mesh.frustumCulled = false;
      this.mesh.visible = this.visible;

      // Add per-instance color
      const colors = new Float32Array(NUM_BINS * 3);
      this.mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
    }

    // Update positions and colors
    for (let i = 0; i < NUM_BINS; i++) {
      const binPos = profile.binPositions[i];
      if (!binPos) continue;

      // Convert geo to local
      const height = terrainHeightAt ? terrainHeightAt(binPos.lat, binPos.lon) : 0;
      const local = this.coordinateSync.geoToLocalSimple(binPos.lat, binPos.lon, height);

      this.dummy.position.set(local.x, local.y + SPHERE_HEIGHT_OFFSET, local.z);

      // Scale by DPS value (ground DPS used for size)
      const dpsValue = profile.groundDPS[i] ?? 0;
      const scale = 0.5 + dpsValue * 1.5;  // 0.5 to 2.0
      this.dummy.scale.set(scale, scale, scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Color based on DPS value
      const color = this.getColor(dpsValue);
      this.mesh.setColorAt(i, color);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Get the InstancedMesh for adding to scene
   */
  getMesh(): InstancedMesh | null {
    return this.mesh;
  }

  /**
   * Show/hide the visualization
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.mesh) {
      this.mesh.visible = visible;
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as MeshBasicMaterial).dispose();
      this.mesh = null;
    }
  }

  private getColor(dpsValue: number): Color {
    if (dpsValue < 0.01) return COLORS.none;
    if (dpsValue < 0.5) return COLORS.low;
    if (dpsValue < 1.0) return COLORS.medium;
    return COLORS.full;
  }
}
