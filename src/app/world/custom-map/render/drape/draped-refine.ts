/**
 * A draped tile (draped-layer.ts) laid closer where the ground under it
 * dropped (a crater, docs/WATER_NETWORK_PLAN.md step 3): its vertices take
 * their height from the terrain, but between them the triangle is flat, so a
 * crater narrower than a road's width or a car park's flat cell was spanned
 * by an arch. Within a rectangle, a triangle whose ground stands more than
 * REFINE_TOLERANCE off its plane and whose longest edge is longer than the
 * ground's cell is split in four at its edges' middles, again and again; the
 * middles are shared by the triangles of an edge (no cracks between two that
 * split), every attribute takes the mean of the edge's two ends (they are
 * linear across a triangle). Triangles outside the rectangle, or flat over
 * their ground, stay as they are: a tile grows by the few triangles over a
 * crater, not by a grid over the map. Pure, without three.
 */

/** A tile's geometry as DrapedTiles keeps it: map positions (x, y), attributes by name, triangles */
export interface DrapedGeometry {
  position: Float32Array;
  attributes: Readonly<Record<string, { array: Float32Array; itemSize: number }>>;
  index: Uint32Array;
}

/** Metres the ground may stand off a triangle's plane before it is split */
export const REFINE_TOLERANCE = 0.1;
/** Most triangles a tile may grow to: past it a crater is spanned again (a guard far beyond a run's craters) */
export const REFINE_MAX_TRIANGLES = 400_000;

/**
 * The tile split where its ground left its triangles in `rect` (map metres),
 * down to triangles of edge `cell`; null when nothing changed
 */
export function refineDraped(
  tile: DrapedGeometry,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  heightAt: (x: number, y: number) => number,
  cell: number,
  maxTriangles = REFINE_MAX_TRIANGLES,
): DrapedGeometry | null {
  const x0 = rect.minX - cell;
  const y0 = rect.minY - cell;
  const x1 = rect.maxX + cell;
  const y1 = rect.maxY + cell;
  const idx = tile.index;
  // First whether any triangle needs it, without copying the tile (most passes over a tile split nothing)
  if (idx.length / 3 >= maxTriangles) return null;
  const p0 = tile.position;
  let any = false;
  for (let t = 0; t < idx.length && !any; t += 3) {
    if (!meets(p0, idx[t], idx[t + 1], idx[t + 2], x0, y0, x1, y1)) continue;
    any = needsSplit(p0, idx[t], idx[t + 1], idx[t + 2], heightAt, cell, x0, y0, x1, y1);
  }
  if (!any) return null;
  const pos: number[] = Array.from(tile.position);
  const names = Object.keys(tile.attributes);
  const attrs = names.map((n) => ({ name: n, size: tile.attributes[n].itemSize, data: Array.from(tile.attributes[n].array) }));
  const out: number[] = [];
  const middles = new Map<number, number>();
  let changed = false;
  let triangles = tile.index.length / 3;
  const vertices = () => pos.length / 2;
  /** The middle of edge a-b, made once for both triangles of the edge */
  const middle = (a: number, b: number): number => {
    const key = a < b ? a * 0x200000 + b : b * 0x200000 + a;
    const known = middles.get(key);
    if (known !== undefined) return known;
    const m = vertices();
    pos.push((pos[a * 2] + pos[b * 2]) / 2, (pos[a * 2 + 1] + pos[b * 2 + 1]) / 2);
    for (const at of attrs) for (let c = 0; c < at.size; c++) at.data.push((at.data[a * at.size + c] + at.data[b * at.size + c]) / 2);
    middles.set(key, m);
    return m;
  };
  const split = (a: number, b: number, c: number, depth: number): void => {
    if (depth > 0 && triangles + 3 <= maxTriangles && needsSplit(pos, a, b, c, heightAt, cell, x0, y0, x1, y1)) {
      const ab = middle(a, b);
      const bc = middle(b, c);
      const ca = middle(c, a);
      triangles += 3;
      changed = true;
      split(a, ab, ca, depth - 1);
      split(ab, b, bc, depth - 1);
      split(ca, bc, c, depth - 1);
      split(ab, bc, ca, depth - 1);
      return;
    }
    out.push(a, b, c);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (!meets(pos, a, b, c, x0, y0, x1, y1)) {
      out.push(a, b, c);
      continue;
    }
    // Deep enough for a 64 m cell down to a 2 m one, and a little past
    split(a, b, c, 8);
  }
  if (!changed) return null;
  const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
  for (const at of attrs) attributes[at.name] = { array: Float32Array.from(at.data), itemSize: at.size };
  return { position: Float32Array.from(pos), attributes, index: Uint32Array.from(out) };
}

