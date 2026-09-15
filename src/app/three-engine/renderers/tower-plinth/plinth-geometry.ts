import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * How far (m) the plinth reaches below the lowest footprint probe: the
 * ground between the probes may lie a little lower.
 */
export const PLINTH_EMBED_M = 0.4;

/** Plinth radius beyond the footprint (m), so the corners of a square base stay on it. */
export const PLINTH_RIM_M = 0.2;

/** The wall leans out towards the foot like a rubble wall, this much per metre of height. */
const BATTER_PER_M = 0.05;
/** Upper limit of that lean (m). */
const MAX_BATTER_M = 0.5;
/** Target edge length (m) of the wall grid, around and up. */
const SEGMENT_M = 0.5;
/** Largest bulge of the wall, as a share of the radius. */
const BULGE = 0.025;

/** Width (m) of a corbel across, a little over two stones. */
export const BRACE_WIDTH_M = 1.2;
/** Courses a corbel steps out in under the plinth, each one further out than the one below. */
export const BRACE_COURSES = 3;
/** A course is as high as it steps out, within these limits (m). */
const BRACE_COURSE_MIN_M = 0.4;
const BRACE_COURSE_MAX_M = 0.9;
/**
 * Top of a corbel (local y), 0.2 m above the plinth's underside
 * (-PLINTH_EMBED_M): it reaches up into the plinth, the joint stays closed.
 */
export const BRACE_TOP_Y = -PLINTH_EMBED_M + 0.2;

/**
 * A stone corbel under a plinth that hangs over a drop: a block set into
 * the building below, stepping out in BRACE_COURSES courses to its front
 * face just inside the wall under the rim. plinthBraces (plinth-braces.ts)
 * lays them out. Reaches run along `angle`, from the line through the
 * plinth's axis at right angles to it.
 */
export interface PlinthBrace {
  /** Direction it points out along (radians), the wall's theta: 0 = +x, π/2 = +z */
  angle: number;
  /** Its middle this far (m) to the side of the axis, towards angle + π/2 */
  offset: number;
  /** Reach (m) of its front face, just inside the wall */
  topReach: number;
  /** Reach (m) of the roof's edge as far as the probes tell: the steps project from there */
  edgeReach: number;
  /** Reach (m) of its back in the building: the flat underside of the lowest course runs back to it */
  footReach: number;
}

/** How far (m) each course of `brace` steps out, and how high it is. */
export function braceCourse(brace: PlinthBrace): { step: number; height: number } {
  const step = (brace.topReach - brace.edgeReach) / BRACE_COURSES;
  return { step, height: Math.min(Math.max(step, BRACE_COURSE_MIN_M), BRACE_COURSE_MAX_M) };
}

/**
 * Bulge of the wall at angle `theta` and height `y`, -1..1. Integer
 * frequencies in theta keep it periodic, so the ring closes without a seam.
 */
function bulge(theta: number, y: number): number {
  return 0.5 * Math.sin(3 * theta + 1.3 + 0.9 * y)
    + 0.3 * Math.sin(7 * theta + 0.4 - 1.7 * y)
    + 0.2 * Math.sin(13 * theta + 2.1 + 2.3 * y);
}

/**
 * Distance (m) of the plinth wall from its axis at angle `theta` and height
 * `y` (see createPlinthGeometry): the top radius, the lean towards the foot
 * and the bulge.
 */
export function plinthWallRadius(footprintRadius: number, height: number, theta: number, y: number): number {
  const wallHeight = height + PLINTH_EMBED_M;
  const batter = Math.min(BATTER_PER_M * wallHeight, MAX_BATTER_M);
  const lean = batter * ((height - y) / wallHeight);
  return (footprintRadius + PLINTH_RIM_M + lean) * (1 + BULGE * bulge(theta, y));
}

/**
 * Wall and top face of a tower plinth: a round column, slightly battered
 * and bulging like stacked rubble, from y = -PLINTH_EMBED_M to y = `height`.
 * y = 0 is the lowest point of the footprint, y = `height` the tower's foot.
 * The top radius is `footprintRadius` + PLINTH_RIM_M. Open at the bottom,
 * which sits in the ground. The stones come from the material
 * (plinth-material.ts); the geometry has positions and normals only.
 *
 * With `braces` the plinth hangs over a drop somewhere: its bottom gets a
 * face, seen from below there, and the braces go under it. Each face of a
 * brace has vertices of its own, so its edges stay hard.
 */
