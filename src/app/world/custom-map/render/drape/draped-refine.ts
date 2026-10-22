import type { MapHeightGrid } from '../../map-document';

/**
 * A draped surface (draped-layer.ts) laid onto the ground's triangles. Its
 * vertices take their height from the terrain, but between them a triangle
 * is flat, while the terrain bends at every line of its grid and along the
 * diagonal of each cell (height-field.ts cellSplit). Over a crest, a hollow,
 * a slope that turns or a crater the ground rose through the surface (a
 * junction fanned over twenty metres of a hill, a lane up a steep street)
 * and showed in grey patches that flickered as the camera moved, the
 * surface's small pull towards the camera winning here and losing there.
 *
 * So a triangle the ground leaves by more than REFINE_TOLERANCE is cut
 * along the lines where the ground bends (conformDraped): the line through
 * the point where it leaves the ground most, a grid line or a cell's
 * diagonal, across all the triangle's pieces, again until every piece lies
 * within the tolerance. The ground is flat between those lines, so a piece
 * cut along all of them would lie on it exactly; one cut along the few that
 * matter lies within the tolerance. A triangle over ground that is one plane
 * (a road levelled across, a flat square) stays as it is. The corners a cut
 * makes on a triangle's edges are kept in a list, and a triangle with such
 * a point on a side (its neighbour was cut there) is split there too: no
 * crack where two meet, and as its parts' corners lie on the ground, they
 * lie within twice the tolerance. Every attribute is interpolated linearly
 * (they are linear across a triangle). Pure, without three.
 *
 * Erlenbach's roads (2.4 km, a hilly town): 220 000 triangles, 20 700 of
 * them with the ground more than 3 cm over them and up to 3.4 m; laid onto
 * it 630 000, none, in 0.7 to 0.9 s (Node, once when the map loads).
 */

/** A tile's geometry as DrapedTiles keeps it: map positions (x, y), attributes by name, triangles */
export interface DrapedGeometry {
  position: Float32Array;
  attributes: Readonly<Record<string, { array: Float32Array; itemSize: number }>>;
  index: Uint32Array;
}

/** The ground a draped surface lies on: the height grid (HeightField) */
export interface DrapeGround {
  readonly grid: MapHeightGrid;
  /** Map position of sample (0, 0) */
  readonly originX: number;
  readonly originY: number;
  /** Height at a map point, on the cells' two triangles */
  heightAt(x: number, y: number): number;
}

/** A rectangle in map metres */
export interface DrapeRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Metres the ground may stand off a triangle before the triangle is cut.
 * Twice of it (a triangle split at its neighbour's points) stays within the
 * roads' pull towards the camera (3 cm, DrapePull): the ground never comes
 * through
 */
export const REFINE_TOLERANCE = 0.012;
/** Most triangles a tile may grow to over craters: past it a crater is spanned again (a guard far beyond a run's craters) */
export const REFINE_MAX_TRIANGLES = 400_000;
/**
 * Metres within which a point is taken to lie on a line or at a segment's end: points are kept in 32 bits, a
 * kilometre out a few hundredths of a millimetre apart
 */
const END_GAP = 1e-4;
/** Most pieces a triangle is cut into (a guard: all the ground's lines in a triangle lay it exactly) */
const MAX_PIECES = 1024;

/** Options of conformDraped */
export interface ConformOptions {
  /** Only triangles meeting this rectangle are looked at (where the ground changed) */
  rect?: DrapeRect;
  /**
   * Edges (x0, y0, x1, y1 each) whose crossings of the ground's lines are corners whatever the triangles at them
   * need: where a geometry meets another one laid on its own (a road's end at its junction), both carry the same
   */
  forced?: readonly number[];
  /** Most triangles of all the geometries together: past it the rest stays as it is */
  maxTriangles?: number;
}

/**
 * The geometries laid onto the ground (see the file's comment), as one: a
 * point one of them took on an edge is a corner of every triangle at that
 * edge. Null for a geometry nothing changed in
 */
export function conformDraped(geometries: readonly DrapedGeometry[], ground: DrapeGround, options: ConformOptions = {}): (DrapedGeometry | null)[] {
  const rect = options.rect;
  const margin = ground.grid.cellSize;
  const box = rect ? [rect.minX - margin, rect.minY - margin, rect.maxX + margin, rect.maxY + margin] : null;
  const lines = new GroundLines(ground);
  const points = new LaidPoints();
  const forced = options.forced ?? [];
  for (let k = 0; k + 3 < forced.length; k += 4) {
    const n = lines.cross(forced[k], forced[k + 1], forced[k + 2], forced[k + 3]);
    for (let q = 0; q < n; q++) points.add(lines.xs[q], lines.ys[q]);
  }
  let triangles = 0;
  for (const g of geometries) triangles += g.index.length / 3;
  const budget = { left: (options.maxTriangles ?? Infinity) - triangles };
  const cutter = new TriangleCutter(ground, lines);
  // First every triangle that leaves the ground cut where it does, the corners on its edges into the list
  const laid = geometries.map((g) => {
    const out = new ConformedGeometry(g, points);
    const p = g.position;
    const idx = g.index;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      if (a === b && b === c) out.keep(t);
      else if (budget.left <= 0 || (box && !meets(p, a, b, c, box[0], box[1], box[2], box[3]))) out.keep(t);
      else {
        const pieces = cutter.cut(p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1], p[c * 2], p[c * 2 + 1]);
        if (!pieces) out.keep(t);
        else {
          out.pieces(t, pieces);
          for (const piece of pieces) budget.left -= piece.length / 2 - 3;
          budget.left -= pieces.length - 1;
        }
      }
    }
    return out;
  });
  if (!points.size) return geometries.map(() => null);
  // Then every triangle with a point of the list on a side is split there
  return laid.map((out) => out.result());
}

