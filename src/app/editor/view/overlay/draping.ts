/**
 * What the overlay's layers share: laying lines and rings on the ground,
 * emptying a group, and the shape of a layer.
 */
import { BufferAttribute, BufferGeometry, Group, InstancedMesh, Line, LineBasicMaterial, LineLoop, type Mesh, Sprite } from 'three';
import type { MapPoint } from '../../../world/custom-map/map-document';

export type GroundHeight = (x: number, y: number) => number;

/** One layer of the overlay: it draws one kind of thing and can be emptied */
export interface OverlayLayer {
  /** Hides what the layer shows */
  clear(): void;
  dispose(): void;
}

export const RING_SEGMENTS = 72;

/** Metres between two points of a line laid on the ground: the height grid's cells are about this size */
const DRAPE_STEP_M = 2;

/**
 * Scene positions of a map polyline laid `lift` metres over `height`, each
 * piece cut into steps of at most DRAPE_STEP_M: a road between two points
 * far apart follows the hill it crosses instead of cutting through it.
 */
export function drapedLine(points: readonly MapPoint[], height: GroundHeight, lift: number): Float32Array {
  let count = 1;
  for (let k = 1; k < points.length; k++) {
    count += Math.max(1, Math.ceil(Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y) / DRAPE_STEP_M));
  }
  const pos = new Float32Array(count * 3);
  const put = (i: number, x: number, y: number) => {
    pos[i * 3] = -x;
    pos[i * 3 + 1] = height(x, y) + lift;
    pos[i * 3 + 2] = y;
  };
  put(0, points[0].x, points[0].y);
  let i = 1;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / DRAPE_STEP_M));
    for (let s = 1; s <= n; s++) put(i++, a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n);
  }
  return pos;
}

export function ring(color: string, opacity: number): LineLoop {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3));
  const loop = new LineLoop(geo, new LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
  loop.frustumCulled = false;
  loop.renderOrder = 10;
  return loop;
}

/** A ring of `radius` around a map point, laid on the ground, shown */
export function drape(loop: LineLoop, c: MapPoint, radius: number, height: GroundHeight): void {
  const pos = loop.geometry.attributes['position'] as BufferAttribute;
  for (let k = 0; k < RING_SEGMENTS; k++) {
    const a = (k / RING_SEGMENTS) * Math.PI * 2;
    const x = c.x + Math.cos(a) * radius;
    const y = c.y + Math.sin(a) * radius;
    pos.setXYZ(k, -x, height(x, y) + 0.4, y);
  }
  pos.needsUpdate = true;
  loop.geometry.computeBoundingSphere();
  loop.visible = true;
}

/** A line laid on the ground again: each point `lift` metres over `height` where it stands */
export function relift(line: Line, height: GroundHeight, lift: number): void {
  const pos = line.geometry.attributes['position'] as BufferAttribute;
  for (let k = 0; k < pos.count; k++) pos.setY(k, height(-pos.getX(k), pos.getZ(k)) + lift);
  pos.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}

/** Takes everything out of a group and frees its geometry (the shared sphere and kept name tags stay) */
export function clearGroup(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    // A name tag's geometry is three's own and its material is kept by the markers (tags)
    if (child instanceof Sprite) continue;
    child.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry && mesh.geometry.type !== 'SphereGeometry') mesh.geometry.dispose();
      // Instances keep their own buffers on the GPU (the shared sphere stays)
      if (o instanceof InstancedMesh) o.dispose();
    });
  }
}
