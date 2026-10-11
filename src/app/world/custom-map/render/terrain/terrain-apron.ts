import { BufferAttribute, BufferGeometry, Mesh, type Material } from 'three';
import type { HeightField } from '../height-field';

/**
 * Land beyond the map's edge, so a camera that looks past the border sees
 * hills fading into the fog instead of the void. Rings of growing
 * rectangles around the map: the innermost follows the border heights, the
 * outer ones drift towards gentle noise hills a little below the map.
 * Drawn with the terrain material (the shader paints it with the first
 * layer); not part of the map for line of sight or queries.
 */

/** Distances of the rings from the border, metres */
const RINGS = [0, 12, 40, 100, 220, 450, 900, 1600, 3000];
/** Points per rectangle side */
const SIDE_POINTS = 64;

export function buildTerrainApron(field: HeightField, material: Material): Mesh {
  const w = (field.columns - 1) * field.cellSize;
  const d = (field.rows - 1) * field.cellSize;
  const x0 = field.originX;
  const y0 = field.originY;
  const perRing = SIDE_POINTS * 4;
  const pos = new Float32Array(RINGS.length * perRing * 3);
  let meanBorder = 0;
  for (let k = 0; k < perRing; k++) {
    const [bx, by] = perimeter(k / perRing, x0, y0, w, d, 0);
    meanBorder += field.heightAt(bx, by) / perRing;
  }
  RINGS.forEach((dist, r) => {
    for (let k = 0; k < perRing; k++) {
      const t = k / perRing;
      const [x, y] = perimeter(t, x0, y0, w, d, dist);
      const [bx, by] = perimeter(t, x0, y0, w, d, 0);
      const border = field.heightAt(bx, by);
      // Border height near the map, then rolling hills settling a little below its mean
      const keep = Math.exp(-dist / 120);
      const hills = meanBorder - 4 + (hash(x * 0.004, y * 0.004) - 0.5) * 40 * Math.min(1, dist / 600);
      const h = r === 0 ? border : border * keep + hills * (1 - keep);
      const v = (r * perRing + k) * 3;
      pos[v] = -x;
      pos[v + 1] = h;
      pos[v + 2] = y;
    }
  });
  const index: number[] = [];
  for (let r = 0; r < RINGS.length - 1; r++) {
    for (let k = 0; k < perRing; k++) {
      const a = r * perRing + k;
      const b = r * perRing + ((k + 1) % perRing);
      const c = (r + 1) * perRing + k;
      const e = (r + 1) * perRing + ((k + 1) % perRing);
      // Perimeter runs counter-clockwise in map space; scene x is mirrored, so this winding faces up
      index.push(a, c, b, b, c, e);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-apron';
  mesh.receiveShadow = true;
  mesh.userData['losTransparent'] = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Point at fraction t along the rectangle grown by `grow` metres (counter-clockwise from the south-west) */
function perimeter(t: number, x0: number, y0: number, w: number, d: number, grow: number): [number, number] {
  const ax = x0 - grow;
  const ay = y0 - grow;
  const W = w + 2 * grow;
  const D = d + 2 * grow;
  const s = t * 4;
  const side = Math.floor(s);
  const f = s - side;
  switch (side) {
    case 0:
      return [ax + f * W, ay];
    case 1:
      return [ax + W, ay + f * D];
    case 2:
      return [ax + W - f * W, ay + D];
    default:
      return [ax, ay + D - f * D];
  }
}

/** Smooth value noise in 0..1 */
function hash(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const r = (i: number, j: number): number => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return (
    r(xi, yi) * (1 - u) * (1 - v) + r(xi + 1, yi) * u * (1 - v) + r(xi, yi + 1) * (1 - u) * v + r(xi + 1, yi + 1) * u * v
  );
}