/**
 * The tile laid onto the ground where it changed in `rect` (map metres): its
 * triangles there cut where the ground left them (conformDraped); null when
 * nothing changed
 */
export function refineDraped(tile: DrapedGeometry, rect: DrapeRect, ground: DrapeGround, maxTriangles = REFINE_MAX_TRIANGLES): DrapedGeometry | null {
  if (tile.index.length / 3 >= maxTriangles) return null;
  return conformDraped([tile], ground, { rect, maxTriangles })[0];
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

/** A line a x + b y + c = 0 */
type Line = [number, number, number];

/**
 * Where the ground leaves a triangle most: by how much past the tolerance,
 * the point, and the line of the ground through it (where an edge crosses a
 * line, that line, a diagonal with its cell; at a sample of the grid, the
 * grid line through it across which the ground bends more)
 */
interface Worst {
  off: number;
  x: number;
  y: number;
  kind: number;
  value: number;
  /** The cell of a diagonal (j columns + i) */
  cell: number;
}

/**
 * Where the ground under triangle a-b-c (map points; the surface between
 * the ground's heights at them) stands off it by more than REFINE_TOLERANCE,
 * the most; null when nowhere. The
 * difference is linear between the lines where the ground bends, so it is
 * looked at where the edges cross them and at the grid's samples inside
 */
function worstPoint(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, ground: DrapeGround, lines: GroundLines): Worst | null {
  const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(det) < 1e-9) return null;
  const ha = ground.heightAt(ax, ay);
  const hb = ground.heightAt(bx, by);
  const hc = ground.heightAt(cx, cy);
  // The plane through the corners: its height at (x, y) is ha + gx (x - ax) + gy (y - ay)
  const gx = ((hb - ha) * (cy - ay) - (hc - ha) * (by - ay)) / det;
  const gy = ((hc - ha) * (bx - ax) - (hb - ha) * (cx - ax)) / det;
  let most = 0;
  let wx = 0;
  let wy = 0;
  let wKind = -1;
  let wValue = 0;
  let wCell = -1;
  let wi = -1;
  let wj = -1;
  for (let e = 0; e < 3; e++) {
    const n = e === 0 ? lines.cross(ax, ay, bx, by) : e === 1 ? lines.cross(bx, by, cx, cy) : lines.cross(cx, cy, ax, ay);
    const xs = lines.xs;
    const ys = lines.ys;
    const hs = lines.hs;
    for (let q = 0; q < n; q++) {
      const off = Math.abs(hs[q] - (ha + gx * (xs[q] - ax) + gy * (ys[q] - ay))) - REFINE_TOLERANCE;
      if (off > most) {
        most = off;
        wx = xs[q];
        wy = ys[q];
        wKind = lines.kinds[q];
        wValue = lines.values[q];
        wCell = lines.cells[q];
      }
    }
  }
  const { grid, originX, originY } = ground;
  const cell = grid.cellSize;
  const h = grid.heights;
  const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - originX) / cell));
  const i1 = Math.min(grid.columns - 1, Math.floor((Math.max(ax, bx, cx) - originX) / cell));
  const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - originY) / cell));
  const j1 = Math.min(grid.rows - 1, Math.floor((Math.max(ay, by, cy) - originY) / cell));
  // Samples strictly inside (one on an edge is a crossing of that edge)
  const inset = 1e-6;
  for (let j = j0; j <= j1; j++) {
    const y = originY + j * cell;
    for (let i = i0; i <= i1; i++) {
      const x = originX + i * cell;
      const u = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det;
      const v = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det;
      if (u <= inset || v <= inset || u + v >= 1 - inset) continue;
      const off = Math.abs(h[j * grid.columns + i] - (ha + gx * (x - ax) + gy * (y - ay))) - REFINE_TOLERANCE;
      if (off > most) {
        most = off;
        wx = x;
        wy = y;
        wi = i;
        wj = j;
      }
    }
  }
  if (most <= 0) return null;
  if (wi >= 0) {
    // A sample: of its two grid lines, the one across which the ground bends more (a diagonal is cut within its cell
    // only, TriangleCutter, once a piece lies in it)
    const at = (i: number, j: number) => h[Math.max(0, Math.min(grid.rows - 1, j)) * grid.columns + Math.max(0, Math.min(grid.columns - 1, i))];
    const here = 2 * at(wi, wj);
    const acrossX = Math.abs(at(wi - 1, wj) - here + at(wi + 1, wj));
    const acrossY = Math.abs(at(wi, wj - 1) - here + at(wi, wj + 1));
    return acrossX >= acrossY ? { off: most, x: wx, y: wy, kind: LINE_X, value: wx, cell: -1 } : { off: most, x: wx, y: wy, kind: LINE_Y, value: wy, cell: -1 };
  }
  return { off: most, x: wx, y: wy, kind: wKind, value: wValue, cell: wCell };
}

