import { Object3D, Vector2, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

/**
 * The route lines PathAndRouteService draws, one Line2 per spawn route, in
 * the engine's overlay group. Line2 because it keeps its pixel width.
 */
export class RouteLineLayer {
  /** 3D route lines for visualization (using Line2 for proper line width) */
  private lines: Line2[] = [];

  /** Every line drawn now. */
  get all(): Line2[] {
    return this.lines;
  }

  /**
   * Draw a route through `points` (local coordinates, already lifted above
   * the ground) in the spawn's colour.
   */
  add(overlayGroup: Object3D, points: readonly Vector3[], color: number, visible: boolean): void {
    // Convert points to flat array for LineGeometry
    const positions: number[] = [];
    for (const pt of points) {
      positions.push(pt.x, pt.y, pt.z);
    }

    const geometry = new LineGeometry();
    geometry.setPositions(positions);

    const material = new LineMaterial({
      color,
      linewidth: 2, // In pixels (actually works with Line2!)
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
      worldUnits: false, // Use screen pixels, not world units
      resolution: new Vector2(window.innerWidth, window.innerHeight),
    });

    const routeLine = new Line2(geometry, material);
    routeLine.computeLineDistances(); // Required for Line2
    routeLine.visible = visible;
    routeLine.renderOrder = 1;
    routeLine.frustumCulled = false; // Prevent disappearing at certain angles

    overlayGroup.add(routeLine);
    this.lines.push(routeLine);
  }

  /** Take every line out of `overlayGroup` and free its geometry and material. */
  clear(overlayGroup: Object3D): void {
    for (const line of this.lines) {
      overlayGroup.remove(line);
      line.geometry.dispose();
      if (Array.isArray(line.material)) {
        line.material.forEach((m) => m.dispose());
      } else {
        line.material.dispose();
      }
    }
    this.lines = [];
  }

  /** Show or hide every line. */
  setVisible(visible: boolean): void {
    for (const line of this.lines) {
      line.visible = visible;
    }
  }
}
