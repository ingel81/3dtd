import { BufferAttribute, BufferGeometry, Mesh, Vector2, type ShaderMaterial } from 'three';
import type { MapRiver, MapRiverPoint } from '../../map-document';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { createWaterMaterial, setWaterColor, setWaterSky } from './water-material';

/**
 * A river or lava flow: a ribbon along the river's line (Catmull-Rom through
 * its points, a row every 2 m), as wide and as high as the points say,
 * flowing from the first point to the last. The water material cuts it
 * where the terrain rises above the surface and fades its sides, and moves
 * its waves (or lava crust) downstream at a speed that grows with the drop.
 */

const STEP = 2;
const ACROSS = 8;

/** Smooth line through the points, a sample about every `step` metres */
export function sampleRiver(points: MapRiverPoint[], step = STEP): MapRiverPoint[] {
  const out: MapRiverPoint[] = [];
  for (let s = 0; s < points.length - 1; s++) {
    const p0 = points[Math.max(0, s - 1)];
    const p1 = points[s];
    const p2 = points[s + 1];
    const p3 = points[Math.min(points.length - 1, s + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({
        x: cr(p0.x, p1.x, p2.x, p3.x),
        y: cr(p0.y, p1.y, p2.y, p3.y),
        // Width and height linear: a spline could overshoot and make the river run uphill
        width: p1.width + (p2.width - p1.width) * t,
        height: p1.height + (p2.height - p1.height) * t,
      });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

export class RiverSurface {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;

  constructor(
    field: HeightField,
    heights: HeightTexture,
    river: MapRiver,
  ) {
    const material = createWaterMaterial({
      kind: river.kind,
      river: true,
      heights,
      color: river.color ?? '',
      mapHalf: new Vector2(((field.columns - 1) * field.cellSize) / 2, ((field.rows - 1) * field.cellSize) / 2),
    });
    this.mesh = new Mesh(buildRiver(river), material);
    this.mesh.name = `custom-map-river-${river.id}`;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
  }

  set(river: MapRiver): void {
    setWaterColor(this.mesh.material, river.kind, river.color ?? '');
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildRiver(river);
  }

  setSky(skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number): void {
    setWaterSky(this.mesh.material, skyUniforms, sunIntensity);
  }

  update(dt: number): void {
    this.mesh.material.uniforms['uTime'].value += dt;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

function buildRiver(river: MapRiver): BufferGeometry {
  const line = river.points.length >= 2 ? sampleRiver(river.points) : [];
  const rows = line.length;
  const pos = new Float32Array(rows * (ACROSS + 1) * 3);
  const flow = new Float32Array(rows * (ACROSS + 1) * 2);
  const across = new Float32Array(rows * (ACROSS + 1));
  const depth = new Float32Array(rows * (ACROSS + 1)).fill(1);
  for (let r = 0; r < rows; r++) {
    const a = line[Math.max(0, r - 1)];
    const b = line[Math.min(rows - 1, r + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const drop = Math.max(0, a.height - b.height) / len;
    // Flow speed in m/s from the slope: slow and wide on the flat, fast down a drop
    const speed = river.kind === 'lava' ? 0.4 + Math.min(1.5, drop * 15) : 0.5 + Math.min(3, drop * 40);
    const p = line[r];
    for (let c = 0; c <= ACROSS; c++) {
      const u = (c / ACROSS) * 2 - 1;
      // Map: left normal of the direction (tx, ty) is (-ty, tx)
      const mx = p.x - ty * u * (p.width / 2);
      const my = p.y + tx * u * (p.width / 2);
      const k = r * (ACROSS + 1) + c;
      pos.set([-mx, p.height, my], k * 3);
      // Scene direction of map (tx, ty) is (-tx, ty)
      flow.set([-tx * speed, ty * speed], k * 2);
      across[k] = u;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < ACROSS; c++) {
      const k = r * (ACROSS + 1) + c;
      const n = k + ACROSS + 1;
      // Both windings, the line may run either way
      index.push(k, n, k + 1, k + 1, n, n + 1, k, k + 1, n, k + 1, n + 1, n);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new BufferAttribute(flow, 2));
  g.setAttribute('aAcross', new BufferAttribute(across, 1));
  g.setAttribute('aDepth', new BufferAttribute(depth, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