/** Kinds of the ground's lines: x = v, y = v, x - y = v, x + y = v */
const LINE_X = 0;
const LINE_Y = 1;
const LINE_MAIN = 2;
const LINE_OTHER = 3;

/** A line of the ground by its kind and value, as a x + b y + c = 0 */
function lineOf(kind: number, v: number): Line {
  return kind === LINE_X ? [1, 0, -v] : kind === LINE_Y ? [0, 1, -v] : kind === LINE_MAIN ? [1, -1, -v] : [1, 1, -v];
}

/**
 * Where a segment crosses the ground's grid lines and, within each cell,
 * the cell's diagonal (the one cellSplit picks): a function of the segment
 * alone, the same from either end; positions rounded as the vertices keep
 * them. `cross` fills `xs`, `ys`, the ground's height there `hs` (along the
 * line crossed, as the ground's triangles have it) and the kind and value of
 * each one's line
 */
class GroundLines {
  xs = new Float64Array(64);
  ys = new Float64Array(64);
  hs = new Float64Array(64);
  kinds = new Int32Array(64);
  values = new Float64Array(64);
  /** The cell of a diagonal's crossing (j columns + i), -1 for a grid line's */
  cells = new Int32Array(64);
  /** The crossings as found: where along, line kind, value, and the cell or grid line they are on */
  private ts = new Float64Array(64);
  private ks = new Int32Array(64);
  private vs = new Float64Array(64);
  private at = new Int32Array(64);
  private order = new Int32Array(64);

  constructor(private readonly ground: DrapeGround) {}

  /** The crossings from p to q, not its ends, in order from p; how many */
  cross(px: number, py: number, qx: number, qy: number): number {
    return px > qx || (px === qx && py > qy) ? this.from(qx, qy, px, py, true) : this.from(px, py, qx, qy, false);
  }

  private push(n: number, t: number, kind: number, v: number, at: number): number {
    if (n === this.ts.length) {
      const grow = <T extends Float64Array | Int32Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.ts = grow(this.ts);
      this.ks = grow(this.ks);
      this.vs = grow(this.vs);
      this.at = grow(this.at);
      this.order = new Int32Array(this.ts.length);
      this.xs = new Float64Array(this.ts.length);
      this.ys = new Float64Array(this.ts.length);
      this.hs = new Float64Array(this.ts.length);
      this.kinds = new Int32Array(this.ts.length);
      this.values = new Float64Array(this.ts.length);
      this.cells = new Int32Array(this.ts.length);
    }
    this.ts[n] = t;
    this.ks[n] = kind;
    this.vs[n] = v;
    this.at[n] = at;
    return n + 1;
  }