/** Whether triangle a-b-c's box meets the rectangle x0, y0 to x1, y1 */
function meets(pos: ArrayLike<number>, a: number, b: number, c: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return !(
    Math.max(pos[a * 2], pos[b * 2], pos[c * 2]) < x0 ||
    Math.min(pos[a * 2], pos[b * 2], pos[c * 2]) > x1 ||
    Math.max(pos[a * 2 + 1], pos[b * 2 + 1], pos[c * 2 + 1]) < y0 ||
    Math.min(pos[a * 2 + 1], pos[b * 2 + 1], pos[c * 2 + 1]) > y1
  );
}

/**
 * Whether triangle a-b-c is longer than a cell and its ground stands off its plane: at its middles, and at the
 * ground's samples in it within the changed rectangle (x0, y0 to x1, y1; outside it the ground did not move)
 */
function needsSplit(
  pos: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  heightAt: (x: number, y: number) => number,
  cell: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const ax = pos[a * 2];
  const ay = pos[a * 2 + 1];
  const bx = pos[b * 2];
  const by = pos[b * 2 + 1];
  const cx = pos[c * 2];
  const cy = pos[c * 2 + 1];
  const longest = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - bx, cy - by), Math.hypot(ax - cx, ay - cy));
  if (longest <= cell * 1.05) return false;
  const ha = heightAt(ax, ay);
  const hb = heightAt(bx, by);
  const hc = heightAt(cx, cy);
  const off = (u: number, v: number) => {
    const w = 1 - u - v;
    return Math.abs(heightAt(ax * w + bx * u + cx * v, ay * w + by * u + cy * v) - (ha * w + hb * u + hc * v)) > REFINE_TOLERANCE;
  };
  // The middles of the edges and the centre
  if (off(0.5, 0) || off(0.5, 0.5) || off(0, 0.5) || off(1 / 3, 1 / 3)) return true;
  // The ground's samples inside: a pit narrower than the triangle between them
  const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(det) < 1e-9) return false;
  const minX = Math.max(x0, Math.min(ax, bx, cx));
  const maxX = Math.min(x1, Math.max(ax, bx, cx));
  const minY = Math.max(y0, Math.min(ay, by, cy));
  const maxY = Math.min(y1, Math.max(ay, by, cy));
  for (let y = Math.ceil(minY / cell) * cell; y <= maxY; y += cell) {
    for (let x = Math.ceil(minX / cell) * cell; x <= maxX; x += cell) {
      const u = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det;
      const v = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      if (off(u, v)) return true;
    }
  }
  return false;
}

/**
 * Takes the triangles of `tile` that need splitting in `rect` out of it: a
 * geometry of their own (their vertices copied, the attributes with them),
 * and in the tile each of them made degenerate (its three corners on one
 * vertex: drawn as nothing, the index keeps its length, so the tile's
 * buffers need no copy). Null when none needs it
 */
export function takeSplitting(
  tile: DrapedGeometry,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  heightAt: (x: number, y: number) => number,
  cell: number,
  /** The tile's triangles by where they lie (triangleBuckets): only those near the rectangle are looked at */
  buckets?: TriangleBuckets | null,
): DrapedGeometry | null {
  const x0 = rect.minX - cell;
  const y0 = rect.minY - cell;
  const x1 = rect.maxX + cell;
  const y1 = rect.maxY + cell;
  const idx = tile.index;
  const p = tile.position;
  const taken: number[] = [];
  const candidates = buckets ? near(buckets, x0, y0, x1, y1) : null;
  const count = candidates ? candidates.length : idx.length / 3;
  for (let n = 0; n < count; n++) {
    const t = candidates ? candidates[n] : n * 3;
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (a === b && b === c) continue;
    if (meets(p, a, b, c, x0, y0, x1, y1) && needsSplit(p, a, b, c, heightAt, cell, x0, y0, x1, y1)) taken.push(t);
  }
  if (!taken.length) return null;
  const remap = new Map<number, number>();
  const pos: number[] = [];
  const names = Object.keys(tile.attributes);
  const data = names.map(() => [] as number[]);
  const index: number[] = [];
  const vertex = (v: number): number => {
    let m = remap.get(v);
    if (m === undefined) {
      m = pos.length / 2;
      remap.set(v, m);
      pos.push(p[v * 2], p[v * 2 + 1]);
      names.forEach((n, k) => {
        const a = tile.attributes[n];
        for (let c = 0; c < a.itemSize; c++) data[k].push(a.array[v * a.itemSize + c]);
      });
    }
    return m;
  };
  for (const t of taken) {
    index.push(vertex(idx[t]), vertex(idx[t + 1]), vertex(idx[t + 2]));
    idx[t + 1] = idx[t];
    idx[t + 2] = idx[t];
  }
  const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
  names.forEach((n, k) => (attributes[n] = { array: Float32Array.from(data[k]), itemSize: tile.attributes[n].itemSize }));
  return { position: Float32Array.from(pos), attributes, index: Uint32Array.from(index) };
}

