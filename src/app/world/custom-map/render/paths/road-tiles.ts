/** The road network's draped tiles as they are filled: vertex and index arrays that grow, one builder per tile */
import type { Vertex } from './road-types';
import type { DrapedGeometry } from '../drape/draped-refine';
import type { MapPoint } from '../../map-document';
import { drapeTileKey } from '../drape/draped-layer';

/** A tile's vertices and triangles as they grow */
export class TileData {
  v: Float32Array = new Float32Array(64);
  r: Float32Array = new Float32Array(128);
  d: Float32Array = new Float32Array(64);
  a: Float32Array = new Float32Array(128);
  i: Uint32Array = new Uint32Array(192);
  vertices = 0;
  indices = 0;

  vertex(p: Vertex): void {
    const n = this.vertices;
    if (n * 2 + 2 > this.v.length) {
      this.v = grow(this.v);
      this.r = grow(this.r);
      this.d = grow(this.d);
      this.a = grow(this.a);
    }
    this.v[n * 2] = p.x;
    this.v[n * 2 + 1] = p.y;
    this.r[n * 4] = p.across;
    this.r[n * 4 + 1] = p.along;
    this.r[n * 4 + 2] = p.edge;
    this.r[n * 4 + 3] = p.style;
    this.d[n * 2] = p.dx;
    this.d[n * 2 + 1] = p.dy;
    if (p.arm) this.a.set(p.arm, n * 4);
    this.vertices++;
  }

  triangle(a: number, b: number, c: number): void {
    if (this.indices + 3 > this.i.length) this.i = grow(this.i);
    this.i[this.indices++] = a;
    this.i[this.indices++] = b;
    this.i[this.indices++] = c;
  }

  /** Its vertices and triangles as a draped geometry (views, no copy) */
  geometry(): DrapedGeometry {
    const n = this.vertices;
    return {
      position: this.v.subarray(0, n * 2),
      attributes: { r: { array: this.r.subarray(0, n * 4), itemSize: 4 }, d: { array: this.d.subarray(0, n * 2), itemSize: 2 }, a: { array: this.a.subarray(0, n * 4), itemSize: 4 } },
      index: this.i.subarray(0, this.indices),
    };
  }

  /** Takes a draped geometry's vertices and triangles (its own `geometry` laid onto the ground) */
  take(g: DrapedGeometry): void {
    this.v = g.position;
    this.r = g.attributes['r'].array;
    this.d = g.attributes['d'].array;
    this.a = g.attributes['a'].array;
    this.i = g.index;
    this.vertices = g.position.length / 2;
    this.indices = g.index.length;
  }
}

function grow<T extends Float32Array | Uint32Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}

/** The geometry of one ribbon or junction, by the tiles its pieces start in */
export class TileBuilder {
  readonly tiles = new Map<string, TileData>();
  /** Edges shared with another item (x0, y0, x1, y1 each, as the vertices keep them): a ribbon's end sections */
  readonly shared: number[] = [];

  /** The edges between the points of a cross section, as shared with the item at its other side */
  share(section: readonly Vertex[]): void {
    for (let k = 0; k + 1 < section.length; k++) {
      this.shared.push(Math.fround(section[k].x), Math.fround(section[k].y), Math.fround(section[k + 1].x), Math.fround(section[k + 1].y));
    }
  }

  /** The tile holding a map point */
  tileAt(p: MapPoint): TileData {
    const key = drapeTileKey(p.x, p.y);
    let t = this.tiles.get(key);
    if (!t) {
      t = new TileData();
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Adds triangles over `verts` (indices into them) to the tile of `verts[0]` */
  add(verts: readonly Vertex[], triangles: readonly number[]): void {
    if (!verts.length || !triangles.length) return;
    const t = this.tileAt(verts[0]);
    const base = t.vertices;
    for (const v of verts) t.vertex(v);
    for (let k = 0; k < triangles.length; k += 3) t.triangle(base + triangles[k], base + triangles[k + 1], base + triangles[k + 2]);
  }
}