  /** The crossings from p to q (p the smaller end), sorted along it, written from the far end when `back` */
  private from(px: number, py: number, qx: number, qy: number, back: boolean): number {
    const { grid, originX, originY } = this.ground;
    const cell = grid.cellSize;
    const cols = grid.columns;
    const h = grid.heights;
    const dx = qx - px;
    const dy = qy - py;
    // Crossings closer to an end than END_GAP are that end (the points are kept in 32 bits)
    const gap = END_GAP / Math.max(Math.hypot(dx, dy), 1e-9);
    let n = 0;
    if (dx > 1e-12) {
      const i1 = Math.min(cols - 1, Math.floor((qx - originX) / cell));
      for (let i = Math.max(0, Math.ceil((px - originX) / cell)); i <= i1; i++) {
        const x = originX + i * cell;
        const t = (x - px) / dx;
        if (t > gap && t < 1 - gap) n = this.push(n, t, LINE_X, x, i);
      }
    }
    const xLines = n;
    if (Math.abs(dy) > 1e-12) {
      // In order from p: up the rows when the segment rises, down when it falls
      const j0 = Math.max(0, Math.ceil((Math.min(py, qy) - originY) / cell));
      const j1 = Math.min(grid.rows - 1, Math.floor((Math.max(py, qy) - originY) / cell));
      for (let k = 0; k <= j1 - j0; k++) {
        const j = dy > 0 ? j0 + k : j1 - k;
        const y = originY + j * cell;
        const t = (y - py) / dy;
        if (t > gap && t < 1 - gap) n = this.push(n, t, LINE_Y, y, j);
      }
    }
    // The grid's crossings in order (the x ones and the y ones each in order already): merged
    const order = this.order;
    const ts = this.ts;
    let a = 0;
    let b = xLines;
    for (let k = 0; k < n; k++) order[k] = b >= n || (a < xLines && ts[a] <= ts[b]) ? a++ : b++;
    // Between two crossings the segment runs in one cell: where it crosses that cell's diagonal
    const gridCount = n;
    for (let k = 0; k <= gridCount; k++) {
      const t0 = k === 0 ? 0 : ts[order[k - 1]];
      const t1 = k === gridCount ? 1 : ts[order[k]];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      const i = Math.floor((px + dx * tm - originX) / cell);
      const j = Math.floor((py + dy * tm - originY) / cell);
      if (i < 0 || j < 0 || i >= cols - 1 || j >= grid.rows - 1) continue;
      const c = j * cols + i;
      const cx = originX + i * cell;
      const cy = originY + j * cell;
      // Main diagonal: x - y constant through the cell's lower corner; the other: x + y through its other two
      const main = Math.abs(h[c] - h[c + cols + 1]) <= Math.abs(h[c + 1] - h[c + cols]);
      const v = main ? cx - cy : cx + cy + cell;
      const s0 = (main ? px + dx * t0 - (py + dy * t0) : px + dx * t0 + (py + dy * t0)) - v;
      const s1 = (main ? px + dx * t1 - (py + dy * t1) : px + dx * t1 + (py + dy * t1)) - v;
      if ((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0)) {
        const t = t0 + ((t1 - t0) * s0) / (s0 - s1);
        if (t > gap && t < 1 - gap) n = this.push(n, t, main ? LINE_MAIN : LINE_OTHER, v, c);
      }
    }
    // All in order (each diagonal one after the grid crossing before it), with the ground's height along its line
    let d = gridCount;
    let w = 0;
    const take = (q: number) => {
      const t = ts[q];
      const x = px + dx * t;
      const y = py + dy * t;
      const kind = this.ks[q];
      const at = this.at[q];
      let height: number;
      if (kind === LINE_X) {
        const f = Math.min(grid.rows - 1.000001, Math.max(0, (y - originY) / cell));
        const j = Math.floor(f);
        height = h[j * cols + at] + (h[(j + 1) * cols + at] - h[j * cols + at]) * (f - j);
      } else if (kind === LINE_Y) {
        const f = Math.min(cols - 1.000001, Math.max(0, (x - originX) / cell));
        const i = Math.floor(f);
        height = h[at * cols + i] + (h[at * cols + i + 1] - h[at * cols + i]) * (f - i);
      } else {
        const ci = at % cols;
        const f = (x - originX) / cell - ci;
        height = kind === LINE_MAIN ? h[at] + (h[at + cols + 1] - h[at]) * f : h[at + cols] + (h[at + 1] - h[at + cols]) * f;
      }
      const o = back ? n - 1 - w : w;
      w++;
      this.xs[o] = Math.fround(x);
      this.ys[o] = Math.fround(y);
      this.hs[o] = height;
      this.kinds[o] = kind;
      this.values[o] = this.vs[q];
      this.cells[o] = kind === LINE_X || kind === LINE_Y ? -1 : at;
    };
    for (let k = 0; k < gridCount; k++) {
      while (d < n && ts[d] < ts[order[k]]) take(d++);
      take(order[k]);
    }
    while (d < n) take(d++);
    return n;
  }
}

