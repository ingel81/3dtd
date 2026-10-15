import { BufferAttribute, BufferGeometry, type Material } from 'three';

/**
 * Banner cloth that waves in the wind (a map's `life.flags`, object-layer.ts
 * wave block): the foliage cards named `foliage-banner*`. A card is a single
 * quad, which cannot bend; here it becomes a grid of small quads, and every
 * vertex learns how far down the cloth it hangs (`aHang`: 0 at the top edge
 * where it is fastened, 1 at the free end). Drawn still, the grid looks
 * like the quad.
 */

export function isCloth(material: Material): boolean {
  return material.name.startsWith('foliage-banner');
}

/**
 * The cloth part ready to wave: a quad in the model's x-y plane cut into
 * `columns` x `rows`, its uv spread over the grid; any other shape keeps its
 * vertices. Both get `aHang`
 */
export function clothGeometry(source: BufferGeometry, columns = 6, rows = 14): BufferGeometry {
  const pos = source.getAttribute('position');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let z = 0;
  for (let k = 0; k < pos.count; k++) {
    minX = Math.min(minX, pos.getX(k));
    maxX = Math.max(maxX, pos.getX(k));
    minY = Math.min(minY, pos.getY(k));
    maxY = Math.max(maxY, pos.getY(k));
    z += pos.getZ(k) / pos.count;
  }
  const span = Math.max(maxY - minY, 1e-6);
  const plain = Object.keys(source.attributes).every((name) => name === 'position' || name === 'normal' || name === 'uv');
  const corners = pos.count === 4 && plain && Math.abs(maxX - minX) > 1e-6 ? quadCorners(source, minX, maxX, minY, maxY) : null;
  if (!corners) {
    const out = source.clone();
    const hang = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) hang[k] = (maxY - pos.getY(k)) / span;
    out.setAttribute('aHang', new BufferAttribute(hang, 1));
    return out;
  }
  const normal = source.getAttribute('normal');
  const n = [0, 0, 0];
  if (normal) for (let k = 0; k < 4; k++) [n[0], n[1], n[2]] = [n[0] + normal.getX(k) / 4, n[1] + normal.getY(k) / 4, n[2] + normal.getZ(k) / 4];
  const count = (columns + 1) * (rows + 1);
  const position = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const hang = new Float32Array(count);
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let i = 0; i <= columns; i++) {
      const s = i / columns;
      const v = j * (columns + 1) + i;
      position.set([minX + (maxX - minX) * s, minY + span * t, z], v * 3);
      normals.set(n, v * 3);
      // The corners' uv, mixed by where the vertex lies between them
      const [a, b, c, d] = corners;
      uvs[v * 2] = (a[0] * (1 - s) + b[0] * s) * (1 - t) + (c[0] * (1 - s) + d[0] * s) * t;
      uvs[v * 2 + 1] = (a[1] * (1 - s) + b[1] * s) * (1 - t) + (c[1] * (1 - s) + d[1] * s) * t;
      hang[v] = 1 - t;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const v = j * (columns + 1) + i;
      index.push(v, v + 1, v + columns + 1, v + 1, v + columns + 2, v + columns + 1);
    }
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(position, 3));
  if (normal) out.setAttribute('normal', new BufferAttribute(normals, 3));
  if (source.getAttribute('uv')) out.setAttribute('uv', new BufferAttribute(uvs, 2));
  out.setAttribute('aHang', new BufferAttribute(hang, 1));
  out.setIndex(index);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** The uv of the quad's corners: bottom left, bottom right, top left, top right; null when they are not its four corners */
function quadCorners(g: BufferGeometry, minX: number, maxX: number, minY: number, maxY: number): [number, number][] | null {
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const out: ([number, number] | null)[] = [null, null, null, null];
  const near = (a: number, b: number) => Math.abs(a - b) <= (maxX - minX + maxY - minY) * 1e-3;
  for (let k = 0; k < 4; k++) {
    const right = near(pos.getX(k), maxX);
    const top = near(pos.getY(k), maxY);
    if (!right && !near(pos.getX(k), minX)) return null;
    if (!top && !near(pos.getY(k), minY)) return null;
    out[(top ? 2 : 0) + (right ? 1 : 0)] = uv ? [uv.getX(k), uv.getY(k)] : [0, 0];
  }
  return out.every((c) => c) ? (out as [number, number][]) : null;
}
