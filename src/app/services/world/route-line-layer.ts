import { Object3D, Vector2, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { clipLineMaterial, type PortalClipUniforms } from '../../three-engine/renderers/portal-clip';

/** Metres the ground at local (x, z) stands off the built ground (the craters and rubble, StampField.heightAt) */
export interface GroundOffset {
  heightAt(x: number, z: number): number;
}

/** A rectangle in the local frame */
export interface LocalRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Steps a line takes over craters and rubble, m: half a route cell, so it dips into a crater of two cells */
export const LINE_STAMP_STEP_M = 1;

/**
 * The route lines PathAndRouteService draws, one Line2 per spawn route, in
 * the engine's overlay group. Line2 because it keeps its pixel width.
 *
 * Each line keeps the points it was drawn through (on the ground as built,
 * lifted) and stands on the craters and rubble under the routes
 * (`offset`, the main grid's StampField): a stretch over a stamp is drawn
 * every LINE_STAMP_STEP_M at the ground there, the rest through its points.
 * When the stamps change, `restand` draws again only the lines that cross
 * the changed rectangle.
 */
export class RouteLineLayer {
  /** 3D route lines for visualization (using Line2 for proper line width) */
  private lines: Line2[] = [];
  /** The points each line was drawn through, in the order of `lines` */
  private readonly bases: Vector3[][] = [];

  constructor(
    /** The stamps under the routes now, null while the ground lies as built */
    private readonly offset: () => GroundOffset | null = () => null,
  ) {}

  /** Every line drawn now. */
  get all(): Line2[] {
    return this.lines;
  }

  /**
   * Draw a route through `points` (local coordinates, already lifted above
   * the ground) in the spawn's colour, ending at the plane of the spawn
   * portals (`portalClip`, ThreeTilesEngine.portalClip): its start behind
   * the plane does not show.
   */
  add(overlayGroup: Object3D, points: readonly Vector3[], color: number, visible: boolean, portalClip: PortalClipUniforms): void {
    const base = points.map((p) => p.clone());
    const geometry = new LineGeometry();
    geometry.setPositions(this.positions(base));

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
    clipLineMaterial(material, portalClip);

    const routeLine = new Line2(geometry, material);
    routeLine.computeLineDistances(); // Required for Line2
    routeLine.visible = visible;
    routeLine.renderOrder = 1;
    routeLine.frustumCulled = false; // Prevent disappearing at certain angles

    overlayGroup.add(routeLine);
    this.lines.push(routeLine);
    this.bases.push(base);
  }

  /**
   * The stamps changed in `rect` (every line for null): the lines that
   * cross it are drawn again on the ground as it stands now
   */
  restand(rect: LocalRect | null): void {
    for (let k = 0; k < this.lines.length; k++) {
      const base = this.bases[k];
      if (rect && !crosses(base, rect)) continue;
      const line = this.lines[k];
      // A new geometry, the old one freed: setPositions on the old one would leave its buffers on the GPU
      const geometry = new LineGeometry();
      geometry.setPositions(this.positions(base));
      line.geometry.dispose();
      line.geometry = geometry;
      line.computeLineDistances();
    }
  }

  /** The flat positions of a line through `base`, standing on the stamps */
  private positions(base: readonly Vector3[]): number[] {
    const out: number[] = [];
    const offset = this.offset();
    if (!offset) {
      for (const p of base) out.push(p.x, p.y, p.z);
      return out;
    }
    for (let i = 0; i < base.length; i++) {
      const a = base[i];
      out.push(a.x, a.y + offset.heightAt(a.x, a.z), a.z);
      const b = base[i + 1];
      if (!b) break;
      const steps = Math.floor(Math.hypot(b.x - a.x, b.z - a.z) / LINE_STAMP_STEP_M);
      // Between the points only where a stamp lies: a line on the ground as built keeps its points
      let stamped = false;
      for (let n = 1; n < steps && !stamped; n++) {
        const f = n / steps;
        stamped = offset.heightAt(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f) !== 0;
      }
      if (!stamped) continue;
      for (let n = 1; n < steps; n++) {
        const f = n / steps;
        const x = a.x + (b.x - a.x) * f;
        const z = a.z + (b.z - a.z) * f;
        out.push(x, a.y + (b.y - a.y) * f + offset.heightAt(x, z), z);
      }
    }
    return out;
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
    this.bases.length = 0;
  }

  /** Show or hide every line. */
  setVisible(visible: boolean): void {
    for (const line of this.lines) {
      line.visible = visible;
    }
  }
}

/** Whether a line through `points` has a segment whose box meets `rect` */
function crosses(points: readonly Vector3[], rect: LocalRect): boolean {
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[i + 1] ?? a;
    if (Math.max(a.x, b.x) < rect.minX || Math.min(a.x, b.x) > rect.maxX) continue;
    if (Math.max(a.z, b.z) < rect.minZ || Math.min(a.z, b.z) > rect.maxZ) continue;
    return true;
  }
  return false;
}