/**
 * A triangle cut along the ground's lines where the ground leaves it: the
 * worst piece along the line through its worst point, again until every
 * piece lies within the tolerance. A grid line is a line of the ground all
 * along; a cell's diagonal is one within its cell only, so a piece reaching
 * past the cell is first cut along the cell's side nearest the point. So
 * every corner a cut makes lies where the triangle's edges cross the
 * ground's lines (GroundLines, the same for whoever shares an edge) or on
 * the grid's samples. The pieces are convex polygons (x, y in turn,
 * counter-clockwise), each looked at as the triangles `earClip` makes of it
 */
class TriangleCutter {
  private readonly tri: number[] = [];

  constructor(
    private readonly ground: DrapeGround,
    private readonly lines: GroundLines,
  ) {}

  /** The pieces of triangle a-b-c (counter-clockwise), null when it lies on the ground as it is */
  cut(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number[][] | null {
    const first = worstPoint(ax, ay, bx, by, cx, cy, this.ground, this.lines);
    if (!first) return null;
    const out: number[][] = [];
    const open: { pts: number[]; worst: Worst }[] = [{ pts: [ax, ay, bx, by, cx, cy], worst: first }];
    while (open.length) {
      const piece = open.pop()!;
      const halves = out.length + open.length < MAX_PIECES ? splitPolygon(piece.pts, this.lineFor(piece.pts, piece.worst)) : null;
      // A line that cuts nothing (it only touches the piece at a corner): the piece stays as it is
      if (!halves) {
        out.push(piece.pts);
        continue;
      }
      for (const h of halves) {
        const worst = this.worstOf(h);
        if (worst) open.push({ pts: h, worst });
        else out.push(h);
      }
    }
    return out;
  }

  /** The line to cut a piece along at its worst point: a diagonal once the piece lies in its cell, else that cell's side */
  private lineFor(pts: readonly number[], w: Worst): Line {
    if (w.kind === LINE_X || w.kind === LINE_Y) return lineOf(w.kind, w.value);
    const { grid, originX, originY } = this.ground;
    const cell = grid.cellSize;
    const x0 = originX + (w.cell % grid.columns) * cell;
    const y0 = originY + Math.floor(w.cell / grid.columns) * cell;
    let best: Line | null = null;
    let near = Infinity;
    for (const [kind, v, d] of [
      [LINE_X, x0, w.x - x0],
      [LINE_X, x0 + cell, x0 + cell - w.x],
      [LINE_Y, y0, w.y - y0],
      [LINE_Y, y0 + cell, y0 + cell - w.y],
    ]) {
      let below = false;
      let above = false;
      for (let k = 0; k < pts.length; k += 2) {
        const s = (kind === LINE_X ? pts[k] : pts[k + 1]) - v;
        if (s < -END_GAP) below = true;
        if (s > END_GAP) above = true;
      }
      if (below && above && d < near) {
        near = d;
        best = lineOf(kind, v);
      }
    }
    return best ?? lineOf(w.kind, w.value);
  }

  /** The worst point of a piece over its triangles */
  private worstOf(pts: number[]): Worst | null {
    const tri = earClip(pts, this.tri);
    let worst: Worst | null = null;
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k] * 2;
      const b = tri[k + 1] * 2;
      const c = tri[k + 2] * 2;
      const w = worstPoint(pts[a], pts[a + 1], pts[b], pts[b + 1], pts[c], pts[c + 1], this.ground, this.lines);
      if (w && (!worst || w.off > worst.off)) worst = w;
    }
    return worst;
  }
}

/** A convex polygon (x, y in turn) cut by a line into its two sides, null when the line does not cross it */
function splitPolygon(pts: readonly number[], [a, b, c]: Line): [number[], number[]] | null {
  const n = pts.length / 2;
  const scale = Math.hypot(a, b);
  const side: number[] = [];
  let pos = false;
  let neg = false;
  for (let k = 0; k < n; k++) {
    let s = (a * pts[k * 2] + b * pts[k * 2 + 1] + c) / scale;
    if (Math.abs(s) < END_GAP) s = 0;
    side.push(s);
    if (s > 0) pos = true;
    if (s < 0) neg = true;
  }
  if (!pos || !neg) return null;
  const p: number[] = [];
  const q: number[] = [];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const s = side[k];
    const t = side[j];
    if (s >= 0) p.push(pts[k * 2], pts[k * 2 + 1]);
    if (s <= 0) q.push(pts[k * 2], pts[k * 2 + 1]);
    if ((s > 0 && t < 0) || (s < 0 && t > 0)) {
      const f = s / (s - t);
      const x = Math.fround(pts[k * 2] + (pts[j * 2] - pts[k * 2]) * f);
      const y = Math.fround(pts[k * 2 + 1] + (pts[j * 2 + 1] - pts[k * 2 + 1]) * f);
      p.push(x, y);
      q.push(x, y);
    }
  }
  return [p, q];
}