/**
 * A tile's triangles (their first index) by the square cells of `size`
 * metres their box meets, over the box of its vertices: per cell a run of
 * `items` from `starts` (one list for all, no array per cell)
 */
export interface TriangleBuckets {
  size: number;
  x0: number;
  y0: number;
  columns: number;
  rows: number;
  starts: Uint32Array;
  items: Uint32Array;
}

/** The triangles of a geometry by the cells their boxes meet (two passes: how many per cell, then each in place) */
export function triangleBuckets(g: DrapedGeometry, size = 32): TriangleBuckets {
  const p = g.position;
  const idx = g.index;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < p.length; k += 2) {
    const x = p[k];
    const y = p[k + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxX >= minX)) return { size, x0: 0, y0: 0, columns: 0, rows: 0, starts: new Uint32Array(1), items: new Uint32Array(0) };
  const columns = Math.floor((maxX - minX) / size) + 1;
  const rows = Math.floor((maxY - minY) / size) + 1;
  const starts = new Uint32Array(columns * rows + 1);
  let items = new Uint32Array(0);
  let fill = starts;
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      for (let c = 0; c < columns * rows; c++) starts[c + 1] += starts[c];
      fill = starts.slice(0, columns * rows);
      items = new Uint32Array(starts[columns * rows]);
    }
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 2;
      const b = idx[t + 1] * 2;
      const c = idx[t + 2] * 2;
      const ax = p[a];
      const bx = p[b];
      const cx = p[c];
      const ay = p[a + 1];
      const by = p[b + 1];
      const cy = p[c + 1];
      const i0 = ((ax < bx ? (ax < cx ? ax : cx) : bx < cx ? bx : cx) - minX) / size | 0;
      const i1 = ((ax > bx ? (ax > cx ? ax : cx) : bx > cx ? bx : cx) - minX) / size | 0;
      const j0 = ((ay < by ? (ay < cy ? ay : cy) : by < cy ? by : cy) - minY) / size | 0;
      const j1 = ((ay > by ? (ay > cy ? ay : cy) : by > cy ? by : cy) - minY) / size | 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (pass === 0) starts[j * columns + i + 1]++;
          else items[fill[j * columns + i]++] = t;
        }
      }
    }
  }
  return { size, x0: minX, y0: minY, columns, rows, starts, items };
}

/** The triangles in the cells a rectangle meets, each once */
function near(b: TriangleBuckets, x0: number, y0: number, x1: number, y1: number): number[] {
  const i0 = Math.max(0, Math.floor((x0 - b.x0) / b.size));
  const i1 = Math.min(b.columns - 1, Math.floor((x1 - b.x0) / b.size));
  const j0 = Math.max(0, Math.floor((y0 - b.y0) / b.size));
  const j1 = Math.min(b.rows - 1, Math.floor((y1 - b.y0) / b.size));
  const seen = new Set<number>();
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * b.columns + i;
      for (let n = b.starts[c]; n < b.starts[c + 1]; n++) seen.add(b.items[n]);
    }
  }
  return [...seen];
}

/** Two geometries of the same attributes as one */
export function mergeDraped(a: DrapedGeometry, b: DrapedGeometry): DrapedGeometry {
  const offset = a.position.length / 2;
  const position = new Float32Array(a.position.length + b.position.length);
  position.set(a.position);
  position.set(b.position, a.position.length);
  const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
  for (const [name, at] of Object.entries(a.attributes)) {
    const other = b.attributes[name];
    const array = new Float32Array(at.array.length + other.array.length);
    array.set(at.array);
    array.set(other.array, at.array.length);
    attributes[name] = { array, itemSize: at.itemSize };
  }
  const index = new Uint32Array(a.index.length + b.index.length);
  index.set(a.index);
  for (let k = 0; k < b.index.length; k++) index[a.index.length + k] = b.index[k] + offset;
  return { position, attributes, index };
}
