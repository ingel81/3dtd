/**
 * The walls of the water: where a surface ends in the air (a river's side
 * or end over lower ground, the stretch a crater cut off), the water shows
 * its body down to the bed instead of a sheet one can look under. A wall
 * is a strip of quads hanging from the surface's edge to below the ground
 * there, drawn by the surface's own material (attribute `aWall`, see
 * water-material.ts): no program and no draw of its own. Inside the ground
 * the material cuts it along the terrain, so only what hangs in the air
 * shows. One-sided, facing out of the water.
 */

/** Metres a wall reaches below the ground under its edge, so the terrain's triangles always close it */
export const WALL_FOOT = 0.6;

/** Metres the water must stand over the ground at an end of a wall for it to show (water-material.ts fades it in from there) */
export const WALL_SHOWS = 0.25;

/** One vertex of a wall: map position, its height, the surface over it (all map metres) */
export interface WallVertex {
  x: number;
  y: number;
  height: number;
  top: number;
}

/**
 * Collects wall quads for a geometry: `add` pushes the top and bottom
 * vertex of each end of an edge (through `vertex`, which writes the
 * geometry's own attributes and returns the index) and the two triangles,
 * wound to face `out` (map x, y).
 */
export class WallStrip {
  constructor(
    /** Writes one vertex (scene position -x, height, y; aWall 1, top) and returns its index */
    private readonly vertex: (v: WallVertex) => number,
    private readonly index: number[],
    /** Metres the water must stand over the ground at both ends (a lake's edge: only a real step, a dam), else at either */
    private readonly both = 0,
  ) {}

  /**
   * The wall below the edge from (ax, ay) to (bx, by), its surface at
   * `topA`, `topB`; the ground under its ends `groundA`, `groundB`. Left
   * out where the water stands less than WALL_SHOWS over the ground at both
   * ends (underground, or so low the surface's soft edge ends it). Faces the side (outX, outY) points to
   */
  add(ax: number, ay: number, topA: number, groundA: number, bx: number, by: number, topB: number, groundB: number, outX: number, outY: number): void {
    if (topA - groundA < WALL_SHOWS && topB - groundB < WALL_SHOWS) return;
    if (Math.min(topA - groundA, topB - groundB) < this.both) return;
    const a0 = this.vertex({ x: ax, y: ay, height: topA, top: topA });
    const b0 = this.vertex({ x: bx, y: by, height: topB, top: topB });
    const a1 = this.vertex({ x: ax, y: ay, height: Math.min(groundA, topA) - WALL_FOOT, top: topA });
    const b1 = this.vertex({ x: bx, y: by, height: Math.min(groundB, topB) - WALL_FOOT, top: topB });
    // Scene space is (-x, height, y): the quad a0 b0 b1 faces out when the edge runs clockwise around `out` seen
    // from above in scene space, i.e. when (b - a) x up points along out in scene x and z
    const ex = -(bx - ax);
    const ez = by - ay;
    // (ex, 0, ez) x (0, -1, 0) = (ez, 0, -ex): the normal of a0, b0, b1 (top edge, then down)
    const faces = ez * -outX + -ex * outY > 0;
    if (faces) this.index.push(a0, b0, b1, a0, b1, a1);
    else this.index.push(a0, b1, b0, a0, a1, b1);
  }
}