/**
 * A convex polygon (x, y in turn, counter-clockwise, points on its sides
 * allowed) as triangles, indices of its points into `out`: ear by ear,
 * never one of three points in a line
 */
function earClip(pts: readonly number[], out: number[]): number[] {
  out.length = 0;
  const left: number[] = [];
  for (let k = 0; k < pts.length / 2; k++) left.push(k);
  const area = (i: number, j: number, k: number) => (pts[j * 2] - pts[i * 2]) * (pts[k * 2 + 1] - pts[i * 2 + 1]) - (pts[k * 2] - pts[i * 2]) * (pts[j * 2 + 1] - pts[i * 2 + 1]);
  while (left.length > 3) {
    // The ear of the largest area: no sliver while a fuller one is there
    let at = -1;
    let most = 1e-9;
    for (let k = 0; k < left.length; k++) {
      const s = area(left[(k + left.length - 1) % left.length], left[k], left[(k + 1) % left.length]);
      if (s > most) {
        most = s;
        at = k;
      }
    }
    if (at < 0) return out;
    out.push(left[(at + left.length - 1) % left.length], left[at], left[(at + 1) % left.length]);
    left.splice(at, 1);
  }
  if (left.length === 3 && area(left[0], left[1], left[2]) > 1e-9) out.push(left[0], left[1], left[2]);
  return out;
}

/** Metres of a cell of the points' index */
const POINT_CELL = 4;

/** The corners the cuts made on triangles' edges (and the crossings of forced edges), by the cells of an index */
class LaidPoints {
  private readonly cells = new Map<number, number[]>();
  size = 0;

  add(x: number, y: number): void {
    const key = Math.floor(x / POINT_CELL) * 65536 + Math.floor(y / POINT_CELL);
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    for (let k = 0; k < list.length; k += 2) if (list[k] === x && list[k + 1] === y) return;
    list.push(x, y);
    this.size++;
  }

  /** The points in a box (x, y in turn), into `out` */
  near(x0: number, y0: number, x1: number, y1: number, out: number[]): number[] {
    out.length = 0;
    if (!this.size) return out;
    for (let j = Math.floor(y0 / POINT_CELL); j <= Math.floor(y1 / POINT_CELL); j++) {
      for (let i = Math.floor(x0 / POINT_CELL); i <= Math.floor(x1 / POINT_CELL); i++) {
        const list = this.cells.get(i * 65536 + j);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) if (list[k] >= x0 && list[k] <= x1 && list[k + 1] >= y0 && list[k + 1] <= y1) out.push(list[k], list[k + 1]);
      }
    }
    return out;
  }

  /** Of the points `near` gave, those on segment p-q, strictly between its ends, in order from p (x, y in turn), into `out` */
  static on(near: readonly number[], px: number, py: number, qx: number, qy: number, out: number[]): number[] {
    out.length = 0;
    const dx = qx - px;
    const dy = qy - py;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12 || !near.length) return out;
    const len = Math.sqrt(len2);
    let found: { t: number; x: number; y: number }[] | null = null;
    for (let k = 0; k < near.length; k += 2) {
      const x = near[k];
      const y = near[k + 1];
      // Within a tenth of a millimetre of the line (a point kept in 32 bits a kilometre out is off it by less)
      if (Math.abs((x - px) * dy - (y - py) * dx) > 1e-4 * len) continue;
      const t = ((x - px) * dx + (y - py) * dy) / len2;
      if (t * len < 1e-4 || (1 - t) * len < 1e-4) continue;
      (found ??= []).push({ t, x, y });
    }
    if (!found) return out;
    found.sort((a, b) => a.t - b.t);
    for (const f of found) out.push(f.x, f.y);
    return out;
  }
}

/**
 * A geometry as conformDraped lays it: the source's vertices first, new
 * ones after, the triangles anew. Each source triangle is kept or given as
 * its pieces; `result` gives each with a laid point on an edge that point
 * as a corner
 */