export function createPlinthGeometry(
  footprintRadius: number,
  height: number,
  braces: readonly PlinthBrace[] = [],
): BufferGeometry {
  const topRadius = footprintRadius + PLINTH_RIM_M;
  const bottomY = -PLINTH_EMBED_M;
  const wallHeight = height - bottomY;

  const segments = Math.max(16, Math.ceil((2 * Math.PI * topRadius) / SEGMENT_M));
  const rows = Math.max(2, Math.ceil(wallHeight / SEGMENT_M));

  const positions: number[] = [];
  const indices: number[] = [];
  const ringPoint = (theta: number, y: number): [number, number, number] => {
    const r = plinthWallRadius(footprintRadius, height, theta, y);
    return [Math.cos(theta) * r, y, Math.sin(theta) * r];
  };

  // Wall: rows + 1 rings from the bottom up, `segments` vertices each, the
  // last one joined to the first.
  for (let j = 0; j <= rows; j++) {
    const y = bottomY + (wallHeight * j) / rows;
    for (let i = 0; i < segments; i++) {
      positions.push(...ringPoint((i / segments) * Math.PI * 2, y));
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * segments + i;
      const b = j * segments + ((i + 1) % segments);
      const c = b + segments;
      const d = a + segments;
      // Counter-clockwise seen from outside
      indices.push(a, c, b, a, d, c);
    }
  }

  // Top face: its own vertices, so the edge to the wall stays hard.
  const center = positions.length / 3;
  positions.push(0, height, 0);
  for (let i = 0; i < segments; i++) {
    positions.push(...ringPoint((i / segments) * Math.PI * 2, height));
  }
  for (let i = 0; i < segments; i++) {
    // Counter-clockwise seen from above
    indices.push(center, center + 1 + ((i + 1) % segments), center + 1 + i);
  }

  if (braces.length > 0) {
    // Bottom face the same way, turned down
    const bottomCenter = positions.length / 3;
    positions.push(0, bottomY, 0);
    for (let i = 0; i < segments; i++) {
      positions.push(...ringPoint((i / segments) * Math.PI * 2, bottomY));
    }
    for (let i = 0; i < segments; i++) {
      indices.push(bottomCenter, bottomCenter + 1 + i, bottomCenter + 1 + ((i + 1) % segments));
    }
    for (const brace of braces) {
      appendBrace(positions, indices, brace);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type Point3 = readonly [number, number, number];

/**
 * A corbel as a stepped stone block, BRACE_WIDTH_M across. Its side profile
 * runs along the top inside the plinth to the front face under the rim, down
 * that face, back and down course by course, along the flat underside of
 * the lowest course to its back in the building, and up the back.
 */
function appendBrace(positions: number[], indices: number[], brace: PlinthBrace): void {
  const ux = Math.cos(brace.angle);
  const uz = Math.sin(brace.angle);
  const half = BRACE_WIDTH_M / 2;
  const { step, height } = braceCourse(brace);
  // Front face and underside of course k, 1 being the top one
  const front = (k: number) => brace.topReach - (k - 1) * step;
  const bottom = (k: number) => -PLINTH_EMBED_M - k * height;
  // Point at `reach` along the corbel and height y, on side `side` (-1 or 1) of it
  const point = (reach: number, y: number, side: number): Point3 => {
    const across = brace.offset + side * half;
    return [ux * reach - uz * across, y, uz * reach + ux * across];
  };

  // Side profile as (reach, y), clockwise with the reach to the right and y up
  const profile: [number, number][] = [[brace.footReach, BRACE_TOP_Y], [brace.topReach, BRACE_TOP_Y]];
  for (let k = 1; k <= BRACE_COURSES; k++) {
    profile.push([front(k), bottom(k)]);
    profile.push([k < BRACE_COURSES ? front(k + 1) : brace.footReach, bottom(k)]);
  }
  for (let i = 0; i < profile.length; i++) {
    const [a0, y0] = profile[i];
    const [a1, y1] = profile[(i + 1) % profile.length];
    // Clockwise, so outwards is the edge turned right
    const outward: Point3 = [ux * (y0 - y1), a1 - a0, uz * (y0 - y1)];
    appendQuad(positions, indices, [point(a0, y0, -1), point(a1, y1, -1), point(a1, y1, 1), point(a0, y0, 1)], outward);
  }
  // The two sides, a rectangle per course
  for (const side of [-1, 1]) {
    const outward: Point3 = [-uz * side, 0, ux * side];
    for (let k = 1; k <= BRACE_COURSES; k++) {
      const top = k === 1 ? BRACE_TOP_Y : bottom(k - 1);
      appendQuad(positions, indices, [
        point(brace.footReach, bottom(k), side),
        point(front(k), bottom(k), side),
        point(front(k), top, side),
        point(brace.footReach, top, side),
      ], outward);
    }
  }
}

/** A flat quad with vertices of its own, its front turned towards `outward`. */
function appendQuad(positions: number[], indices: number[], quad: readonly Point3[], outward: Point3): void {
  const [a, b, c] = quad;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const facing = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2];

  const base = positions.length / 3;
  for (const p of quad) positions.push(p[0], p[1], p[2]);
  if (facing > 0) {
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}