class ConformedGeometry {
  private changed = false;
  private readonly pos: number[] = [];
  private readonly data: number[][];
  private readonly names: string[];
  private readonly sizes: number[];
  /** Per source triangle (its first index) kept, or its pieces */
  private readonly cut = new Map<number, number[][]>();
  private readonly order: number[] = [];
  private readonly vertices: number;
  /** The new vertices in the source triangle at hand: x, y and their index, to share them between its pieces */
  private readonly local: number[] = [];
  private localOf = -1;
  private readonly near: number[] = [];

  constructor(
    private readonly src: DrapedGeometry,
    private readonly points: LaidPoints,
  ) {
    this.vertices = src.position.length / 2;
    this.names = Object.keys(src.attributes);
    this.sizes = this.names.map((n) => src.attributes[n].itemSize);
    this.data = this.names.map(() => []);
  }

  keep(t: number): void {
    this.order.push(t);
  }

  /**
   * Source triangle t as its pieces; their corners go into the list (on its
   * edges for the triangles beside it, inside for its pieces beside each
   * other: a piece cut again leaves a corner on the side of the one next to
   * it)
   */
  pieces(t: number, pieces: number[][]): void {
    this.order.push(t);
    this.cut.set(t, pieces);
    for (const piece of pieces) for (let k = 0; k < piece.length; k += 2) this.points.add(piece[k], piece[k + 1]);
  }

  /**
   * The geometry: each source triangle, or each triangle of its pieces (as
   * earClip gave them when they were looked at), and one with laid points on
   * its sides split at them, a fan from the corner across from them (from
   * its middle when they lie on two or three sides). Those are parts of a
   * triangle that lay within the tolerance, their corners on the ground, so
   * they lie within twice of it. Null when nothing changed
   */
  result(): DrapedGeometry | null {
    const index: number[] = [];
    const tri: number[] = [];
    const corner = [0, 0, 0];
    const ids = [0, 0, 0];
    const sides: number[][] = [[], [], []];
    const ring: number[] = [];
    const p = this.src.position;
    const idx = this.src.index;
    for (const t of this.order) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const pieces = this.cut.get(t);
      if (a === b && b === c) {
        index.push(a, b, c);
        continue;
      }
      // Kept: as it was, unless a point lies on a side
      if (
        !pieces &&
        !this.points.near(
          Math.min(p[a * 2], p[b * 2], p[c * 2]) - 1e-3,
          Math.min(p[a * 2 + 1], p[b * 2 + 1], p[c * 2 + 1]) - 1e-3,
          Math.max(p[a * 2], p[b * 2], p[c * 2]) + 1e-3,
          Math.max(p[a * 2 + 1], p[b * 2 + 1], p[c * 2 + 1]) + 1e-3,
          this.near,
        ).length
      ) {
        index.push(a, b, c);
        continue;
      }
      for (const poly of pieces ?? [[p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1], p[c * 2], p[c * 2 + 1]]]) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let k = 0; k < poly.length; k += 2) {
          x0 = Math.min(x0, poly[k]);
          x1 = Math.max(x1, poly[k]);
          y0 = Math.min(y0, poly[k + 1]);
          y1 = Math.max(y1, poly[k + 1]);
        }
        const near = this.points.near(x0 - 1e-3, y0 - 1e-3, x1 + 1e-3, y1 + 1e-3, this.near);
        this.changed = true;
        earClip(poly, tri);
        for (let q = 0; q < tri.length; q += 3) {
          let marked = 0;
          let side = -1;
          for (let e = 0; e < 3; e++) {
            corner[e] = tri[q + e] * 2;
            ids[e] = this.vertexAt(t, poly[corner[e]], poly[corner[e] + 1]);
          }
          for (let e = 0; e < 3 && near.length; e++) {
            const i = corner[e];
            const j = corner[(e + 1) % 3];
            LaidPoints.on(near, poly[i], poly[i + 1], poly[j], poly[j + 1], sides[e]);
            if (sides[e].length) {
              marked++;
              side = e;
            }
          }
          if (!marked) {
            index.push(ids[0], ids[1], ids[2]);
            continue;
          }
          // The outline with the points, then a fan over it
          ring.length = 0;
          for (let e = 0; e < 3; e++) {
            ring.push(ids[e]);
            const pts = sides[e];
            for (let k = 0; k < pts.length; k += 2) ring.push(this.vertexAt(t, pts[k], pts[k + 1]));
          }
          if (marked === 1) {
            // From the corner across from the side with points: the corner after that side's end
            const from = ring.indexOf(ids[(side + 2) % 3]);
            for (let k = 1; k + 1 < ring.length; k++) index.push(ring[from], ring[(from + k) % ring.length], ring[(from + k + 1) % ring.length]);
          } else {
            const mx = (poly[corner[0]] + poly[corner[1]] + poly[corner[2]]) / 3;
            const my = (poly[corner[0] + 1] + poly[corner[1] + 1] + poly[corner[2] + 1]) / 3;
            const mid = this.vertexAt(t, mx, my);
            for (let k = 0; k < ring.length; k++) index.push(mid, ring[k], ring[(k + 1) % ring.length]);
          }
        }
      }
    }
    if (!this.changed) return null;
    const n = this.vertices + this.pos.length / 2;
    const position = new Float32Array(n * 2);
    position.set(this.src.position);
    position.set(this.pos, this.vertices * 2);
    const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
    this.names.forEach((name, k) => {
      const array = new Float32Array(n * this.sizes[k]);
      array.set(this.src.attributes[name].array.subarray(0, this.vertices * this.sizes[k]));
      array.set(this.data[k], this.vertices * this.sizes[k]);
      attributes[name] = { array, itemSize: this.sizes[k] };
    });
    return { position, attributes, index: Uint32Array.from(index) };
  }

  /** The vertex at a map point in source triangle t: one of its corners, or a new one, its attributes interpolated there */
  private vertexAt(t: number, x: number, y: number): number {
    const idx = this.src.index;
    const p = this.src.position;
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (p[a * 2] === x && p[a * 2 + 1] === y) return a;
    if (p[b * 2] === x && p[b * 2 + 1] === y) return b;
    if (p[c * 2] === x && p[c * 2 + 1] === y) return c;
    x = Math.fround(x);
    y = Math.fround(y);
    const l = this.local;
    if (this.localOf !== t) {
      l.length = 0;
      this.localOf = t;
    }
    for (let k = 0; k < l.length; k += 3) if (l[k] === x && l[k + 1] === y) return l[k + 2];
    const ax = p[a * 2];
    const ay = p[a * 2 + 1];
    const det = (p[b * 2] - ax) * (p[c * 2 + 1] - ay) - (p[c * 2] - ax) * (p[b * 2 + 1] - ay);
    const u = det ? ((x - ax) * (p[c * 2 + 1] - ay) - (p[c * 2] - ax) * (y - ay)) / det : 0;
    const v = det ? ((p[b * 2] - ax) * (y - ay) - (x - ax) * (p[b * 2 + 1] - ay)) / det : 0;
    const w = 1 - u - v;
    const n = this.vertices + this.pos.length / 2;
    this.pos.push(x, y);
    this.names.forEach((name, k) => {
      const s = this.sizes[k];
      const arr = this.src.attributes[name].array;
      for (let q = 0; q < s; q++) this.data[k].push(arr[a * s + q] * w + arr[b * s + q] * u + arr[c * s + q] * v);
    });
    l.push(x, y, n);
    return n;
  }
}

/**
 * Takes the triangles of `tile` that need splitting in `rect` (their ground
 * left them there) out of it: a geometry of their own (their
 * vertices copied, the attributes with them), and in the tile each of them
 * made degenerate (its three corners on one vertex: drawn as nothing, the
 * index keeps its length, so the tile's buffers need no copy). Null when
 * none needs it
 */
export function takeSplitting(
  tile: DrapedGeometry,
  rect: DrapeRect,
  ground: DrapeGround,
  /** The tile's triangles by where they lie (triangleBuckets): only those near the rectangle are looked at */
  buckets?: TriangleBuckets | null,
): DrapedGeometry | null {
  const cell = ground.grid.cellSize;
  const x0 = rect.minX - cell;
  const y0 = rect.minY - cell;
  const x1 = rect.maxX + cell;
  const y1 = rect.maxY + cell;
  const idx = tile.index;
  const p = tile.position;
  const taken: number[] = [];
  const candidates = buckets ? near(buckets, x0, y0, x1, y1) : null;
  const count = candidates ? candidates.length : idx.length / 3;
  const lines = new GroundLines(ground);
  for (let n = 0; n < count; n++) {
    const t = candidates ? candidates[n] : n * 3;
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (a === b && b === c) continue;
    if (meets(p, a, b, c, x0, y0, x1, y1) && worstPoint(p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1], p[c * 2], p[c * 2 + 1], ground, lines)) taken.push(t);
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
